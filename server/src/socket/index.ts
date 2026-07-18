import { Server, Socket } from 'socket.io';
import { db } from '../db/knex';
import { verifyToken } from '../middleware/auth';
import { Player, GuessFeedback } from '../types';
import { compareGuess, MAX_GUESSES, EASY_MIN_MAJORS } from '../services/gameService';

/**
 * 多人对战:支持登录用户与匿名访客(guestKey 标识),允许观战。
 * BO1/3/5/7 赛制:每小局同一目标选手,先猜中者得 1 分,先到 winsNeeded 者赢下整场;
 * 双方都用完次数或小局超时则无人得分,进入下一小局。
 * 断线立即广播,同一身份可重连;超过宽限期未归判负。
 * 所有 ack 与事件错误只传 code,文案由前端翻译。
 */

interface SocketIdentity {
  /** 全局唯一身份: 登录用户 u:<id>,访客 g:<guestKey> */
  key: string;
  userId: number | null;
  name: string;
}

interface RoomPlayer extends SocketIdentity {
  socketId: string;
  ready: boolean;
  score: number;
  guesses: GuessFeedback[];
  connected: boolean;
  disconnectTimer?: NodeJS.Timeout;
}

interface Spectator extends SocketIdentity {
  socketId: string;
}

type BoType = 1 | 3 | 5 | 7;
type DbType = 'easy' | 'normal';

interface Room {
  id: string;
  hostKey: string;
  status: 'waiting' | 'playing' | 'round_over' | 'finished';
  dbType: DbType;
  boType: BoType;
  round: number;
  players: RoomPlayer[];
  spectators: Spectator[];
  target?: Player;
  roundEndsAt: number | null;
  roundTimer?: NodeJS.Timeout;
  nextRoundTimer?: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();
/** 随机匹配队列,按数据库类型分组 */
const matchQueue = new Map<DbType, { socket: Socket; identity: SocketIdentity }[]>();

const DISCONNECT_FORFEIT_MS = 30_000;
const NEXT_ROUND_DELAY_MS = 6_000;
/** 每小局限时 */
const ROUND_TIME_MS = 120_000;
const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function winsNeeded(bo: BoType): number {
  return Math.ceil(bo / 2);
}

function genRoomId(): string {
  let id: string;
  do {
    id = Array.from(
      { length: 5 },
      () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]
    ).join('');
  } while (rooms.has(id));
  return id;
}

function publicRoom(room: Room) {
  return {
    id: room.id,
    hostKey: room.hostKey,
    status: room.status,
    dbType: room.dbType,
    boType: room.boType,
    round: room.round,
    winsNeeded: winsNeeded(room.boType),
    maxGuesses: MAX_GUESSES,
    roundEndsAt: room.roundEndsAt,
    spectators: room.spectators.map((s) => ({ key: s.key, name: s.name })),
    players: room.players.map((p) => ({
      key: p.key,
      name: p.name,
      ready: p.ready,
      connected: p.connected,
      score: p.score,
      guessCount: p.guesses.length,
      guesses: p.guesses,
    })),
  };
}

async function pickTarget(dbType: DbType): Promise<Player | null> {
  let query = db<Player>('players');
  if (dbType === 'easy') query = query.where('major_appearances', '>=', EASY_MIN_MAJORS);
  const players = await query;
  return players.length ? players[Math.floor(Math.random() * players.length)] : null;
}

function answerView(target: Player) {
  return {
    nickname: target.nickname,
    realName: target.real_name,
    team: target.team,
    nationality: target.nationality,
    role: target.role,
    majorAppearances: target.major_appearances,
  };
}

function clearTimers(room: Room) {
  for (const p of room.players) {
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
  }
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
  if (room.roundTimer) clearTimeout(room.roundTimer);
}

async function startRound(io: Server, room: Room) {
  const target = await pickTarget(room.dbType);
  if (!target) {
    io.to(room.id).emit('room:error', { code: 'EMPTY_PLAYER_POOL' });
    return;
  }
  room.target = target;
  room.status = 'playing';
  room.round += 1;
  room.roundEndsAt = Date.now() + ROUND_TIME_MS;
  for (const p of room.players) p.guesses = [];
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => {
    if (room.status === 'playing') void finishRound(io, room, null, 'timeout');
  }, ROUND_TIME_MS);
  io.to(room.id).emit('round:start', { room: publicRoom(room) });
}

async function finishMatch(io: Server, room: Room, winnerKey: string | null, reason: string) {
  if (room.status === 'finished') return;
  room.status = 'finished';
  room.roundEndsAt = null;
  clearTimers(room);
  const winner = room.players.find((p) => p.key === winnerKey);
  await db('match_records').insert({
    room_id: room.id,
    bo_type: room.boType,
    winner_id: winner?.userId ?? null,
    players: JSON.stringify(
      room.players.map((p) => ({ userId: p.userId, name: p.name, score: p.score }))
    ),
  });
  io.to(room.id).emit('match:over', {
    winnerKey,
    reason,
    answer: room.target ? answerView(room.target) : null,
    room: publicRoom(room),
  });
  setTimeout(() => rooms.delete(room.id), 5 * 60 * 1000);
}

/** 小局结束:得分并判断整场是否结束,否则定时开下一小局 */
async function finishRound(
  io: Server,
  room: Room,
  winnerKey: string | null,
  reason: 'guessed' | 'exhausted' | 'timeout'
) {
  if (room.status !== 'playing') return;
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundEndsAt = null;
  const winner = room.players.find((p) => p.key === winnerKey);
  if (winner) winner.score += 1;
  const answer = room.target ? answerView(room.target) : null;

  if (winner && winner.score >= winsNeeded(room.boType)) {
    io.to(room.id).emit('round:over', {
      winnerKey,
      reason,
      answer,
      matchOver: true,
      room: publicRoom(room),
    });
    await finishMatch(io, room, winnerKey, 'score');
    return;
  }
  room.status = 'round_over';
  io.to(room.id).emit('round:over', {
    winnerKey,
    reason,
    answer,
    matchOver: false,
    nextRoundInMs: NEXT_ROUND_DELAY_MS,
    room: publicRoom(room),
  });
  room.nextRoundTimer = setTimeout(() => {
    if (room.status === 'round_over') void startRound(io, room);
  }, NEXT_ROUND_DELAY_MS);
}

function removeFromQueue(socketId: string) {
  for (const [key, list] of matchQueue) {
    matchQueue.set(
      key,
      list.filter((e) => e.socket.id !== socketId)
    );
  }
}

function removeSpectator(io: Server, socketId: string) {
  for (const room of rooms.values()) {
    const before = room.spectators.length;
    room.spectators = room.spectators.filter((s) => s.socketId !== socketId);
    if (room.spectators.length !== before) {
      io.to(room.id).emit('room:state', publicRoom(room));
    }
  }
}

export function setupSocket(io: Server) {
  io.use((socket, next) => {
    const auth = socket.handshake.auth ?? {};
    const payload = auth.token ? verifyToken(String(auth.token)) : null;
    let identity: SocketIdentity | null = null;
    if (payload) {
      identity = { key: `u:${payload.id}`, userId: payload.id, name: payload.username };
    } else if (typeof auth.guestKey === 'string' && /^[\w-]{8,64}$/.test(auth.guestKey)) {
      const rawName = typeof auth.guestName === 'string' ? auth.guestName.trim() : '';
      const name = rawName.slice(0, 16) || `Guest-${auth.guestKey.slice(0, 4)}`;
      identity = { key: `g:${auth.guestKey}`, userId: null, name };
    }
    if (!identity) return next(new Error('IDENTITY_REQUIRED'));
    (socket.data as { identity: SocketIdentity }).identity = identity;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const me = socket.data.identity as SocketIdentity;

    const findMyRoom = (): Room | undefined =>
      [...rooms.values()].find(
        (r) => r.status !== 'finished' && r.players.some((p) => p.key === me.key)
      );

    const findMySpectatorRoom = (): Room | undefined =>
      [...rooms.values()].find(
        (r) => r.status !== 'finished' && r.spectators.some((s) => s.key === me.key)
      );

    // 同一身份重连:恢复房间与对局状态(玩家或观战者)
    const existing = findMyRoom();
    if (existing) {
      const mine = existing.players.find((p) => p.key === me.key)!;
      mine.socketId = socket.id;
      mine.connected = true;
      if (mine.disconnectTimer) {
        clearTimeout(mine.disconnectTimer);
        mine.disconnectTimer = undefined;
      }
      socket.join(existing.id);
      io.to(existing.id).emit('room:state', publicRoom(existing));
    } else {
      const spectating = findMySpectatorRoom();
      if (spectating) {
        const s = spectating.spectators.find((x) => x.key === me.key)!;
        s.socketId = socket.id;
        socket.join(spectating.id);
        socket.emit('room:state', publicRoom(spectating));
      }
    }

    /** 主动查询自己所在的房间(进入房间页/大厅时调用) */
    socket.on('room:sync', (_payload: unknown, ack?: Function) => {
      const room = findMyRoom();
      if (room) {
        socket.join(room.id);
        return ack?.({ room: publicRoom(room), role: 'player' });
      }
      const spec = findMySpectatorRoom();
      if (spec) {
        socket.join(spec.id);
        return ack?.({ room: publicRoom(spec), role: 'spectator' });
      }
      ack?.({ code: 'NOT_IN_ROOM' });
    });

    function makePlayer(ready: boolean): RoomPlayer {
      return {
        ...me,
        socketId: socket.id,
        ready,
        score: 0,
        guesses: [],
        connected: true,
      };
    }

    socket.on(
      'room:create',
      (payload: { dbType?: DbType; boType?: number }, ack?: Function) => {
        if (findMyRoom()) return ack?.({ code: 'ALREADY_IN_ROOM' });
        const boType = ([1, 3, 5, 7] as BoType[]).includes(payload?.boType as BoType)
          ? (payload!.boType as BoType)
          : 3;
        const room: Room = {
          id: genRoomId(),
          hostKey: me.key,
          status: 'waiting',
          dbType: payload?.dbType === 'normal' ? 'normal' : 'easy',
          boType,
          round: 0,
          players: [makePlayer(true)],
          spectators: [],
          roundEndsAt: null,
        };
        rooms.set(room.id, room);
        socket.join(room.id);
        ack?.({ room: publicRoom(room) });
      }
    );

    /**
     * 加入房间:
     * - 等待中且未满 → 作为玩家加入
     * - 已满或已开始 → 作为观战者加入(spectate 显式请求或自动降级)
     */
    socket.on(
      'room:join',
      (payload: { roomId?: string; spectate?: boolean }, ack?: Function) => {
        const room = rooms.get(String(payload?.roomId ?? '').toUpperCase());
        if (!room) return ack?.({ code: 'ROOM_NOT_FOUND' });
        if (room.status === 'finished') return ack?.({ code: 'ROOM_NOT_FOUND' });

        // 已是该房玩家 → 视为重连
        if (room.players.some((p) => p.key === me.key)) {
          socket.join(room.id);
          return ack?.({ room: publicRoom(room), role: 'player' });
        }

        const asSpectator =
          payload?.spectate || room.status !== 'waiting' || room.players.length >= 2;

        if (asSpectator) {
          if (findMyRoom()) return ack?.({ code: 'ALREADY_IN_ROOM' });
          if (!room.spectators.some((s) => s.key === me.key)) {
            room.spectators.push({ ...me, socketId: socket.id });
          } else {
            const s = room.spectators.find((x) => x.key === me.key)!;
            s.socketId = socket.id;
          }
          socket.join(room.id);
          io.to(room.id).emit('room:state', publicRoom(room));
          return ack?.({ room: publicRoom(room), role: 'spectator' });
        }

        if (findMyRoom()) return ack?.({ code: 'ALREADY_IN_ROOM' });
        room.players.push(makePlayer(false));
        socket.join(room.id);
        io.to(room.id).emit('room:state', publicRoom(room));
        ack?.({ room: publicRoom(room), role: 'player' });
      }
    );

    socket.on('room:ready', (_payload: unknown, ack?: Function) => {
      const room = findMyRoom();
      if (!room || room.status !== 'waiting') return ack?.({ code: 'NOT_IN_WAITING_ROOM' });
      const mine = room.players.find((p) => p.key === me.key)!;
      mine.ready = !mine.ready;
      io.to(room.id).emit('room:state', publicRoom(room));
      ack?.({ ok: true });
    });

    socket.on('room:leave', async (_payload: unknown, ack?: Function) => {
      // 观战者离开
      removeSpectator(io, socket.id);
      const room = findMyRoom();
      if (!room) return ack?.({ ok: true });
      if (room.status === 'playing' || room.status === 'round_over') {
        const opponent = room.players.find((p) => p.key !== me.key);
        await finishMatch(io, room, opponent?.key ?? null, 'opponent_left');
      } else {
        room.players = room.players.filter((p) => p.key !== me.key);
        socket.leave(room.id);
        if (!room.players.length && !room.spectators.length) {
          rooms.delete(room.id);
        } else if (room.players.length) {
          if (room.hostKey === me.key) room.hostKey = room.players[0].key;
          room.players[0].ready = true;
          io.to(room.id).emit('room:state', publicRoom(room));
        }
      }
      ack?.({ ok: true });
    });

    socket.on('game:start', async (_payload: unknown, ack?: Function) => {
      const room = findMyRoom();
      if (!room || room.status !== 'waiting') return ack?.({ code: 'ROOM_NOT_READY' });
      if (room.hostKey !== me.key) return ack?.({ code: 'NOT_HOST' });
      if (room.players.length < 2) return ack?.({ code: 'NEED_TWO_PLAYERS' });
      if (!room.players.every((p) => p.ready)) return ack?.({ code: 'PLAYERS_NOT_READY' });
      await startRound(io, room);
      ack?.({ ok: true });
    });

    socket.on('game:guess', async (payload: { playerId?: number }, ack?: Function) => {
      const room = findMyRoom();
      if (!room || room.status !== 'playing' || !room.target) {
        return ack?.({ code: 'NO_ACTIVE_ROUND' });
      }
      const mine = room.players.find((p) => p.key === me.key)!;
      if (mine.guesses.length >= MAX_GUESSES) return ack?.({ code: 'GUESS_LIMIT_REACHED' });
      const guess = await db<Player>('players')
        .where({ id: Number(payload?.playerId) })
        .first();
      if (!guess) return ack?.({ code: 'PLAYER_NOT_FOUND' });
      if (mine.guesses.some((g) => g.playerId === guess.id)) {
        return ack?.({ code: 'ALREADY_GUESSED' });
      }

      const feedback = compareGuess(guess, room.target);
      mine.guesses.push(feedback);
      ack?.({ feedback });
      io.to(room.id).emit('room:state', publicRoom(room));

      if (feedback.correct) {
        await finishRound(io, room, me.key, 'guessed');
      } else if (room.players.every((p) => p.guesses.length >= MAX_GUESSES)) {
        await finishRound(io, room, null, 'exhausted');
      }
    });

    // ---------- 随机匹配 ----------
    socket.on('match:start', async (payload: { dbType?: DbType }, ack?: Function) => {
      if (findMyRoom()) return ack?.({ code: 'ALREADY_IN_ROOM' });
      removeFromQueue(socket.id);
      const dbType: DbType = payload?.dbType === 'normal' ? 'normal' : 'easy';
      const queue = matchQueue.get(dbType) ?? [];
      const opponent = queue.find(
        (e) => e.identity.key !== me.key && e.socket.connected
      );
      if (!opponent) {
        queue.push({ socket, identity: me });
        matchQueue.set(dbType, queue);
        return ack?.({ queued: true });
      }
      matchQueue.set(
        dbType,
        queue.filter((e) => e !== opponent)
      );
      // 匹配成功:直接建房并把双方拉入,BO3 固定
      const room: Room = {
        id: genRoomId(),
        hostKey: opponent.identity.key,
        status: 'waiting',
        dbType,
        boType: 3,
        round: 0,
        players: [
          {
            ...opponent.identity,
            socketId: opponent.socket.id,
            ready: true,
            score: 0,
            guesses: [],
            connected: true,
          },
          makePlayer(true),
        ],
        spectators: [],
        roundEndsAt: null,
      };
      rooms.set(room.id, room);
      opponent.socket.join(room.id);
      socket.join(room.id);
      ack?.({ queued: false });
      io.to(room.id).emit('match:found', { room: publicRoom(room) });
      await startRound(io, room);
    });

    socket.on('match:cancel', (_payload: unknown, ack?: Function) => {
      removeFromQueue(socket.id);
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      removeFromQueue(socket.id);
      removeSpectator(io, socket.id);
      const room = findMyRoom();
      if (!room) return;
      const mine = room.players.find((p) => p.key === me.key);
      if (!mine || mine.socketId !== socket.id) return;
      // 立即广播离线状态,对手马上可见
      mine.connected = false;
      io.to(room.id).emit('room:state', publicRoom(room));
      io.to(room.id).emit('player:offline', {
        key: me.key,
        name: me.name,
        graceMs: DISCONNECT_FORFEIT_MS,
      });
      if (room.status === 'playing' || room.status === 'round_over') {
        mine.disconnectTimer = setTimeout(() => {
          const opponent = room.players.find((p) => p.key !== me.key);
          void finishMatch(io, room, opponent?.key ?? null, 'disconnect_timeout');
        }, DISCONNECT_FORFEIT_MS);
      } else {
        room.players = room.players.filter((p) => p.key !== me.key);
        if (!room.players.length && !room.spectators.length) {
          rooms.delete(room.id);
        } else if (room.players.length) {
          if (room.hostKey === me.key) room.hostKey = room.players[0].key;
          io.to(room.id).emit('room:state', publicRoom(room));
        }
      }
    });
  });
}

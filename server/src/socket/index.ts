import { Server, Socket } from 'socket.io';
import { isIP } from 'net';
import { authenticateCookie, getGuestFromCookie } from '../middleware/auth';
import { consumeRateLimit } from '../middleware/rateLimit';
import { compareGuess, completeGuessFeedback, MAX_GUESSES } from '../services/gameService';
import { getPlayer, pickCachedTarget } from '../services/playerCache';
import {
  BoType,
  DbType,
  StoredIdentity,
  QueuedIdentity,
  StoredPlayer,
  StoredRoom,
  cancelQueue,
  claimDueSchedules,
  clearIdentityRoom,
  deleteRoom,
  getRoom,
  getRoomForIdentity,
  queueOrTakeOpponent,
  releaseRoomCapacity,
  reserveRoomCapacity,
  saveRoom,
  schedule,
  withRoomLock,
} from '../services/roomStore';
import { isRedisAvailable, redis, redisKey } from '../redis';
import { enqueueMatchResult } from '../services/matchResultQueue';
import { verifyPowCookie } from '../services/pow';
import { getPresenceStats, ONLINE_STALE_MS, PresenceStats } from '../services/presence';
import { GuessFeedback } from '../types';
import { config } from '../config';

const DISCONNECT_FORFEIT_MS = 30_000;
const NEXT_ROUND_DELAY_MS = 6_000;
const ROUND_TIME_MS = 120_000;
const FINISHED_ROOM_TTL_MS = 5 * 60_000;
const MAX_SPECTATORS = 100;
const MAX_CONNECTIONS_PER_IDENTITY = 3;
const MAX_CONNECTIONS_PER_IP = 20;
const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const localQueue = new Map<DbType, QueuedIdentity[]>();
const timers = new Map<string, NodeJS.Timeout>();

function validForwardedIp(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

/** Match Express `trust proxy = 1`: trust only the address appended by the nearest proxy. */
export function resolveSocketIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  realIp: string | string[] | undefined,
  trustProxy: boolean
): string {
  if (trustProxy) {
    const forwarded = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const nearestForwarded = forwarded?.split(',').at(-1);
    const fromForwarded = validForwardedIp(nearestForwarded);
    if (fromForwarded) return fromForwarded;

    const real = Array.isArray(realIp) ? realIp.at(-1) : realIp;
    const fromRealIp = validForwardedIp(real);
    if (fromRealIp) return fromRealIp;
  }
  return validForwardedIp(remoteAddress) ?? 'unknown';
}

function winsNeeded(bo: BoType): number {
  return Math.ceil(bo / 2);
}

function identityChannel(key: string): string {
  return `identity:${key}`;
}

function hiddenGuess(feedback: GuessFeedback) {
  const hideAttribute = ({ level, hint }: GuessFeedback['attributes']['team']) => ({
    level,
    ...(hint ? { hint } : {}),
  });
  return {
    hidden: true as const,
    correct: feedback.correct,
    attributes: {
      nationality: hideAttribute(feedback.attributes.nationality),
      region: hideAttribute(feedback.attributes.region),
      team: hideAttribute(feedback.attributes.team),
      age: hideAttribute(feedback.attributes.age),
      role: hideAttribute(feedback.attributes.role),
      majorChampionships: hideAttribute(feedback.attributes.majorChampionships),
      majorAppearances: hideAttribute(feedback.attributes.majorAppearances),
      isActive: hideAttribute(feedback.attributes.isActive),
    },
  };
}

function publicRoom(room: StoredRoom, viewerKey: string) {
  const viewerIsSpectator = room.spectators.some((spectator) => spectator.key === viewerKey);
  const target = room.targetPlayerId ? getPlayer(room.targetPlayerId) : undefined;
  return {
    id: room.id,
    hostKey: room.hostKey,
    status: room.status === 'starting' ? 'waiting' : room.status,
    dbType: room.dbType,
    boType: room.boType,
    allowSpectators: room.allowSpectators,
    round: room.round,
    winsNeeded: winsNeeded(room.boType),
    maxGuesses: MAX_GUESSES,
    roundEndsAt: room.roundEndsAt,
    roundId: room.round,
    spectators: room.spectators.map((s) => ({ key: s.key, name: s.name })),
    players: room.players.map((p) => {
      const guesses = p.guesses.map((feedback) => {
        const guess = getPlayer(feedback.playerId);
        return completeGuessFeedback(feedback, guess, target);
      });
      return {
        key: p.key,
        name: p.name,
        ready: p.ready,
        connected: p.connected,
        score: p.score,
        guessCount: guesses.length,
        guesses: viewerIsSpectator || p.key === viewerKey
          ? guesses
          : guesses.map(hiddenGuess),
      };
    }),
  };
}

function roomViewers(room: StoredRoom): string[] {
  return [...new Set([...room.players, ...room.spectators].map((member) => member.key))];
}

function emitRoomViews<T>(
  io: Server,
  room: StoredRoom,
  event: string,
  payload: (viewerKey: string) => T
): void {
  for (const viewerKey of roomViewers(room)) {
    io.to(identityChannel(viewerKey)).emit(event, payload(viewerKey));
  }
}

function emitRoomState(io: Server, room: StoredRoom): void {
  emitRoomViews(io, room, 'room:state', (viewerKey) => publicRoom(room, viewerKey));
}

function answerView(targetPlayerId: number | null) {
  const target = targetPlayerId ? getPlayer(targetPlayerId) : null;
  return target
    ? {
        nickname: target.nickname,
        team: target.team,
        nationality: target.nationality,
        role: target.role,
        majorChampionships: target.major_championships,
        majorAppearances: target.major_appearances,
      }
    : null;
}

async function genRoomId(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = Array.from(
      { length: 5 },
      () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]
    ).join('');
    if (!(await getRoom(id))) return id;
  }
  throw new Error('ROOM_ID_EXHAUSTED');
}

function makePlayer(identity: StoredIdentity, socketId: string, ready: boolean): StoredPlayer {
  return {
    ...identity,
    socketId,
    ready,
    score: 0,
    guesses: [],
    connected: true,
    disconnectDeadline: null,
  };
}

function setLocalTimer(key: string, delay: number, handler: () => void) {
  const old = timers.get(key);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    timers.delete(key);
    handler();
  }, Math.max(0, delay));
  timer.unref?.();
  timers.set(key, timer);
}

async function persistMatch(room: StoredRoom, winnerKey: string | null) {
  await enqueueMatchResult({
    roomId: room.id,
    boType: room.boType,
    winnerKey,
    players: room.players.map((player) => ({
      key: player.key,
      userId: player.userId,
      name: player.name,
      score: player.score,
    })),
  });
}

async function finishMatch(
  io: Server,
  roomId: string,
  winnerKey: string | null,
  reason: string
) {
  const result = await withRoomLock(roomId, (room) => {
    if (room.status === 'finished') return null;
    room.status = 'finished';
    room.roundEndsAt = null;
    room.nextRoundAt = null;
    room.eventResults = {};
    return structuredClone(room);
  });
  if (!result) return;
  await persistMatch(result, winnerKey);
  emitRoomViews(io, result, 'match:over', (viewerKey) => ({
    winnerKey,
    reason,
    answer: answerView(result.targetPlayerId),
    room: publicRoom(result, viewerKey),
  }));
  await schedule('cleanup', roomId, '0', Date.now() + FINISHED_ROOM_TTL_MS);
  setLocalTimer(`cleanup:${roomId}`, FINISHED_ROOM_TTL_MS, () => {
    void cleanupRoom(roomId);
  });
}

async function startRound(io: Server, roomId: string) {
  const result = await withRoomLock(roomId, (room) => {
    if (room.status !== 'waiting' && room.status !== 'round_over' && room.status !== 'starting') {
      return null;
    }
    const target = pickCachedTarget(room.dbType);
    if (!target) return { error: 'EMPTY_PLAYER_POOL' as const };
    room.status = 'playing';
    room.round += 1;
    room.targetPlayerId = target.id;
    room.roundEndsAt = Date.now() + ROUND_TIME_MS;
    room.nextRoundAt = null;
    for (const player of room.players) player.guesses = [];
    return { room: structuredClone(room) };
  });
  if (!result) return false;
  if ('error' in result) {
    io.to(roomId).emit('room:error', { code: result.error });
    return false;
  }
  const room = result.room;
  emitRoomViews(io, room, 'round:start', (viewerKey) => ({
    room: publicRoom(room, viewerKey),
  }));
  await schedule('round', roomId, String(room.round), room.roundEndsAt!);
  setLocalTimer(`round:${roomId}`, ROUND_TIME_MS, () => {
    void finishRound(io, roomId, null, 'timeout', room.round);
  });
  return true;
}

async function finishRound(
  io: Server,
  roomId: string,
  winnerKey: string | null,
  reason: 'guessed' | 'exhausted' | 'timeout',
  expectedRound: number
) {
  const result = await withRoomLock(roomId, (room) => {
    if (room.status !== 'playing' || room.round !== expectedRound) return null;
    const winner = room.players.find((p) => p.key === winnerKey);
    if (winner) winner.score += 1;
    room.roundEndsAt = null;
    const matchOver = Boolean(winner && winner.score >= winsNeeded(room.boType));
    if (matchOver) room.status = 'finished';
    else {
      room.status = 'round_over';
      room.nextRoundAt = Date.now() + NEXT_ROUND_DELAY_MS;
    }
    return { room: structuredClone(room), matchOver };
  });
  if (!result) return;
  const { room, matchOver } = result;
  emitRoomViews(io, room, 'round:over', (viewerKey) => ({
    winnerKey,
    reason,
    answer: answerView(room.targetPlayerId),
    matchOver,
    nextRoundInMs: matchOver ? undefined : NEXT_ROUND_DELAY_MS,
    room: publicRoom(room, viewerKey),
  }));
  if (matchOver) {
    await persistMatch(room, winnerKey);
    emitRoomViews(io, room, 'match:over', (viewerKey) => ({
      winnerKey,
      reason: 'score',
      answer: answerView(room.targetPlayerId),
      room: publicRoom(room, viewerKey),
    }));
    await schedule('cleanup', roomId, '0', Date.now() + FINISHED_ROOM_TTL_MS);
    return;
  }
  await schedule('next', roomId, String(room.round), room.nextRoundAt!);
  setLocalTimer(`next:${roomId}`, NEXT_ROUND_DELAY_MS, () => void startRound(io, roomId));
}

async function cleanupRoom(roomId: string) {
  const room = await getRoom(roomId);
  if (room?.status === 'finished') await deleteRoom(room);
}

async function processSchedule(io: Server, item: string) {
  const [kind, roomId, discriminator] = item.split('|');
  const room = await getRoom(roomId);
  if (!room) return;
  if (kind === 'round' && room.status === 'playing' && room.round === Number(discriminator)) {
    await finishRound(io, roomId, null, 'timeout', room.round);
  } else if (kind === 'next' && room.status === 'round_over' && room.round === Number(discriminator)) {
    await startRound(io, roomId);
  } else if (kind === 'disconnect') {
    const player = room.players.find((p) => p.key === discriminator);
    if (player && !player.connected && player.disconnectDeadline && player.disconnectDeadline <= Date.now()) {
      const opponent = room.players.find((p) => p.key !== discriminator);
      await finishMatch(io, roomId, opponent?.key ?? null, 'disconnect_timeout');
    }
  } else if (kind === 'cleanup') {
    await cleanupRoom(roomId);
  }
}

function safeOn(
  socket: Socket,
  event: string,
  handler: (payload: any, ack?: (value: any) => void) => Promise<void>
) {
  socket.on(event, (payload: any, ack?: (value: any) => void) => {
    void handler(payload, ack).catch((err) => {
      console.error(`[socket:${event}]`, err);
      ack?.({ code: err instanceof Error && err.message === 'ROOM_BUSY' ? 'ROOM_BUSY' : 'INTERNAL_ERROR' });
    });
  });
}

async function socketAllowed(event: string, identity: string, limit: number, seconds: number) {
  return consumeRateLimit(`socket:${event}`, identity, limit, seconds);
}

async function acquireConnectionSlot(ip: string, identity: string, socketId: string): Promise<boolean> {
  const client = redis();
  if (!client) return true;
  const result = await client.eval(
    `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
     redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
     local ipCount = redis.call('ZCARD', KEYS[1])
     local identityCount = redis.call('ZCARD', KEYS[2])
     if ipCount >= tonumber(ARGV[2]) or identityCount >= tonumber(ARGV[3]) then return 0 end
     redis.call('ZADD', KEYS[1], ARGV[4], ARGV[5])
     redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
     redis.call('ZADD', KEYS[3], ARGV[4], ARGV[6])
     redis.call('expire', KEYS[1], 900); redis.call('expire', KEYS[2], 900)
     return 1`,
    {
      keys: [
        redisKey(`connections:ip:${ip}`),
        redisKey(`connections:identity:${identity}`),
        redisKey('presence:online'),
      ],
      arguments: [
        String(Date.now() - ONLINE_STALE_MS),
        String(MAX_CONNECTIONS_PER_IP),
        String(MAX_CONNECTIONS_PER_IDENTITY),
        String(Date.now()),
        socketId,
        identity,
      ],
    }
  );
  return Number(result) === 1;
}

async function releaseConnectionSlot(ip: string, identity: string, socketId: string): Promise<void> {
  const client = redis();
  if (!client) return;
  await client.eval(
    `redis.call('ZREM', KEYS[1], ARGV[1])
     redis.call('ZREM', KEYS[2], ARGV[1])
     redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
     if redis.call('ZCARD', KEYS[2]) == 0 then
       redis.call('ZREM', KEYS[3], ARGV[2])
     else
       redis.call('ZADD', KEYS[3], ARGV[4], ARGV[2])
     end
     return 1`,
    {
      keys: [
        redisKey(`connections:ip:${ip}`),
        redisKey(`connections:identity:${identity}`),
        redisKey('presence:online'),
      ],
      arguments: [
        socketId,
        identity,
        String(Date.now() - ONLINE_STALE_MS),
        String(Date.now()),
      ],
    }
  );
}

async function refreshConnectionSlot(ip: string, identity: string, socketId: string): Promise<void> {
  const client = redis();
  if (!client) return;
  const now = Date.now();
  await client.multi()
    .zAdd(redisKey(`connections:ip:${ip}`), { score: now, value: socketId })
    .zAdd(redisKey(`connections:identity:${identity}`), { score: now, value: socketId })
    .zAdd(redisKey('presence:online'), { score: now, value: identity })
    .expire(redisKey(`connections:ip:${ip}`), 900)
    .expire(redisKey(`connections:identity:${identity}`), 900)
    .exec();
}

export function setupSocket(io: Server) {
  const presenceSubscribers = new Set<string>();
  let lastPresence: Omit<PresenceStats, 'updatedAt'> | null = null;
  const presenceWorker = setInterval(() => {
    if (!presenceSubscribers.size) return;
    void getPresenceStats().then((stats) => {
      const comparable = {
        onlineUsers: stats.onlineUsers,
        multiplayerRooms: stats.multiplayerRooms,
        singleGames: stats.singleGames,
      };
      if (lastPresence && JSON.stringify(lastPresence) === JSON.stringify(comparable)) return;
      lastPresence = comparable;
      for (const socketId of presenceSubscribers) io.to(socketId).emit('presence:stats', stats);
    }).catch((err) => console.error('[presence]', err));
  }, 1000);
  presenceWorker.unref?.();
  const presenceCleanupWorker = setInterval(() => {
    void getPresenceStats().catch((err) => console.error('[presence:cleanup]', err));
  }, 60_000);
  presenceCleanupWorker.unref?.();
  const worker = setInterval(() => {
    void claimDueSchedules().then((items) =>
      Promise.all(items.map((item) => processSchedule(io, item)))
    ).catch((err) => console.error('[schedule]', err));
  }, 1000);
  worker.unref?.();

  io.use(async (socket, next) => {
    if (!verifyPowCookie(
      socket.handshake.headers.cookie,
      socket.handshake.headers['user-agent']
    )) return next(new Error('POW_REQUIRED'));
    const user = await authenticateCookie(socket.handshake.headers.cookie);
    const guest = getGuestFromCookie(socket.handshake.headers.cookie);
    let identity: StoredIdentity | null = null;
    if (user) {
      identity = { key: `u:${user.id}`, userId: user.id, name: user.username };
    } else if (guest) {
      identity = {
        key: `g:${guest.key}`,
        userId: null,
        name: guest.name,
      };
    }
    if (!identity) return next(new Error('IDENTITY_REQUIRED'));
    const ip = resolveSocketIp(
      socket.handshake.address,
      socket.handshake.headers['x-forwarded-for'],
      socket.handshake.headers['x-real-ip'],
      config.trustProxy
    );
    if (!(await consumeRateLimit('socket:connect', `${ip}:${identity.key}`, 30, 60))) {
      return next(new Error('RATE_LIMITED'));
    }
    if (!(await acquireConnectionSlot(ip, identity.key, socket.id))) {
      return next(new Error('TOO_MANY_CONNECTIONS'));
    }
    socket.data.identity = identity;
    socket.data.ip = ip;
    socket.data.connectionSlot = true;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.identity as StoredIdentity;
    socket.emit('identity:self', { key: me.key });
    const connectionHeartbeat = setInterval(() => {
      void refreshConnectionSlot(String(socket.data.ip), me.key, socket.id);
    }, 60_000);
    connectionHeartbeat.unref?.();
    socket.join(identityChannel(me.key));
    void cancelQueue(me.key);

    const restorePromise = getRoomForIdentity(me.key).then(async (existing) => {
      if (!existing) return;
      await withRoomLock(existing.id, (room) => {
        const player = room.players.find((p) => p.key === me.key);
        const spectator = room.spectators.find((p) => p.key === me.key);
        if (player) {
          player.socketId = socket.id;
          player.connected = true;
          player.disconnectDeadline = null;
        } else if (spectator) spectator.socketId = socket.id;
      });
      socket.join(existing.id);
      const refreshed = await getRoom(existing.id);
      if (refreshed) emitRoomState(io, refreshed);
    }).catch((err) => console.error('[socket:reconnect]', err));

    safeOn(socket, 'room:sync', async (_payload, ack) => {
      await restorePromise;
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ code: 'NOT_IN_ROOM' });
      socket.join(room.id);
      ack?.({
        room: publicRoom(room, me.key),
        role: room.players.some((p) => p.key === me.key) ? 'player' : 'spectator',
        selfKey: me.key,
      });
    });

    safeOn(socket, 'presence:subscribe', async (_payload, ack) => {
      const user = await authenticateCookie(socket.handshake.headers.cookie);
      if (!user || user.role !== 'admin') return ack?.({ code: 'FORBIDDEN' });
      presenceSubscribers.add(socket.id);
      const stats = await getPresenceStats();
      socket.emit('presence:stats', stats);
      ack?.({ ok: true, stats });
    });

    safeOn(socket, 'presence:unsubscribe', async (_payload, ack) => {
      presenceSubscribers.delete(socket.id);
      ack?.({ ok: true });
    });

    safeOn(socket, 'room:create', async (payload, ack) => {
      if (!(await socketAllowed('create', me.key, 5, 60))) return ack?.({ code: 'RATE_LIMITED' });
      if (await getRoomForIdentity(me.key)) return ack?.({ code: 'ALREADY_IN_ROOM' });
      const boType = ([1, 3, 5, 7] as BoType[]).includes(payload?.boType) ? payload.boType : 3;
      const now = Date.now();
      const roomId = await genRoomId();
      if (!(await reserveRoomCapacity(String(socket.data.ip), roomId))) {
        return ack?.({ code: 'ROOM_CAPACITY_REACHED' });
      }
      const room: StoredRoom = {
        id: roomId,
        ownerIp: String(socket.data.ip),
        hostKey: me.key,
        status: 'waiting',
        dbType: payload?.dbType === 'normal' ? 'normal' : 'easy',
        boType,
        allowSpectators: payload?.allowSpectators === true,
        round: 0,
        players: [makePlayer(me, socket.id, true)],
        spectators: [],
        targetPlayerId: null,
        roundEndsAt: null,
        nextRoundAt: null,
        eventResults: {},
        createdAt: now,
        updatedAt: now,
      };
      try {
        await saveRoom(room);
      } catch (err) {
        await releaseRoomCapacity(room.ownerIp, room.id);
        throw err;
      }
      socket.join(room.id);
      ack?.({ room: publicRoom(room, me.key) });
    });

    safeOn(socket, 'room:join', async (payload, ack) => {
      if (!(await socketAllowed('join', me.key, 20, 60))) return ack?.({ code: 'RATE_LIMITED' });
      const roomId = String(payload?.roomId ?? '').toUpperCase();
      const current = await getRoomForIdentity(me.key);
      if (current && current.id !== roomId) return ack?.({ code: 'ALREADY_IN_ROOM' });
      const role = await withRoomLock(roomId, (room) => {
        if (room.status === 'finished') return { code: 'ROOM_NOT_FOUND' };
        const player = room.players.find((p) => p.key === me.key);
        if (player) {
          player.socketId = socket.id;
          player.connected = true;
          player.disconnectDeadline = null;
          return { role: 'player' as const };
        }
        const existingSpectator = room.spectators.find((p) => p.key === me.key);
        const asSpectator = Boolean(
          existingSpectator || payload?.spectate || room.status !== 'waiting' || room.players.length >= 2
        );
        if (asSpectator) {
          if (!existingSpectator && !room.allowSpectators) return { code: 'SPECTATING_DISABLED' };
          if (!existingSpectator && room.spectators.length >= MAX_SPECTATORS) return { code: 'ROOM_FULL' };
          if (existingSpectator) existingSpectator.socketId = socket.id;
          else room.spectators.push({ ...me, socketId: socket.id });
          return { role: 'spectator' as const };
        }
        room.players.push(makePlayer(me, socket.id, false));
        return { role: 'player' as const };
      });
      if (!role) return ack?.({ code: 'ROOM_NOT_FOUND' });
      if ('code' in role) return ack?.({ code: role.code });
      socket.join(roomId);
      const room = await getRoom(roomId);
      if (!room) return ack?.({ code: 'ROOM_NOT_FOUND' });
      emitRoomState(io, room);
      ack?.({ room: publicRoom(room, me.key), role: role.role });
    });

    safeOn(socket, 'room:ready', async (_payload, ack) => {
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ code: 'NOT_IN_WAITING_ROOM' });
      const changed = await withRoomLock(room.id, (locked) => {
        if (locked.status !== 'waiting') return false;
        const player = locked.players.find((p) => p.key === me.key);
        if (!player) return false;
        player.ready = !player.ready;
        return true;
      });
      if (!changed) return ack?.({ code: 'NOT_IN_WAITING_ROOM' });
      const refreshed = await getRoom(room.id);
      if (refreshed) emitRoomState(io, refreshed);
      ack?.({ ok: true });
    });

    safeOn(socket, 'game:start', async (_payload, ack) => {
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ code: 'ROOM_NOT_READY' });
      const result = await withRoomLock(room.id, (locked) => {
        if (locked.status !== 'waiting') return 'ROOM_NOT_READY';
        if (locked.hostKey !== me.key) return 'NOT_HOST';
        if (locked.players.length < 2) return 'NEED_TWO_PLAYERS';
        if (!locked.players.every((p) => p.ready)) return 'PLAYERS_NOT_READY';
        locked.status = 'starting';
        return 'OK';
      });
      if (result !== 'OK') return ack?.({ code: result ?? 'ROOM_NOT_READY' });
      const started = await startRound(io, room.id);
      ack?.(started ? { ok: true } : { code: 'EMPTY_PLAYER_POOL' });
    });

    safeOn(socket, 'game:guess', async (payload, ack) => {
      if (!(await socketAllowed('guess', me.key, 12, 10))) return ack?.({ code: 'RATE_LIMITED' });
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ code: 'NO_ACTIVE_ROUND' });
      const guess = getPlayer(Number(payload?.playerId));
      if (!guess) return ack?.({ code: 'PLAYER_NOT_FOUND' });
      const roundId = Number(payload?.roundId);
      const eventId = typeof payload?.eventId === 'string' ? payload.eventId : '';
      if (!Number.isInteger(roundId) || !/^[\w-]{16,80}$/.test(eventId)) {
        return ack?.({ code: 'VALIDATION_FAILED' });
      }
      const result = await withRoomLock(room.id, (locked) => {
        const eventKey = `${me.key}:${eventId}`;
        const previous = locked.eventResults[eventKey];
        if (previous) {
          return { duplicate: true, feedback: previous, round: locked.round, room: structuredClone(locked) };
        }
        if (locked.status !== 'playing' || !locked.targetPlayerId) return { code: 'NO_ACTIVE_ROUND' };
        if (locked.round !== roundId) return { code: 'STALE_ROUND' };
        if (locked.roundEndsAt && locked.roundEndsAt <= Date.now()) return { code: 'NO_ACTIVE_ROUND' };
        const player = locked.players.find((p) => p.key === me.key);
        if (!player) return { code: 'NO_ACTIVE_ROUND' };
        if (player.guesses.length >= MAX_GUESSES) return { code: 'GUESS_LIMIT_REACHED' };
        if (player.guesses.some((item) => item.playerId === guess.id)) return { code: 'ALREADY_GUESSED' };
        const target = getPlayer(locked.targetPlayerId);
        if (!target) return { code: 'INTERNAL_ERROR' };
        const feedback = compareGuess(guess, target);
        player.guesses.push(feedback);
        locked.eventResults[eventKey] = feedback;
        const shouldFinish = feedback.correct || locked.players.every(
          (candidate) => candidate.guesses.length >= MAX_GUESSES
        );
        let matchOver = false;
        if (shouldFinish) {
          if (feedback.correct) player.score += 1;
          matchOver = feedback.correct && player.score >= winsNeeded(locked.boType);
          locked.roundEndsAt = null;
          if (matchOver) locked.status = 'finished';
          else {
            locked.status = 'round_over';
            locked.nextRoundAt = Date.now() + NEXT_ROUND_DELAY_MS;
          }
        }
        return {
          feedback,
          round: locked.round,
          correct: feedback.correct,
          shouldFinish,
          matchOver,
          room: structuredClone(locked),
        };
      });
      if (!result || 'code' in result) return ack?.({ code: result?.code ?? 'NO_ACTIVE_ROUND' });
      ack?.({ feedback: result.feedback });
      if (!('duplicate' in result)) {
        emitRoomViews(io, result.room, 'game:guess:applied', (viewerKey) => ({
          roundId: result.round,
          key: me.key,
          feedback: viewerKey === me.key || result.room.spectators.some(
            (spectator) => spectator.key === viewerKey
          )
            ? result.feedback
            : hiddenGuess(result.feedback),
        }));
      }
      if (result.shouldFinish) {
        const winnerKey = result.correct ? me.key : null;
        const reason = result.correct ? 'guessed' : 'exhausted';
        emitRoomViews(io, result.room, 'round:over', (viewerKey) => ({
          winnerKey,
          reason,
          answer: answerView(result.room.targetPlayerId),
          matchOver: result.matchOver,
          nextRoundInMs: result.matchOver ? undefined : NEXT_ROUND_DELAY_MS,
          room: publicRoom(result.room, viewerKey),
        }));
        if (result.matchOver) {
          await persistMatch(result.room, winnerKey);
          emitRoomViews(io, result.room, 'match:over', (viewerKey) => ({
            winnerKey,
            reason: 'score',
            answer: answerView(result.room.targetPlayerId),
            room: publicRoom(result.room, viewerKey),
          }));
          await schedule('cleanup', room.id, '0', Date.now() + FINISHED_ROOM_TTL_MS);
        } else {
          await schedule('next', room.id, String(result.round), result.room.nextRoundAt!);
          setLocalTimer(`next:${room.id}`, NEXT_ROUND_DELAY_MS, () => void startRound(io, room.id));
        }
      }
    });

    safeOn(socket, 'room:leave', async (_payload, ack) => {
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ ok: true });
      const player = room.players.find((p) => p.key === me.key);
      if (player && (room.status === 'playing' || room.status === 'round_over' || room.status === 'starting')) {
        const opponent = room.players.find((p) => p.key !== me.key);
        await finishMatch(io, room.id, opponent?.key ?? null, 'opponent_left');
      } else {
        await withRoomLock(room.id, (locked) => {
          locked.players = locked.players.filter((p) => p.key !== me.key);
          locked.spectators = locked.spectators.filter((p) => p.key !== me.key);
          if (locked.players.length && locked.hostKey === me.key) locked.hostKey = locked.players[0].key;
          if (locked.players.length === 1) locked.players[0].ready = true;
        });
        await clearIdentityRoom(me.key);
        const refreshed = await getRoom(room.id);
        if (refreshed && !refreshed.players.length && !refreshed.spectators.length) await deleteRoom(refreshed);
        else if (refreshed) emitRoomState(io, refreshed);
      }
      socket.leave(room.id);
      ack?.({ ok: true });
    });

    safeOn(socket, 'match:start', async (payload, ack) => {
      if (!(await socketAllowed('match', me.key, 10, 60))) return ack?.({ code: 'RATE_LIMITED' });
      if (await getRoomForIdentity(me.key)) return ack?.({ code: 'ALREADY_IN_ROOM' });
      await cancelQueue(me.key);
      const dbType: DbType = payload?.dbType === 'normal' ? 'normal' : 'easy';
      const queuedMe: QueuedIdentity = { ...me, socketId: socket.id };
      let opponent = isRedisAvailable() ? await queueOrTakeOpponent(dbType, queuedMe) : null;
      if (isRedisAvailable() && !opponent) return ack?.({ queued: true });
      if (!isRedisAvailable() && !opponent) {
        const queue = localQueue.get(dbType) ?? [];
        opponent = queue.find((item) => item.key !== me.key) ?? null;
        if (opponent) localQueue.set(dbType, queue.filter((item) => item.key !== opponent!.key));
        else {
          localQueue.set(dbType, [...queue.filter((item) => item.key !== me.key), queuedMe]);
          return ack?.({ queued: true });
        }
      }
      if (!opponent) return ack?.({ queued: true });
      const now = Date.now();
      const roomId = await genRoomId();
      if (!(await reserveRoomCapacity(String(socket.data.ip), roomId))) {
        return ack?.({ code: 'ROOM_CAPACITY_REACHED' });
      }
      const room: StoredRoom = {
        id: roomId,
        ownerIp: String(socket.data.ip),
        hostKey: opponent.key,
        status: 'starting',
        dbType,
        boType: 3,
        allowSpectators: false,
        round: 0,
        players: [makePlayer(opponent, opponent.socketId, true), makePlayer(me, socket.id, true)],
        spectators: [],
        targetPlayerId: null,
        roundEndsAt: null,
        nextRoundAt: null,
        eventResults: {},
        createdAt: now,
        updatedAt: now,
      };
      try {
        await saveRoom(room);
      } catch (err) {
        await releaseRoomCapacity(room.ownerIp, room.id);
        throw err;
      }
      await io.in(identityChannel(opponent.key)).socketsJoin(room.id);
      socket.join(room.id);
      ack?.({ queued: false });
      emitRoomViews(io, room, 'match:found', (viewerKey) => ({
        room: publicRoom(room, viewerKey),
      }));
      await startRound(io, room.id);
    });

    safeOn(socket, 'match:cancel', async (_payload, ack) => {
      await cancelQueue(me.key);
      for (const [key, queue] of localQueue) {
        localQueue.set(key, queue.filter((item) => item.key !== me.key));
      }
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      presenceSubscribers.delete(socket.id);
      clearInterval(connectionHeartbeat);
      if (socket.data.connectionSlot) {
        socket.data.connectionSlot = false;
        void releaseConnectionSlot(String(socket.data.ip), me.key, socket.id);
      }
      void cancelQueue(me.key);
      for (const [key, queue] of localQueue) {
        localQueue.set(key, queue.filter((item) => item.key !== me.key));
      }
      void getRoomForIdentity(me.key).then(async (room) => {
        if (!room) return;
        const result = await withRoomLock(room.id, (locked) => {
          const spectator = locked.spectators.find((p) => p.key === me.key);
          if (spectator?.socketId === socket.id) {
            locked.spectators = locked.spectators.filter((p) => p.key !== me.key);
            return { spectator: true };
          }
          const player = locked.players.find((p) => p.key === me.key);
          if (!player || player.socketId !== socket.id) return null;
          if (locked.status === 'waiting') {
            locked.players = locked.players.filter((p) => p.key !== me.key);
            if (locked.players.length && locked.hostKey === me.key) locked.hostKey = locked.players[0].key;
            return { removed: true };
          }
          player.connected = false;
          player.disconnectDeadline = Date.now() + DISCONNECT_FORFEIT_MS;
          return { deadline: player.disconnectDeadline, room: structuredClone(locked) };
        });
        if (!result) return;
        if ('spectator' in result || 'removed' in result) {
          await clearIdentityRoom(me.key);
          const refreshed = await getRoom(room.id);
          if (refreshed && !refreshed.players.length && !refreshed.spectators.length) {
            await deleteRoom(refreshed);
          } else if (refreshed) emitRoomState(io, refreshed);
          return;
        }
        emitRoomState(io, result.room);
        io.to(room.id).emit('player:offline', {
          key: me.key,
          name: me.name,
          graceMs: DISCONNECT_FORFEIT_MS,
        });
        await schedule('disconnect', room.id, me.key, result.deadline);
        setLocalTimer(`disconnect:${room.id}:${me.key}`, DISCONNECT_FORFEIT_MS, () => {
          void processSchedule(io, `disconnect|${room.id}|${me.key}`);
        });
      }).catch((err) => console.error('[socket:disconnect]', err));
    });
  });

  return () => {
    clearInterval(worker);
    clearInterval(presenceWorker);
    clearInterval(presenceCleanupWorker);
    presenceSubscribers.clear();
  };
}

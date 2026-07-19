import { Server, Socket } from 'socket.io';
import { isIP } from 'net';
import { authenticateCookie, getGuestFromCookie } from '../middleware/auth';
import { consumeRateLimit } from '../middleware/rateLimit';
import { compareGuess, completeGuessFeedback, MAX_GUESSES } from '../services/gameService';
import { getEnabledPlayer, getPlayer, pickCachedTarget } from '../services/playerCache';
import {
  BoType,
  DbType,
  StoredIdentity,
  QueuedIdentity,
  StoredPlayer,
  StoredRoom,
  acknowledgeSchedule,
  beginMaintenanceWindow,
  cancelQueue,
  claimDueSchedules,
  clearIdentityRoom,
  deleteRoom,
  getRoom,
  getRoomForIdentity,
  getRoomIdForIdentity,
  getMaintenanceUntil,
  setRecoveryWindow,
  isSocketAlive,
  queueOrTakeOpponent,
  requeueCandidate,
  releaseRoomCapacity,
  reserveRoomCapacity,
  saveRoom,
  schedule,
  withRoomLock,
} from '../services/roomStore';
import { isRedisAvailable, redis, redisKey } from '../redis';
import { enqueueMatchResult } from '../services/matchResultQueue';
import { getPresenceStats, ONLINE_STALE_MS, PresenceStats } from '../services/presence';
import { GuessFeedback } from '../types';
import { config } from '../config';

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

function buildPublicRoom(room: StoredRoom, viewerKey: string) {
  const viewerIsSpectator = room.spectators.some((spectator) => spectator.key === viewerKey);
  const target = room.targetPlayerId ? getPlayer(room.targetPlayerId) : undefined;
  return {
    id: room.id,
    hostKey: room.hostKey,
    status: room.status === 'starting' ? 'waiting' : room.status,
    dbType: room.dbType,
    boType: room.boType,
    allowSpectators: room.allowSpectators,
    anonymous: room.anonymous,
    round: room.round,
    winsNeeded: winsNeeded(room.boType),
    maxGuesses: MAX_GUESSES,
    roundEndsAt: room.roundEndsAt,
    roundId: room.round,
    stateVersion: room.revision,
    spectators: room.spectators
      .filter((spectator) => spectator.connected)
      .map((spectator) => ({ key: spectator.key, name: spectator.name })),
    roundResult: room.roundResult
      ? {
          winnerKey: room.roundResult.winnerKey,
          reason: room.roundResult.reason,
          answer: answerView(room.targetPlayerId),
          matchOver: room.roundResult.matchOver,
          nextRoundInMs: room.roundResult.nextRoundAt
            ? Math.max(0, room.roundResult.nextRoundAt - Date.now())
            : undefined,
        }
      : null,
    matchResult: room.matchResult
      ? {
          winnerKey: room.matchResult.winnerKey,
          reason: room.matchResult.reason,
          answer: answerView(room.targetPlayerId),
        }
      : null,
    players: room.players.map((p, playerIndex) => {
      const guesses = p.guesses.map((feedback) => {
        const guess = getPlayer(feedback.playerId);
        return completeGuessFeedback(feedback, guess, target);
      });
      return {
        key: p.key,
        name: room.anonymous ? `玩家 ${playerIndex + 1}` : p.name,
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

type PublicRoom = ReturnType<typeof buildPublicRoom>;
const publicRoomCache = new WeakMap<StoredRoom, {
  revision: number;
  views: Map<string, PublicRoom>;
}>();

function publicRoom(room: StoredRoom, viewerKey: string): PublicRoom {
  const spectator = room.spectators.some((candidate) => candidate.key === viewerKey);
  const cacheKey = spectator ? 'spectator' : viewerKey;
  let cached = publicRoomCache.get(room);
  if (!cached || cached.revision !== room.revision) {
    cached = { revision: room.revision, views: new Map() };
    publicRoomCache.set(room, cached);
  }
  const existing = cached.views.get(cacheKey);
  if (existing) return existing;
  const view = buildPublicRoom(room, viewerKey);
  cached.views.set(cacheKey, view);
  return view;
}

function emitRoomViews<T>(
  io: Server,
  room: StoredRoom,
  event: string,
  payload: (viewerKey: string) => T
): void {
  for (const player of room.players) {
    io.to(identityChannel(player.key)).emit(event, payload(player.key));
  }
  if (room.spectators.length) {
    const channels = room.spectators.map((spectator) => identityChannel(spectator.key));
    io.to(channels).emit(event, payload(room.spectators[0].key));
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
  reason: string,
  actor?: { key: string; socketId: string }
): Promise<'finished' | 'stale' | 'ignored'> {
  const result = await withRoomLock(roomId, (room) => {
    if (actor) {
      const player = room.players.find((candidate) => candidate.key === actor.key);
      if (!player || player.socketId !== actor.socketId) return { stale: true as const };
    }
    if (room.status === 'finished') return null;
    room.status = 'finished';
    room.roundEndsAt = null;
    room.nextRoundAt = null;
    room.eventResults = {};
    room.roundResult = null;
    room.matchResult = { winnerKey, reason };
    return { room };
  }, (value) => Boolean(value && !('stale' in value)));
  if (!result) return 'ignored';
  if ('stale' in result) return 'stale';
  emitRoomViews(io, result.room, 'match:over', (viewerKey) => ({
    winnerKey,
    reason,
    answer: answerView(result.room.targetPlayerId),
    room: publicRoom(result.room, viewerKey),
  }));
  void persistMatch(result.room, winnerKey).catch((err) => console.error('[match:persist]', err));
  setLocalTimer(`cleanup:${roomId}`, FINISHED_ROOM_TTL_MS, () => {
    void cleanupRoom(roomId);
  });
  return 'finished';
}

async function startRound(io: Server, roomId: string) {
  const result = await withRoomLock(roomId, (room) => {
    if (room.status !== 'waiting' && room.status !== 'round_over' && room.status !== 'starting') {
      return null;
    }
    if (room.players.length < 2 || !room.players.every((player) => player.connected)) {
      return { waitingForReconnect: true as const };
    }
    const target = pickCachedTarget(room.dbType);
    if (!target) return { error: 'EMPTY_PLAYER_POOL' as const };
    room.status = 'playing';
    room.round += 1;
    room.targetPlayerId = target.id;
    room.roundEndsAt = Date.now() + ROUND_TIME_MS;
    room.nextRoundAt = null;
    room.eventResults = {};
    room.roundResult = null;
    room.matchResult = null;
    for (const player of room.players) player.guesses = [];
    return { room };
  }, (value) => Boolean(value && !('waitingForReconnect' in value)));
  if (!result) return false;
  if ('waitingForReconnect' in result) return false;
  if ('error' in result) {
    io.to(roomId).emit('room:error', { code: result.error });
    return false;
  }
  const room = result.room;
  emitRoomViews(io, room, 'round:start', (viewerKey) => ({
    room: publicRoom(room, viewerKey),
  }));
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
    room.roundResult = {
      round: room.round,
      winnerKey,
      reason,
      matchOver,
      nextRoundAt: room.nextRoundAt,
    };
    if (matchOver) room.matchResult = { winnerKey, reason: 'score' };
    return { room, matchOver };
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
    emitRoomViews(io, room, 'match:over', (viewerKey) => ({
      winnerKey,
      reason: 'score',
      answer: answerView(room.targetPlayerId),
      room: publicRoom(room, viewerKey),
    }));
    void persistMatch(room, winnerKey).catch((err) => console.error('[match:persist]', err));
    setLocalTimer(`cleanup:${roomId}`, FINISHED_ROOM_TTL_MS, () => {
      void cleanupRoom(roomId);
    });
    return;
  }
  setLocalTimer(`next:${roomId}`, NEXT_ROUND_DELAY_MS, () => void startRound(io, roomId));
}

async function surrenderRound(
  io: Server,
  roomId: string,
  loserKey: string,
  socketId: string,
  expectedRound: number
): Promise<{ room: StoredRoom; matchOver: boolean } | 'stale' | null> {
  const result = await withRoomLock(roomId, (room) => {
    if (room.status !== 'playing' || room.round !== expectedRound) return null;
    const loser = room.players.find((player) => player.key === loserKey);
    if (!loser || loser.socketId !== socketId) return { stale: true as const };
    const winner = room.players.find((player) => player.key !== loserKey);
    if (!winner) return null;

    winner.score += 1;
    room.roundEndsAt = null;
    const matchOver = winner.score >= winsNeeded(room.boType);
    if (matchOver) {
      room.status = 'finished';
      room.nextRoundAt = null;
      room.matchResult = { winnerKey: winner.key, reason: 'score' };
    } else {
      room.status = 'round_over';
      room.nextRoundAt = Date.now() + NEXT_ROUND_DELAY_MS;
    }
    room.roundResult = {
      round: room.round,
      winnerKey: winner.key,
      reason: 'surrender',
      matchOver,
      nextRoundAt: room.nextRoundAt,
    };
    return { room, matchOver };
  }, (value) => Boolean(value && !('stale' in value)));

  if (!result) return null;
  if ('stale' in result) return 'stale';
  const winnerKey = result.room.roundResult?.winnerKey ?? null;
  emitRoomViews(io, result.room, 'round:over', (viewerKey) => ({
    winnerKey,
    reason: 'surrender',
    answer: answerView(result.room.targetPlayerId),
    matchOver: result.matchOver,
    nextRoundInMs: result.matchOver ? undefined : NEXT_ROUND_DELAY_MS,
    room: publicRoom(result.room, viewerKey),
  }));
  if (result.matchOver) {
    emitRoomViews(io, result.room, 'match:over', (viewerKey) => ({
      winnerKey,
      reason: 'score',
      answer: answerView(result.room.targetPlayerId),
      room: publicRoom(result.room, viewerKey),
    }));
    void persistMatch(result.room, winnerKey).catch((err) => console.error('[match:persist]', err));
    setLocalTimer(`cleanup:${roomId}`, FINISHED_ROOM_TTL_MS, () => {
      void cleanupRoom(roomId);
    });
  } else {
    setLocalTimer(`next:${roomId}`, NEXT_ROUND_DELAY_MS, () => void startRound(io, roomId));
  }
  return result;
}

async function cleanupRoom(roomId: string) {
  const room = await getRoom(roomId);
  if (room?.status === 'finished') await deleteRoom(room);
}

async function processSchedule(io: Server, item: string): Promise<number | null> {
  const [kind, roomId, discriminator] = item.split('|');
  const room = await getRoom(roomId);
  if (!room) return null;
  if (kind === 'round' && room.status === 'playing' && room.round === Number(discriminator)) {
    await finishRound(io, roomId, null, 'timeout', room.round);
  } else if (kind === 'next' && room.status === 'round_over' && room.round === Number(discriminator)) {
    await startRound(io, roomId);
  } else if (kind === 'disconnect') {
    const maintenanceUntil = await getMaintenanceUntil();
    if (maintenanceUntil > Date.now()) return maintenanceUntil;
    const player = room.players.find((p) => p.key === discriminator);
    if (player && !player.connected && player.disconnectDeadline && player.disconnectDeadline <= Date.now()) {
      if (room.status === 'waiting') {
        const updated = await withRoomLock(roomId, (locked) => {
          const current = locked.players.find((candidate) => candidate.key === discriminator);
          if (
            !current ||
            current.connected ||
            !current.disconnectDeadline ||
            current.disconnectDeadline > Date.now()
          ) return null;
          locked.players = locked.players.filter((candidate) => candidate.key !== discriminator);
          if (locked.players.length && locked.hostKey === discriminator) {
            locked.hostKey = locked.players[0].key;
          }
          if (locked.players.length === 1) locked.players[0].ready = true;
          return { room: locked };
        }, (value) => Boolean(value));
        if (updated) {
          await clearIdentityRoom(discriminator, roomId);
          if (!updated.room.players.length && !updated.room.spectators.length) {
            await deleteRoom(updated.room);
          } else {
            emitRoomState(io, updated.room);
          }
        }
        return null;
      }
      const opponent = room.players.find((p) => p.key !== discriminator);
      if (opponent && !opponent.connected) {
        const retryAt = Math.max(
          player.disconnectDeadline,
          opponent.disconnectDeadline ?? player.disconnectDeadline
        );
        if (retryAt > Date.now()) return retryAt;
        await finishMatch(io, roomId, null, 'disconnect_timeout');
      } else {
        await finishMatch(io, roomId, opponent?.key ?? null, 'disconnect_timeout');
      }
    }
  } else if (kind === 'spectator') {
    const spectator = room.spectators.find((candidate) => candidate.key === discriminator);
    if (
      spectator &&
      !spectator.connected &&
      spectator.disconnectDeadline &&
      spectator.disconnectDeadline <= Date.now()
    ) {
      const updated = await withRoomLock(roomId, (locked) => {
        const current = locked.spectators.find((candidate) => candidate.key === discriminator);
        if (
          !current ||
          current.connected ||
          !current.disconnectDeadline ||
          current.disconnectDeadline > Date.now()
        ) return null;
        locked.spectators = locked.spectators.filter((candidate) => candidate.key !== discriminator);
        return { room: locked };
      }, (value) => Boolean(value));
      if (updated) {
        await clearIdentityRoom(discriminator, roomId);
        if (!updated.room.players.length && !updated.room.spectators.length) {
          await deleteRoom(updated.room);
        } else {
          emitRoomState(io, updated.room);
        }
      }
    }
  } else if (kind === 'cleanup') {
    await cleanupRoom(roomId);
  } else if (kind === 'persist') {
    if (room.status !== 'finished' || !room.matchResult) return null;
    await persistMatch(room, room.matchResult.winnerKey);
  }
  return null;
}

async function handleScheduledItem(io: Server, item: string): Promise<void> {
  let retryAt: number | null;
  try {
    retryAt = await processSchedule(io, item);
  } catch (err) {
    if (err instanceof Error && err.message === 'STALE_ROOM_WRITE') {
      await acknowledgeSchedule(item);
      return;
    }
    throw err;
  }
  if (retryAt) {
    const [kind, roomId, discriminator] = item.split('|');
    await schedule(kind, roomId, discriminator, retryAt);
    return;
  }
  await acknowledgeSchedule(item);
}

function safeOn(
  socket: Socket,
  event: string,
  handler: (payload: any, ack?: (value: any) => void) => Promise<void>
) {
  socket.on(event, (payload: any, ack?: (value: any) => void) => {
    void handler(payload, ack).catch((err) => {
      console.error(`[socket:${event}]`, err);
      const code = err instanceof Error && [
        'ROOM_BUSY',
        'REDIS_UNAVAILABLE',
        'STALE_ROOM_WRITE',
        'ROOM_IDENTITY_CONFLICT',
      ].includes(err.message)
        ? err.message === 'ROOM_IDENTITY_CONFLICT'
          ? 'ALREADY_IN_ROOM'
          : err.message === 'STALE_ROOM_WRITE' ? 'ROOM_BUSY' : err.message
        : 'INTERNAL_ERROR';
      ack?.({ code });
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
     redis.call('SET', KEYS[4], '1', 'EX', 180)
     redis.call('expire', KEYS[1], 900); redis.call('expire', KEYS[2], 900)
     return 1`,
    {
      keys: [
        redisKey(`connections:ip:${ip}`),
        redisKey(`connections:identity:${identity}`),
        redisKey('presence:online'),
        redisKey(`connections:socket:${socketId}`),
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
     redis.call('DEL', KEYS[4])
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
        redisKey(`connections:socket:${socketId}`),
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

async function refreshConnectionSlots(
  entries: { ip: string; identity: string; socketId: string }[]
): Promise<void> {
  if (!entries.length) return;
  const client = redis();
  if (!client) return;
  const now = Date.now();
  await client.eval(
    `for index = 2, #ARGV, 3 do
       local ip = ARGV[index]
       local identity = ARGV[index + 1]
       local socketId = ARGV[index + 2]
       local ipKey = KEYS[2] .. ip
       local identityKey = KEYS[3] .. identity
       redis.call('ZADD', ipKey, ARGV[1], socketId)
       redis.call('ZADD', identityKey, ARGV[1], socketId)
       redis.call('ZADD', KEYS[1], ARGV[1], identity)
       redis.call('SET', KEYS[4] .. socketId, '1', 'EX', 180)
       redis.call('EXPIRE', ipKey, 900)
       redis.call('EXPIRE', identityKey, 900)
     end
     return #ARGV`,
    {
      keys: [
        redisKey('presence:online'),
        redisKey('connections:ip:'),
        redisKey('connections:identity:'),
        redisKey('connections:socket:'),
      ],
      arguments: [
        String(now),
        ...entries.flatMap((entry) => [entry.ip, entry.identity, entry.socketId]),
      ],
    }
  );
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function processGroupsWithLimit(
  groups: string[][],
  limit: number,
  handler: (group: string[]) => Promise<void>
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, groups.length) }, async () => {
    while (cursor < groups.length) {
      const group = groups[cursor++];
      await handler(group);
      await yieldEventLoop();
    }
  }));
}

export function setupSocket(io: Server) {
  const backgroundTasks = new Set<Promise<unknown>>();
  const trackBackground = <T>(task: Promise<T>, label: string): void => {
    backgroundTasks.add(task);
    void task.catch((err) => console.error(label, err)).finally(() => backgroundTasks.delete(task));
  };
  const presenceSubscribers = new Set<string>();
  const heartbeatEntries = new Map<string, { ip: string; identity: string; socketId: string }>();
  let heartbeatRequest: Promise<void> | null = null;
  let lastPresence: Omit<PresenceStats, 'updatedAt'> | null = null;
  let presenceRequest: Promise<PresenceStats> | null = null;
  const presenceWorker = setInterval(() => {
    if (!presenceSubscribers.size) return;
    presenceRequest ??= getPresenceStats().finally(() => {
      presenceRequest = null;
    });
    void presenceRequest.then((stats) => {
      const comparable = {
        onlineUsers: stats.onlineUsers,
        multiplayerRooms: stats.multiplayerRooms,
        singleGames: stats.singleGames,
      };
      if (lastPresence && JSON.stringify(lastPresence) === JSON.stringify(comparable)) return;
      lastPresence = comparable;
      for (const socketId of presenceSubscribers) io.to(socketId).emit('presence:stats', stats);
    }).catch((err) => console.error('[presence]', err));
  }, 2000);
  presenceWorker.unref?.();
  const presenceCleanupWorker = setInterval(() => {
    void getPresenceStats().catch((err) => console.error('[presence:cleanup]', err));
  }, 60_000);
  presenceCleanupWorker.unref?.();
  let scheduleRequest: Promise<void> | null = null;
  const worker = setInterval(() => {
    if (scheduleRequest) return;
    scheduleRequest = claimDueSchedules(40)
      .then(async (items) => {
        const byRoom = new Map<string, string[]>();
        for (const item of items) {
          const roomId = item.split('|')[1] ?? '';
          const group = byRoom.get(roomId) ?? [];
          group.push(item);
          byRoom.set(roomId, group);
        }
        await processGroupsWithLimit([...byRoom.values()], 8, async (group) => {
          for (const item of group) await handleScheduledItem(io, item);
        });
      })
      .then(() => undefined)
      .catch((err) => console.error('[schedule]', err))
      .finally(() => {
        scheduleRequest = null;
      });
  }, 1000);
  worker.unref?.();
  const heartbeatWorker = setInterval(() => {
    if (heartbeatRequest) return;
    const entries = [...heartbeatEntries.values()];
    heartbeatRequest = (async () => {
      for (let index = 0; index < entries.length; index += 100) {
        await refreshConnectionSlots(entries.slice(index, index + 100));
        await yieldEventLoop();
      }
    })().catch((err) => console.error('[presence:heartbeat]', err)).finally(() => {
      heartbeatRequest = null;
    });
  }, 60_000);
  heartbeatWorker.unref?.();

  io.use(async (socket, next) => {
    try {
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
    } catch (err) {
      console.error('[socket:connect]', err);
      next(new Error(err instanceof Error && err.message === 'REDIS_UNAVAILABLE'
        ? 'REDIS_UNAVAILABLE'
        : 'INTERNAL_ERROR'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.identity as StoredIdentity;
    socket.emit('identity:self', { key: me.key });
    heartbeatEntries.set(socket.id, {
      ip: String(socket.data.ip),
      identity: me.key,
      socketId: socket.id,
    });
    socket.join(identityChannel(me.key));
    const restorePromise = getRoomForIdentity(me.key, true).then(async (existing) => {
      if (!existing) return;
      if (existing.status !== 'finished') {
        const restored = await withRoomLock(existing.id, (room) => {
          const player = room.players.find((p) => p.key === me.key);
          const spectator = room.spectators.find((p) => p.key === me.key);
          if (player) {
            player.socketId = socket.id;
            player.connected = true;
            player.disconnectDeadline = null;
            return true;
          }
          if (spectator) {
            spectator.socketId = socket.id;
            spectator.connected = true;
            spectator.disconnectDeadline = null;
            return true;
          }
          return false;
        }, (value) => value);
        if (!restored) {
          await clearIdentityRoom(me.key, existing.id);
          return;
        }
      }
      socket.join(existing.id);
      const refreshed = await getRoom(existing.id);
      if (refreshed) {
        emitRoomState(io, refreshed);
        if (
          refreshed.players.length === 2 &&
          refreshed.players.every((player) => player.connected) &&
          (
            refreshed.status === 'starting' ||
            (refreshed.status === 'round_over' && (refreshed.nextRoundAt ?? 0) <= Date.now())
          )
        ) {
          await startRound(io, refreshed.id);
        }
      }
    }).catch((err) => console.error('[socket:reconnect]', err));

    safeOn(socket, 'room:sync', async (_payload, ack) => {
      await restorePromise;
      const room = await getRoomForIdentity(me.key, true);
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
      await restorePromise;
      if (!(await socketAllowed('create', me.key, 5, 60))) return ack?.({ code: 'RATE_LIMITED' });
      const existing = await getRoomForIdentity(me.key);
      if (existing) return ack?.({
        code: 'ALREADY_IN_ROOM',
        room: publicRoom(existing, me.key),
        role: existing.players.some((player) => player.key === me.key) ? 'player' : 'spectator',
      });
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
        anonymous: payload?.anonymous === true,
        round: 0,
        players: [makePlayer(me, socket.id, true)],
        spectators: [],
        targetPlayerId: null,
        roundEndsAt: null,
        nextRoundAt: null,
        eventResults: {},
        roundResult: null,
        matchResult: null,
        revision: 0,
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
      await restorePromise;
      if (!(await socketAllowed('join', me.key, 20, 60))) return ack?.({ code: 'RATE_LIMITED' });
      const roomId = String(payload?.roomId ?? '').toUpperCase();
      const current = await getRoomForIdentity(me.key);
      if (current && current.id !== roomId) return ack?.({
        code: 'ALREADY_IN_ROOM',
        room: publicRoom(current, me.key),
        role: current.players.some((player) => player.key === me.key) ? 'player' : 'spectator',
      });
      const role = await withRoomLock(roomId, (room) => {
        if (room.status === 'finished') return { code: 'ROOM_NOT_FOUND' };
        const player = room.players.find((p) => p.key === me.key);
        if (player) {
          if (player.connected && player.socketId !== socket.id) {
            return { code: 'STALE_CONNECTION' };
          }
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
          if (existingSpectator && existingSpectator.socketId !== socket.id) {
            return { code: 'STALE_CONNECTION' };
          }
          if (existingSpectator) {
            existingSpectator.socketId = socket.id;
            existingSpectator.connected = true;
            existingSpectator.disconnectDeadline = null;
          } else {
            room.spectators.push({
              ...me,
              socketId: socket.id,
              connected: true,
              disconnectDeadline: null,
            });
          }
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

    safeOn(socket, 'room:ready', async (payload, ack) => {
      await restorePromise;
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ code: 'NOT_IN_WAITING_ROOM' });
      const changed = await withRoomLock(room.id, (locked) => {
        if (locked.status !== 'waiting') return false;
        const player = locked.players.find((p) => p.key === me.key);
        if (!player) return false;
        if (player.socketId !== socket.id) return 'STALE_CONNECTION' as const;
        player.ready = typeof payload?.ready === 'boolean' ? payload.ready : !player.ready;
        return true;
      });
      if (changed === 'STALE_CONNECTION') return ack?.({ code: changed });
      if (!changed) return ack?.({ code: 'NOT_IN_WAITING_ROOM' });
      const refreshed = await getRoom(room.id);
      if (refreshed) emitRoomState(io, refreshed);
      ack?.({ ok: true });
    });

    safeOn(socket, 'game:start', async (_payload, ack) => {
      await restorePromise;
      const room = await getRoomForIdentity(me.key);
      if (!room) return ack?.({ code: 'ROOM_NOT_READY' });
      const result = await withRoomLock(room.id, (locked) => {
        if (locked.hostKey !== me.key) return 'NOT_HOST';
        if (locked.players.find((player) => player.key === me.key)?.socketId !== socket.id) {
          return 'STALE_CONNECTION';
        }
        if (locked.status === 'starting' || locked.status === 'playing') return 'ALREADY_STARTED';
        if (locked.status !== 'waiting') return 'ROOM_NOT_READY';
        if (locked.players.length < 2) return 'NEED_TWO_PLAYERS';
        if (!locked.players.every((p) => p.ready && p.connected)) return 'PLAYERS_NOT_READY';
        locked.status = 'starting';
        return 'OK';
      });
      if (result === 'ALREADY_STARTED') {
        if (room.status === 'starting') await startRound(io, room.id);
        const current = await getRoom(room.id);
        return ack?.(current
          ? { ok: true, room: publicRoom(current, me.key) }
          : { code: 'ROOM_NOT_READY' });
      }
      if (result !== 'OK') return ack?.({ code: result ?? 'ROOM_NOT_READY' });
      const started = await startRound(io, room.id);
      ack?.(started ? { ok: true } : { code: 'EMPTY_PLAYER_POOL' });
    });

    safeOn(socket, 'game:guess', async (payload, ack) => {
      await restorePromise;
      if (!(await socketAllowed('guess', me.key, 12, 10))) return ack?.({ code: 'RATE_LIMITED' });
      const roomId = await getRoomIdForIdentity(me.key);
      if (!roomId) return ack?.({ code: 'NO_ACTIVE_ROUND', reason: 'identity_room_missing' });
      const guess = getEnabledPlayer(Number(payload?.playerId));
      if (!guess) return ack?.({ code: 'PLAYER_NOT_FOUND' });
      const roundId = Number(payload?.roundId);
      const eventId = typeof payload?.eventId === 'string' ? payload.eventId : '';
      if (!Number.isInteger(roundId) || !/^[\w-]{16,80}$/.test(eventId)) {
        return ack?.({ code: 'VALIDATION_FAILED' });
      }
      const result = await withRoomLock(roomId, (locked) => {
        const eventKey = `${me.key}:${eventId}`;
        const previousIndex = locked.eventResults[eventKey];
        if (previousIndex !== undefined) {
          const previousPlayer = locked.players.find((candidate) => candidate.key === me.key);
          const previous = previousPlayer?.guesses[previousIndex];
          if (!previous) return { code: 'NO_ACTIVE_ROUND', reason: 'event_result_missing', room: locked };
          return { duplicate: true, feedback: previous, round: locked.round, room: locked };
        }
        if (locked.status !== 'playing' || !locked.targetPlayerId) {
          return { code: 'NO_ACTIVE_ROUND', reason: 'round_not_playing', room: locked };
        }
        if (locked.round !== roundId) {
          return { code: 'STALE_ROUND', reason: 'round_id_mismatch', room: locked };
        }
        if (locked.roundEndsAt && locked.roundEndsAt <= Date.now()) {
          return { code: 'NO_ACTIVE_ROUND', reason: 'deadline_passed', room: locked };
        }
        const player = locked.players.find((p) => p.key === me.key);
        if (!player) {
          return { code: 'NO_ACTIVE_ROUND', reason: 'player_missing', room: locked };
        }
        if (player.socketId !== socket.id) {
          return { code: 'STALE_CONNECTION', room: locked };
        }
        if (player.guesses.length >= MAX_GUESSES) return { code: 'GUESS_LIMIT_REACHED' };
        if (player.guesses.some((item) => item.playerId === guess.id)) return { code: 'ALREADY_GUESSED' };
        const target = getPlayer(locked.targetPlayerId);
        if (!target) return { code: 'INTERNAL_ERROR' };
        const feedback = compareGuess(guess, target);
        player.guesses.push(feedback);
        locked.eventResults[eventKey] = player.guesses.length - 1;
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
          locked.roundResult = {
            round: locked.round,
            winnerKey: feedback.correct ? me.key : null,
            reason: feedback.correct ? 'guessed' : 'exhausted',
            matchOver,
            nextRoundAt: locked.nextRoundAt,
          };
          if (matchOver) locked.matchResult = { winnerKey: me.key, reason: 'score' };
        }
        return {
          feedback,
          round: locked.round,
          correct: feedback.correct,
          shouldFinish,
          matchOver,
          room: locked,
        };
      }, (value) => !('code' in value) && !('duplicate' in value));
      if (!result) return ack?.({ code: 'NO_ACTIVE_ROUND', reason: 'room_missing' });
      if ('code' in result) {
        if ('reason' in result && result.reason === 'deadline_passed') {
          await finishRound(io, roomId, null, 'timeout', roundId);
          const latest = await getRoom(roomId);
          return ack?.({
            code: result.code,
            reason: result.reason,
            room: latest ? publicRoom(latest, me.key) : undefined,
          });
        }
        if ('room' in result && result.room) {
          return ack?.({
            code: result.code,
            reason: 'reason' in result ? result.reason : undefined,
            room: publicRoom(result.room, me.key),
          });
        }
        return ack?.({ code: result.code });
      }
      ack?.({ feedback: result.feedback, room: publicRoom(result.room, me.key) });
      if (!('duplicate' in result)) {
        emitRoomViews(io, result.room, 'game:guess:applied', (viewerKey) => ({
          roomId: result.room.id,
          roundId: result.round,
          key: me.key,
          eventId,
          guessCount: result.room.players.find((player) => player.key === me.key)?.guesses.length ?? 0,
          stateVersion: result.room.revision,
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
          emitRoomViews(io, result.room, 'match:over', (viewerKey) => ({
            winnerKey,
            reason: 'score',
            answer: answerView(result.room.targetPlayerId),
            room: publicRoom(result.room, viewerKey),
          }));
          void persistMatch(result.room, winnerKey).catch((err) => console.error('[match:persist]', err));
          setLocalTimer(`cleanup:${roomId}`, FINISHED_ROOM_TTL_MS, () => {
            void cleanupRoom(roomId);
          });
        } else {
          setLocalTimer(`next:${roomId}`, NEXT_ROUND_DELAY_MS, () => void startRound(io, roomId));
        }
      }
    });

    safeOn(socket, 'game:surrender-round', async (payload, ack) => {
      await restorePromise;
      if (!(await socketAllowed('surrender', me.key, 5, 60))) {
        return ack?.({ code: 'RATE_LIMITED' });
      }
      const roomId = await getRoomIdForIdentity(me.key);
      if (!roomId) return ack?.({ code: 'NO_ACTIVE_ROUND' });
      const roundId = Number(payload?.roundId);
      if (!Number.isInteger(roundId) || roundId <= 0) {
        return ack?.({ code: 'VALIDATION_FAILED' });
      }
      const result = await surrenderRound(io, roomId, me.key, socket.id, roundId);
      if (result === 'stale') return ack?.({ code: 'STALE_CONNECTION' });
      if (!result) {
        const latest = await getRoom(roomId);
        return ack?.({
          code: latest?.round !== roundId ? 'STALE_ROUND' : 'NO_ACTIVE_ROUND',
          room: latest ? publicRoom(latest, me.key) : undefined,
        });
      }
      ack?.({ ok: true, room: publicRoom(result.room, me.key) });
    });

    safeOn(socket, 'room:leave', async (_payload, ack) => {
      await restorePromise;
      const room = await getRoomForIdentity(me.key, true);
      if (!room) return ack?.({ ok: true });
      if (room.status === 'finished') {
        await clearIdentityRoom(me.key, room.id);
        socket.leave(room.id);
        return ack?.({ ok: true });
      }
      const player = room.players.find((p) => p.key === me.key);
      if (player && (room.status === 'playing' || room.status === 'round_over' || room.status === 'starting')) {
        const opponent = room.players.find((p) => p.key !== me.key);
        const finished = await finishMatch(io, room.id, opponent?.key ?? null, 'opponent_left', {
          key: me.key,
          socketId: socket.id,
        });
        if (finished === 'stale') return ack?.({ code: 'STALE_CONNECTION' });
      } else {
        const left = await withRoomLock(room.id, (locked) => {
          const currentPlayer = locked.players.find((candidate) => candidate.key === me.key);
          const currentSpectator = locked.spectators.find((candidate) => candidate.key === me.key);
          if (
            (currentPlayer && currentPlayer.socketId !== socket.id) ||
            (currentSpectator && currentSpectator.socketId !== socket.id)
          ) return 'STALE_CONNECTION' as const;
          locked.players = locked.players.filter((p) => p.key !== me.key);
          locked.spectators = locked.spectators.filter((p) => p.key !== me.key);
          if (locked.players.length && locked.hostKey === me.key) locked.hostKey = locked.players[0].key;
          if (locked.players.length === 1) locked.players[0].ready = true;
          return 'LEFT' as const;
        });
        if (left === 'STALE_CONNECTION') return ack?.({ code: left });
        await clearIdentityRoom(me.key, room.id);
        const refreshed = await getRoom(room.id);
        if (refreshed && !refreshed.players.length && !refreshed.spectators.length) await deleteRoom(refreshed);
        else if (refreshed) emitRoomState(io, refreshed);
      }
      socket.leave(room.id);
      ack?.({ ok: true });
    });

    safeOn(socket, 'match:start', async (payload, ack) => {
      await restorePromise;
      if (!(await socketAllowed('match', me.key, 10, 60))) return ack?.({ code: 'RATE_LIMITED' });
      const currentRoom = await getRoomForIdentity(me.key);
      if (currentRoom) return ack?.({ queued: false, room: publicRoom(currentRoom, me.key) });
      await cancelQueue(me.key);
      const dbType: DbType = payload?.dbType === 'normal' ? 'normal' : 'easy';
      const queuedMe: QueuedIdentity = {
        ...me,
        socketId: socket.id,
        anonymous: payload?.anonymous === true,
      };
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
      if (!socket.connected) {
        await requeueCandidate(dbType, opponent);
        return;
      }
      const now = Date.now();
      const roomId = await genRoomId();
      if (!(await reserveRoomCapacity(String(socket.data.ip), roomId))) {
        await requeueCandidate(dbType, opponent);
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
        anonymous: Boolean(queuedMe.anonymous || opponent.anonymous),
        round: 0,
        players: [makePlayer(opponent, opponent.socketId, true), makePlayer(me, socket.id, true)],
        spectators: [],
        targetPlayerId: null,
        roundEndsAt: null,
        nextRoundAt: null,
        eventResults: {},
        roundResult: null,
        matchResult: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await saveRoom(room);
      } catch (err) {
        await Promise.allSettled([
          releaseRoomCapacity(room.ownerIp, room.id),
          requeueCandidate(dbType, opponent),
        ]);
        throw err;
      }
      const [opponentAlive, currentAlive] = await Promise.all([
        isSocketAlive(opponent.socketId),
        isSocketAlive(socket.id),
      ]);
      if (!opponentAlive || !currentAlive) {
        await withRoomLock(room.id, (locked) => {
          const deadline = Date.now() + config.disconnectForfeitMs;
          for (const player of locked.players) {
            const alive = player.key === me.key ? currentAlive : opponentAlive;
            if (!alive) {
              player.connected = false;
              player.disconnectDeadline = deadline;
            }
          }
        });
      }
      const savedRoom = await getRoom(room.id);
      if (!savedRoom) throw new Error('ROOM_NOT_FOUND');
      await io.in(identityChannel(opponent.key)).socketsJoin(room.id);
      socket.join(room.id);
      ack?.({ queued: false, room: publicRoom(savedRoom, me.key) });
      emitRoomViews(io, savedRoom, 'match:found', (viewerKey) => ({
        room: publicRoom(savedRoom, viewerKey),
      }));
      await startRound(io, savedRoom.id);
    });

    safeOn(socket, 'match:cancel', async (_payload, ack) => {
      await restorePromise;
      await cancelQueue(me.key);
      for (const [key, queue] of localQueue) {
        localQueue.set(key, queue.filter((item) => item.key !== me.key));
      }
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      presenceSubscribers.delete(socket.id);
      heartbeatEntries.delete(socket.id);
      if (socket.data.connectionSlot) {
        socket.data.connectionSlot = false;
        void releaseConnectionSlot(String(socket.data.ip), me.key, socket.id)
          .catch((err) => console.error('[presence:release]', err));
      }
      void cancelQueue(me.key, socket.id).catch((err) => console.error('[match:cancel-disconnect]', err));
      for (const [key, queue] of localQueue) {
        localQueue.set(
          key,
          queue.filter((item) => item.key !== me.key || item.socketId !== socket.id)
        );
      }
      const disconnectTask = getRoomForIdentity(me.key).then(async (room) => {
        if (!room) return;
        const result = await withRoomLock(room.id, (locked) => {
          const spectator = locked.spectators.find((p) => p.key === me.key);
          if (spectator?.socketId === socket.id) {
            spectator.connected = false;
            spectator.disconnectDeadline = Date.now() + config.disconnectForfeitMs;
            return { spectator: true, room: locked };
          }
          const player = locked.players.find((p) => p.key === me.key);
          if (!player || player.socketId !== socket.id) return null;
          player.connected = false;
          player.disconnectDeadline = Date.now() + config.disconnectForfeitMs;
          return { deadline: player.disconnectDeadline, room: locked };
        });
        if (!result) return;
        if ('spectator' in result || 'removed' in result) {
          if ('spectator' in result) {
            emitRoomState(io, result.room);
            return;
          }
          await clearIdentityRoom(me.key, room.id);
          const refreshed = await getRoom(room.id);
          if (refreshed && !refreshed.players.length && !refreshed.spectators.length) {
            await deleteRoom(refreshed);
          } else if (refreshed) emitRoomState(io, refreshed);
          return;
        }
        emitRoomState(io, result.room);
        io.to(room.id).emit('player:offline', {
          key: me.key,
          graceMs: config.disconnectForfeitMs,
        });
        setLocalTimer(`disconnect:${room.id}:${me.key}`, config.disconnectForfeitMs, () => {
          void handleScheduledItem(io, `disconnect|${room.id}|${me.key}`)
            .catch((err) => console.error('[disconnect:schedule]', err));
        });
      });
      trackBackground(disconnectTask, '[socket:disconnect]');
    });
  });

  return async () => {
    clearInterval(worker);
    clearInterval(heartbeatWorker);
    clearInterval(presenceWorker);
    clearInterval(presenceCleanupWorker);
    presenceSubscribers.clear();
    await Promise.allSettled([
      heartbeatRequest ?? Promise.resolve(),
      ...backgroundTasks,
    ]);
  };
}

export { beginMaintenanceWindow, setRecoveryWindow };

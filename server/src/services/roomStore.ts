import { randomUUID } from 'crypto';
import { redisKey, redisState } from '../redis';
import { GuessFeedback } from '../types';
import { config } from '../config';
import { logTransientError } from './transientLog';

export type BoType = 1 | 3 | 5 | 7;
export type DbType = 'easy' | 'normal';
export type RoomStatus = 'waiting' | 'starting' | 'playing' | 'round_over' | 'finished';

export interface StoredIdentity {
  key: string;
  userId: number | null;
  name: string;
}

export interface QueuedIdentity extends StoredIdentity {
  socketId: string;
  anonymous?: boolean;
}

export interface StoredPlayer extends StoredIdentity {
  socketId: string;
  ready: boolean;
  score: number;
  guesses: GuessFeedback[];
  connected: boolean;
  disconnectDeadline: number | null;
}

export interface StoredSpectator extends StoredIdentity {
  socketId: string;
  connected: boolean;
  disconnectDeadline: number | null;
}

export interface StoredRoundResult {
  round: number;
  winnerKey: string | null;
  reason: 'guessed' | 'exhausted' | 'timeout' | 'surrender';
  matchOver: boolean;
  nextRoundAt: number | null;
}

export interface StoredMatchResult {
  winnerKey: string | null;
  reason: string;
}

export interface StoredRoom {
  id: string;
  ownerIp: string;
  hostKey: string;
  status: RoomStatus;
  dbType: DbType;
  boType: BoType;
  allowSpectators: boolean;
  anonymous: boolean;
  round: number;
  players: StoredPlayer[];
  spectators: StoredSpectator[];
  targetPlayerId: number | null;
  roundEndsAt: number | null;
  nextRoundAt: number | null;
  eventResults: Record<string, number>;
  roundResult: StoredRoundResult | null;
  matchResult: StoredMatchResult | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

const ROOM_TTL_SECONDS = 6 * 60 * 60;
const FINISHED_ROOM_TTL_MS = 5 * 60_000;
const MAX_GLOBAL_ROOMS = 10_000;
const MAX_ROOMS_PER_IP = 50;
const localRooms = new Map<string, StoredRoom>();
const localIdentityRooms = new Map<string, string>();
const localLocks = new Map<string, Promise<void>>();

function roomKey(id: string) {
  return redisKey(`room:${id}`);
}

function identityKey(identity: string) {
  return redisKey(`identity-room:${identity}`);
}

function stateRedis() {
  const client = redisState();
  if (!client && config.redisRequired) throw new Error('REDIS_UNAVAILABLE');
  return client;
}

function normalizeRoom(room: StoredRoom): StoredRoom {
  if (typeof room.allowSpectators !== 'boolean') room.allowSpectators = false;
  if (typeof room.anonymous !== 'boolean') room.anonymous = false;
  room.eventResults ??= {};
  if (Object.values(room.eventResults).some((value) => typeof value !== 'number')) {
    room.eventResults = {};
  }
  room.roundResult ??= null;
  room.matchResult ??= null;
  room.revision ??= 0;
  for (const spectator of room.spectators) {
    spectator.connected ??= true;
    spectator.disconnectDeadline ??= null;
  }
  return room;
}

export async function getRoom(id: string): Promise<StoredRoom | null> {
  const client = stateRedis();
  if (!client) {
    const room = localRooms.get(id);
    return room ? structuredClone(normalizeRoom(room)) : null;
  }
  const raw = await client.get(roomKey(id));
  if (!raw) return null;
  return normalizeRoom(JSON.parse(raw) as StoredRoom);
}

export async function getRoomForIdentity(
  identity: string,
  includeFinished = false
): Promise<StoredRoom | null> {
  const id = await getRoomIdForIdentity(identity);
  if (!id) return null;
  const room = await getRoom(id);
  if (!room) {
    await clearIdentityRoom(identity, id);
    return null;
  }
  if (![...room.players, ...room.spectators].some((member) => member.key === identity)) {
    await clearIdentityRoom(identity, id);
    return null;
  }
  if (room.status === 'finished' && !includeFinished) return null;
  return room;
}

export async function getRoomIdForIdentity(identity: string): Promise<string | null> {
  const client = stateRedis();
  return client
    ? await client.get(identityKey(identity))
    : localIdentityRooms.get(identity) ?? null;
}

export async function saveRoom(room: StoredRoom): Promise<void> {
  if (room.status === 'finished' && !room.matchResult) {
    throw new Error('INVALID_FINISHED_ROOM');
  }
  const previousRevision = room.revision ?? 0;
  room.updatedAt = Date.now();
  room.revision = previousRevision + 1;
  const client = stateRedis();
  if (!client) {
    const current = localRooms.get(room.id);
    if (current && current.revision > previousRevision) throw new Error('STALE_ROOM_WRITE');
    const currentMembers = new Set(
      current ? [...current.players, ...current.spectators].map((member) => member.key) : []
    );
    for (const member of [...room.players, ...room.spectators]) {
      const mappedRoomId = localIdentityRooms.get(member.key);
      const mappedRoom = mappedRoomId ? localRooms.get(mappedRoomId) : null;
      if (
        mappedRoomId &&
        mappedRoomId !== room.id &&
        mappedRoom &&
        mappedRoom.status !== 'finished' &&
        !currentMembers.has(member.key)
      ) {
        room.revision = previousRevision;
        throw new Error('ROOM_IDENTITY_CONFLICT');
      }
    }
    localRooms.set(room.id, structuredClone(room));
    for (const member of [...room.players, ...room.spectators]) {
      const mappedRoomId = localIdentityRooms.get(member.key);
      const mappedRoom = mappedRoomId ? localRooms.get(mappedRoomId) : null;
      if (
        !mappedRoomId ||
        mappedRoomId === room.id ||
        !mappedRoom ||
        mappedRoom.status === 'finished'
      ) {
        localIdentityRooms.set(member.key, room.id);
      }
    }
    return;
  }
  const members = [...room.players, ...room.spectators];
  const schedules: { score: number; value: string }[] = [];
  if (room.status === 'playing' && room.roundEndsAt) {
    schedules.push({
      score: room.roundEndsAt,
      value: `round|${room.id}|${room.round}`,
    });
  } else if (room.status === 'round_over' && room.nextRoundAt) {
    schedules.push({
      score: room.nextRoundAt,
      value: `next|${room.id}|${room.round}`,
    });
  } else if (room.status === 'finished') {
    schedules.push(
      { score: Date.now(), value: `persist|${room.id}|0` },
      { score: Date.now() + FINISHED_ROOM_TTL_MS, value: `cleanup|${room.id}|0` }
    );
  }
  for (const player of room.players) {
    if (!player.connected && player.disconnectDeadline) {
      schedules.push({
        score: player.disconnectDeadline,
        value: `disconnect|${room.id}|${player.key}`,
      });
    }
  }
  for (const spectator of room.spectators) {
    if (!spectator.connected && spectator.disconnectDeadline) {
      schedules.push({
        score: spectator.disconnectDeadline,
        value: `spectator|${room.id}|${spectator.key}`,
      });
    }
  }
  const result = await client.eval(
    `local incoming = cjson.decode(ARGV[1])
     local currentRaw = redis.call('GET', KEYS[1])
     local current = nil
     local currentOk = false
     if currentRaw then
       currentOk, current = pcall(cjson.decode, currentRaw)
       if currentOk and tonumber(current.revision or 0) >= tonumber(incoming.revision or 0) then
         return 0
       end
     end
     local currentMembers = {}
     if currentOk then
       for _, member in ipairs(current.players or {}) do currentMembers[member.key] = true end
       for _, member in ipairs(current.spectators or {}) do currentMembers[member.key] = true end
     end
     local incomingMembers = {}
     for _, member in ipairs(incoming.players or {}) do table.insert(incomingMembers, member) end
     for _, member in ipairs(incoming.spectators or {}) do table.insert(incomingMembers, member) end
     for index, member in ipairs(incomingMembers) do
       local mappedRoomId = redis.call('GET', KEYS[3 + index])
       if mappedRoomId and mappedRoomId ~= ARGV[2] then
         local mappedRoomRaw = redis.call('GET', ARGV[8] .. mappedRoomId)
         if mappedRoomRaw then
           local mappedOk, mappedRoom = pcall(cjson.decode, mappedRoomRaw)
           if mappedOk and mappedRoom.status ~= 'finished' and not currentMembers[member.key] then
             return -1
           end
         end
       end
     end
     redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
     if ARGV[4] == '1' then
       redis.call('ZREM', KEYS[2], ARGV[2])
     else
       redis.call('ZADD', KEYS[2], ARGV[5], ARGV[2])
     end
     local identityCount = tonumber(ARGV[6])
     for index = 1, identityCount do
       local identityKey = KEYS[3 + index]
       local mappedRoomId = redis.call('GET', identityKey)
       local canClaim = not mappedRoomId or mappedRoomId == ARGV[2]
       if not canClaim then
         local mappedRoomRaw = redis.call('GET', ARGV[8] .. mappedRoomId)
         if not mappedRoomRaw then
           canClaim = true
         else
           local mappedOk, mappedRoom = pcall(cjson.decode, mappedRoomRaw)
           canClaim = not mappedOk or mappedRoom.status == 'finished'
         end
       end
       if canClaim then redis.call('SET', identityKey, ARGV[2], 'EX', ARGV[3]) end
     end
     local scheduleCount = tonumber(ARGV[7])
     local argumentIndex = 9
     for index = 1, scheduleCount do
       redis.call('ZADD', KEYS[3], ARGV[argumentIndex], ARGV[argumentIndex + 1])
       argumentIndex = argumentIndex + 2
     end
     return 1`,
    {
      keys: [
        roomKey(room.id),
        redisKey('presence:rooms'),
        redisKey('room:schedules'),
        ...members.map((member) => identityKey(member.key)),
      ],
      arguments: [
        JSON.stringify(room),
        room.id,
        String(ROOM_TTL_SECONDS),
        room.status === 'finished' ? '1' : '0',
        String(room.updatedAt + ROOM_TTL_SECONDS * 1000),
        String(members.length),
        String(schedules.length),
        redisKey('room:'),
        ...schedules.flatMap((item) => [String(item.score), item.value]),
      ],
    }
  );
  if (Number(result) === -1) {
    room.revision = previousRevision;
    throw new Error('ROOM_IDENTITY_CONFLICT');
  }
  if (Number(result) !== 1) throw new Error('STALE_ROOM_WRITE');
}

export async function deleteRoom(room: StoredRoom): Promise<void> {
  const identities = [...room.players, ...room.spectators].map((p) => p.key);
  const client = stateRedis();
  if (!client) {
    localRooms.delete(room.id);
    for (const identity of identities) {
      if (localIdentityRooms.get(identity) === room.id) localIdentityRooms.delete(identity);
    }
    return;
  }
  await client.eval(
    `redis.call('DEL', KEYS[1])
     redis.call('ZREM', KEYS[2], ARGV[1])
     redis.call('ZREM', KEYS[3], ARGV[1])
     redis.call('ZREM', KEYS[4], ARGV[1])
     for index = 5, #KEYS do
       if redis.call('GET', KEYS[index]) == ARGV[1] then redis.call('DEL', KEYS[index]) end
     end
     return 1`,
    {
      keys: [
        roomKey(room.id),
        redisKey('rooms:active'),
        redisKey(`rooms:active:ip:${room.ownerIp}`),
        redisKey('presence:rooms'),
        ...identities.map(identityKey),
      ],
      arguments: [room.id],
    }
  );
}

export async function reserveRoomCapacity(ip: string, roomId: string): Promise<boolean> {
  const client = stateRedis();
  if (!client) return true;
  const result = await client.eval(
    `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
     redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
     if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
     if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return 0 end
     redis.call('ZADD', KEYS[1], ARGV[4], ARGV[5])
     redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
     redis.call('expire', KEYS[2], ARGV[6])
     return 1`,
    {
      keys: [redisKey('rooms:active'), redisKey(`rooms:active:ip:${ip}`)],
      arguments: [
        String(Date.now() - ROOM_TTL_SECONDS * 1000),
        String(MAX_GLOBAL_ROOMS),
        String(MAX_ROOMS_PER_IP),
        String(Date.now()),
        roomId,
        String(ROOM_TTL_SECONDS),
      ],
    }
  );
  return Number(result) === 1;
}

export async function releaseRoomCapacity(ip: string, roomId: string): Promise<void> {
  const client = stateRedis();
  if (!client) return;
  await Promise.all([
    client.zRem(redisKey('rooms:active'), roomId),
    client.zRem(redisKey(`rooms:active:ip:${ip}`), roomId),
  ]);
}

export async function clearIdentityRoom(identity: string, expectedRoomId?: string): Promise<void> {
  if (!expectedRoomId || localIdentityRooms.get(identity) === expectedRoomId) {
    localIdentityRooms.delete(identity);
  }
  const client = stateRedis();
  if (!client) return;
  if (!expectedRoomId) {
    await client.del(identityKey(identity));
    return;
  }
  await client.eval(
    `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
     return 0`,
    { keys: [identityKey(identity)], arguments: [expectedRoomId] }
  );
}

async function acquireRedisLock(id: string): Promise<(() => Promise<void>) | null> {
  const client = stateRedis();
  if (!client) return null;
  const token = randomUUID();
  const key = redisKey(`lock:room:${id}`);
  const deadline = Date.now() + config.roomLockWaitMs;
  let attempt = 0;
  do {
    if (await client.set(key, token, { NX: true, PX: 15_000 })) {
      return async () => {
        await client.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          { keys: [key], arguments: [token] }
        );
      };
    }
    const delay = Math.min(50, 8 + attempt * 4) + Math.floor(Math.random() * 8);
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, delay));
  } while (Date.now() < deadline);
  throw new Error('ROOM_BUSY');
}

export async function withRoomLock<T>(
  id: string,
  handler: (room: StoredRoom) => Promise<T> | T,
  shouldSave: (result: T) => boolean = () => true
): Promise<T | null> {
  const releaseRedis = await acquireRedisLock(id);
  if (releaseRedis) {
    try {
      const room = await getRoom(id);
      if (!room) return null;
      const result = await handler(room);
      if (shouldSave(result)) {
        await saveRoom(room);
        syncResultRoomVersion(result, room);
      }
      return result;
    } finally {
      await releaseRedis().catch((err) => logTransientError('[room:lock-release]', err));
    }
  }

  const previous = localLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  localLocks.set(id, queued);
  await previous;
  try {
    const room = await getRoom(id);
    if (!room) return null;
    const result = await handler(room);
    if (shouldSave(result)) {
      await saveRoom(room);
      syncResultRoomVersion(result, room);
    }
    return result;
  } finally {
    release();
    if (localLocks.get(id) === queued) localLocks.delete(id);
  }
}

function syncResultRoomVersion<T>(result: T, room: StoredRoom): void {
  if (!result || typeof result !== 'object' || !('room' in result)) return;
  const snapshot = (result as { room?: StoredRoom }).room;
  if (!snapshot) return;
  snapshot.revision = room.revision;
  snapshot.updatedAt = room.updatedAt;
}

export async function queueOrTakeOpponent(
  dbType: DbType,
  identity: QueuedIdentity
): Promise<QueuedIdentity | null> {
  const client = stateRedis();
  if (!client) return null;
  const queueKey = redisKey(`matchmaking:${dbType}`);
  const profilePrefix = redisKey('match-profile:');
  const result = await client.eval(
    `local candidates = redis.call('ZRANGE', KEYS[1], 0, 20)
     for _, candidate in ipairs(candidates) do
       if candidate ~= ARGV[1] and redis.call('ZREM', KEYS[1], candidate) == 1 then
         local profile = redis.call('GET', ARGV[2] .. candidate)
         if profile then
           local decodedOk, decoded = pcall(cjson.decode, profile)
           if decodedOk and decoded.socketId and redis.call('EXISTS', ARGV[3] .. decoded.socketId) == 1 then
             redis.call('DEL', ARGV[2] .. candidate)
             return profile
           end
         end
         redis.call('DEL', ARGV[2] .. candidate)
       end
     end
     redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
     redis.call('SET', ARGV[2] .. ARGV[1], ARGV[5], 'EX', 300)
     return false`,
    {
      keys: [queueKey],
      arguments: [
        identity.key,
        profilePrefix,
        redisKey('connections:socket:'),
        String(Date.now()),
        JSON.stringify(identity),
      ],
    }
  );
  return typeof result === 'string' ? JSON.parse(result) as QueuedIdentity : null;
}

export async function requeueCandidate(dbType: DbType, identity: QueuedIdentity): Promise<void> {
  const client = stateRedis();
  if (!client) return;
  await client.eval(
    `if redis.call('EXISTS', KEYS[3]) == 0 then return 0 end
     redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
     redis.call('SET', KEYS[2], ARGV[3], 'EX', 300)
     return 1`,
    {
      keys: [
        redisKey(`matchmaking:${dbType}`),
        redisKey(`match-profile:${identity.key}`),
        redisKey(`connections:socket:${identity.socketId}`),
      ],
      arguments: [identity.key, String(Date.now()), JSON.stringify(identity)],
    }
  );
}

export async function isSocketAlive(socketId: string): Promise<boolean> {
  const client = stateRedis();
  if (!client) return true;
  return (await client.exists(redisKey(`connections:socket:${socketId}`))) === 1;
}

export async function cancelQueue(identity: string, socketId?: string): Promise<void> {
  const client = stateRedis();
  if (!client) return;
  if (socketId) {
    await client.eval(
      `local profile = redis.call('GET', KEYS[3])
       if not profile then return 0 end
       local decodedOk, decoded = pcall(cjson.decode, profile)
       if not decodedOk or decoded.socketId ~= ARGV[2] then return 0 end
       redis.call('ZREM', KEYS[1], ARGV[1])
       redis.call('ZREM', KEYS[2], ARGV[1])
       redis.call('DEL', KEYS[3])
       return 1`,
      {
        keys: [
          redisKey('matchmaking:easy'),
          redisKey('matchmaking:normal'),
          redisKey(`match-profile:${identity}`),
        ],
        arguments: [identity, socketId],
      }
    );
    return;
  }
  await Promise.all([
    client.zRem(redisKey('matchmaking:easy'), identity),
    client.zRem(redisKey('matchmaking:normal'), identity),
    client.del(redisKey(`match-profile:${identity}`)),
  ]);
}

export async function schedule(
  kind: string,
  roomId: string,
  discriminator: string,
  at: number
): Promise<boolean> {
  const client = stateRedis();
  if (!client) return false;
  await client.zAdd(redisKey('room:schedules'), {
    score: at,
    value: `${kind}|${roomId}|${discriminator}`,
  });
  return true;
}

export async function claimDueSchedules(limit = 100): Promise<string[]> {
  const client = stateRedis();
  if (!client) return [];
  const now = Date.now();
  return client.eval(
    `local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
     for _, item in ipairs(items) do
       redis.call('ZADD', KEYS[1], 'XX', ARGV[3], item)
     end
     return items`,
    {
      keys: [redisKey('room:schedules')],
      arguments: [String(now), String(limit), String(now + 15_000)],
    }
  ) as Promise<string[]>;
}

export async function acknowledgeSchedule(item: string): Promise<void> {
  await stateRedis()?.zRem(redisKey('room:schedules'), item);
}

export async function beginMaintenanceWindow(durationMs = 90_000): Promise<number> {
  const until = Date.now() + durationMs;
  const client = stateRedis();
  if (client) {
    await client.set(redisKey('maintenance:until'), String(until), {
      PX: durationMs,
    });
  }
  return until;
}

export async function getMaintenanceUntil(): Promise<number> {
  const client = stateRedis();
  if (!client) return 0;
  return Number(await client.get(redisKey('maintenance:until'))) || 0;
}

export async function setRecoveryWindow(durationMs: number): Promise<void> {
  const client = stateRedis();
  if (!client) return;
  if (durationMs <= 0) {
    await client.del(redisKey('maintenance:until'));
    return;
  }
  const until = Date.now() + durationMs;
  await client.set(redisKey('maintenance:until'), String(until), { PX: durationMs });
}

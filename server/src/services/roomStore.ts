import { randomUUID } from 'crypto';
import { redis, redisKey } from '../redis';
import { GuessFeedback } from '../types';

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
}

export interface StoredRoom {
  id: string;
  ownerIp: string;
  hostKey: string;
  status: RoomStatus;
  dbType: DbType;
  boType: BoType;
  round: number;
  players: StoredPlayer[];
  spectators: StoredSpectator[];
  targetPlayerId: number | null;
  roundEndsAt: number | null;
  nextRoundAt: number | null;
  eventResults: Record<string, GuessFeedback>;
  createdAt: number;
  updatedAt: number;
}

const ROOM_TTL_SECONDS = 6 * 60 * 60;
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

export async function getRoom(id: string): Promise<StoredRoom | null> {
  const client = redis();
  if (!client) return localRooms.get(id) ?? null;
  const raw = await client.get(roomKey(id));
  return raw ? JSON.parse(raw) as StoredRoom : null;
}

export async function getRoomForIdentity(identity: string): Promise<StoredRoom | null> {
  const client = redis();
  const id = client
    ? await client.get(identityKey(identity))
    : localIdentityRooms.get(identity);
  if (!id) return null;
  const room = await getRoom(id);
  if (!room || room.status === 'finished') {
    await clearIdentityRoom(identity);
    return null;
  }
  return room;
}

export async function saveRoom(room: StoredRoom): Promise<void> {
  room.updatedAt = Date.now();
  const client = redis();
  if (!client) {
    localRooms.set(room.id, structuredClone(room));
    for (const member of [...room.players, ...room.spectators]) {
      localIdentityRooms.set(member.key, room.id);
    }
    return;
  }
  const multi = client.multi();
  multi.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS });
  if (room.status === 'finished') {
    multi.zRem(redisKey('presence:rooms'), room.id);
  } else {
    multi.zAdd(redisKey('presence:rooms'), {
      score: room.updatedAt + ROOM_TTL_SECONDS * 1000,
      value: room.id,
    });
  }
  for (const member of [...room.players, ...room.spectators]) {
    multi.set(identityKey(member.key), room.id, { EX: ROOM_TTL_SECONDS });
  }
  await multi.exec();
}

export async function deleteRoom(room: StoredRoom): Promise<void> {
  const identities = [...room.players, ...room.spectators].map((p) => p.key);
  const client = redis();
  if (!client) {
    localRooms.delete(room.id);
    for (const identity of identities) localIdentityRooms.delete(identity);
    return;
  }
  await client.multi()
    .del([roomKey(room.id), ...identities.map(identityKey)])
    .zRem(redisKey('rooms:active'), room.id)
    .zRem(redisKey(`rooms:active:ip:${room.ownerIp}`), room.id)
    .zRem(redisKey('presence:rooms'), room.id)
    .exec();
}

export async function reserveRoomCapacity(ip: string, roomId: string): Promise<boolean> {
  const client = redis();
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
  const client = redis();
  if (!client) return;
  await Promise.all([
    client.zRem(redisKey('rooms:active'), roomId),
    client.zRem(redisKey(`rooms:active:ip:${ip}`), roomId),
  ]);
}

export async function clearIdentityRoom(identity: string): Promise<void> {
  localIdentityRooms.delete(identity);
  await redis()?.del(identityKey(identity));
}

async function acquireRedisLock(id: string): Promise<(() => Promise<void>) | null> {
  const client = redis();
  if (!client) return null;
  const token = randomUUID();
  const key = redisKey(`lock:room:${id}`);
  for (let attempt = 0; attempt < 25; attempt++) {
    if (await client.set(key, token, { NX: true, PX: 5000 })) {
      return async () => {
        await client.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          { keys: [key], arguments: [token] }
        );
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 2));
  }
  throw new Error('ROOM_BUSY');
}

export async function withRoomLock<T>(
  id: string,
  handler: (room: StoredRoom) => Promise<T> | T
): Promise<T | null> {
  const releaseRedis = await acquireRedisLock(id);
  if (releaseRedis) {
    try {
      const room = await getRoom(id);
      if (!room) return null;
      const result = await handler(room);
      await saveRoom(room);
      return result;
    } finally {
      await releaseRedis();
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
    await saveRoom(room);
    return result;
  } finally {
    release();
    if (localLocks.get(id) === queued) localLocks.delete(id);
  }
}

export async function queueOrTakeOpponent(
  dbType: DbType,
  identity: QueuedIdentity
): Promise<QueuedIdentity | null> {
  const client = redis();
  if (!client) return null;
  const queueKey = redisKey(`matchmaking:${dbType}`);
  const profilePrefix = redisKey('match-profile:');
  const result = await client.eval(
    `local candidates = redis.call('ZRANGE', KEYS[1], 0, 20)
     for _, candidate in ipairs(candidates) do
       if candidate ~= ARGV[1] and redis.call('ZREM', KEYS[1], candidate) == 1 then
         local profile = redis.call('GET', ARGV[2] .. candidate)
         redis.call('DEL', ARGV[2] .. candidate)
         if profile then return profile end
       end
     end
     redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
     redis.call('SET', ARGV[2] .. ARGV[1], ARGV[4], 'EX', 300)
     return false`,
    {
      keys: [queueKey],
      arguments: [identity.key, profilePrefix, String(Date.now()), JSON.stringify(identity)],
    }
  );
  return typeof result === 'string' ? JSON.parse(result) as QueuedIdentity : null;
}

export async function cancelQueue(identity: string): Promise<void> {
  const client = redis();
  if (!client) return;
  await Promise.all([
    client.zRem(redisKey('matchmaking:easy'), identity),
    client.zRem(redisKey('matchmaking:normal'), identity),
    client.del(redisKey(`match-profile:${identity}`)),
  ]);
}

export async function schedule(kind: string, roomId: string, discriminator: string, at: number) {
  const client = redis();
  if (!client) return;
  await client.zAdd(redisKey('room:schedules'), {
    score: at,
    value: `${kind}|${roomId}|${discriminator}`,
  });
}

export async function claimDueSchedules(limit = 100): Promise<string[]> {
  const client = redis();
  if (!client) return [];
  const result = await client.eval(
    `local items = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
     for _, item in ipairs(items) do redis.call('ZREM', KEYS[1], item) end
     return items`,
    {
      keys: [redisKey('room:schedules')],
      arguments: [String(Date.now()), String(limit)],
    }
  );
  return result as string[];
}

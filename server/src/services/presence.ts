import { evalCommandScript, redis, redisKey } from '../redis';

export const ONLINE_STALE_MS = 150_000;

export interface PresenceStats {
  onlineUsers: number;
  multiplayerRooms: number;
  singleGames: number;
  updatedAt: number;
}

export async function getPresenceStats(): Promise<PresenceStats> {
  const client = redis();
  if (!client) throw new Error('REDIS_UNAVAILABLE');
  const now = Date.now();
  const result = await evalCommandScript(
    'presence-stats-v1',
    `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
     redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
     redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
     return {
       redis.call('ZCARD', KEYS[1]),
       redis.call('ZCARD', KEYS[2]),
       redis.call('ZCARD', KEYS[3])
     }`,
    [
      redisKey('presence:online'),
      redisKey('presence:rooms'),
      redisKey('presence:single'),
    ],
    [String(now - ONLINE_STALE_MS), String(now)]
  ) as number[];
  return {
    onlineUsers: Number(result[0] ?? 0),
    multiplayerRooms: Number(result[1] ?? 0),
    singleGames: Number(result[2] ?? 0),
    updatedAt: now,
  };
}

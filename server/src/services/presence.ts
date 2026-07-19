import { redis, redisKey } from '../redis';
import { SINGLE_GAME_TTL_SECONDS } from './singleGameStore';

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
  const result = await client.eval(
    `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
     redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
     redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[2])
     local singleIds = redis.call('ZRANGE', KEYS[3], 0, -1)
     for _, gameId in ipairs(singleIds) do
       local gameKey = ARGV[3] .. gameId
       local raw = redis.call('GET', gameKey)
       local stale = not raw
       local game = nil
       if raw then
         local ok, decoded = pcall(cjson.decode, raw)
         if ok then
           game = decoded
           stale = not game.lastActiveAt or tonumber(game.lastActiveAt) <= tonumber(ARGV[4])
         else
           stale = true
         end
       end
       if stale then
         redis.call('ZREM', KEYS[3], gameId)
         redis.call('DEL', gameKey)
         if game and game.identityKey and game.mode then
           local activeKey = ARGV[5] .. game.identityKey .. ':' .. game.mode
           if redis.call('GET', activeKey) == gameId then redis.call('DEL', activeKey) end
         end
       end
     end
     return {
       redis.call('ZCARD', KEYS[1]),
       redis.call('ZCARD', KEYS[2]),
       redis.call('ZCARD', KEYS[3])
     }`,
    {
      keys: [
        redisKey('presence:online'),
        redisKey('presence:rooms'),
        redisKey('presence:single'),
      ],
      arguments: [
        String(now - ONLINE_STALE_MS),
        String(now),
        redisKey('single:game:'),
        String(now - SINGLE_GAME_TTL_SECONDS * 1000),
        redisKey('single:active:'),
      ],
    }
  ) as number[];
  return {
    onlineUsers: Number(result[0] ?? 0),
    multiplayerRooms: Number(result[1] ?? 0),
    singleGames: Number(result[2] ?? 0),
    updatedAt: now,
  };
}

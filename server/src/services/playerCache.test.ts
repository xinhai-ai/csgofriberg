import { describe, expect, it } from 'vitest';
import { initRedis, redis, redisKey } from '../redis';
import { invalidatePlayerCache } from './playerCache';

describe('player cache invalidation', () => {
  it('does not increment the legacy SHA version key', async () => {
    await initRedis();
    const client = redis()!;
    await client.set(redisKey('players:version'), '0123456789abcdef');
    await client.del(redisKey('players:revision:v2'));
    await expect(invalidatePlayerCache()).resolves.toBeUndefined();
    expect(await client.get(redisKey('players:version'))).toBe('0123456789abcdef');
    expect(await client.get(redisKey('players:revision:v2'))).toBe('1');
  });
});

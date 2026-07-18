import { randomUUID } from 'crypto';
import { redis, redisKey } from '../redis';

const localLocks = new Map<string, Promise<void>>();

export async function withKeyLock<T>(key: string, handler: () => Promise<T>): Promise<T> {
  const client = redis();
  if (client) {
    const lockKey = redisKey(`lock:${key}`);
    const token = randomUUID();
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await client.set(lockKey, token, { NX: true, PX: 5000 })) {
        try {
          return await handler();
        } finally {
          await client.eval(
            'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
            { keys: [lockKey], arguments: [token] }
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 2));
    }
    throw new Error('RESOURCE_BUSY');
  }

  const previous = localLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  localLocks.set(key, queued);
  await previous;
  try {
    return await handler();
  } finally {
    release();
    if (localLocks.get(key) === queued) localLocks.delete(key);
  }
}

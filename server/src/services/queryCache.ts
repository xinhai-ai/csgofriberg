import { redis, redisKey } from '../redis';

const local = new Map<string, { value: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const fullKey = redisKey(`cache:${key}`);
  const client = redis();
  if (client) {
    const hit = await client.get(fullKey);
    if (hit) return JSON.parse(hit) as T;
  } else {
    const hit = local.get(fullKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }
  const existingLoad = inFlight.get(fullKey);
  if (existingLoad) return existingLoad as Promise<T>;

  const load = loader().then(async (value) => {
    if (client) await client.set(fullKey, JSON.stringify(value), { EX: ttlSeconds });
    else local.set(fullKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return value;
  }).finally(() => {
    if (inFlight.get(fullKey) === load) inFlight.delete(fullKey);
  });
  inFlight.set(fullKey, load);
  return load;
}

export async function invalidateCached(...keys: string[]): Promise<void> {
  const fullKeys = keys.map((key) => redisKey(`cache:${key}`));
  const client = redis();
  if (client && fullKeys.length) await client.del(fullKeys);
  for (const key of fullKeys) local.delete(key);
}

import { redis, redisKey } from '../redis';

export interface ResourceVersionNotice {
  version: string;
  broadcastAt: number;
}

const RESOURCE_VERSION_PATTERN = /^\d{13}$/;

export function isValidResourceVersion(value: unknown): value is string {
  return typeof value === 'string'
    && RESOURCE_VERSION_PATTERN.test(value)
    && Number.isSafeInteger(Number(value))
    && Number(value) > 0;
}

export function parseResourceVersionNotice(value: string | null): ResourceVersionNotice | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ResourceVersionNotice>;
    if (!isValidResourceVersion(parsed.version)) return null;
    if (!Number.isSafeInteger(parsed.broadcastAt) || Number(parsed.broadcastAt) <= 0) return null;
    return { version: parsed.version, broadcastAt: Number(parsed.broadcastAt) };
  } catch {
    return null;
  }
}

export async function getResourceVersionNotice(): Promise<ResourceVersionNotice | null> {
  const client = redis();
  if (!client) return null;
  return parseResourceVersionNotice(await client.get(redisKey('resource:version')));
}

export async function publishResourceVersion(version: string): Promise<ResourceVersionNotice> {
  if (!isValidResourceVersion(version)) throw new Error('INVALID_RESOURCE_VERSION');
  const client = redis();
  if (!client) throw new Error('REDIS_UNAVAILABLE');
  const notice = { version, broadcastAt: Date.now() };
  await client.set(redisKey('resource:version'), JSON.stringify(notice));
  return notice;
}

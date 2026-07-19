import { createClient, RedisClientType } from 'redis';
import { config } from './config';

type Client = RedisClientType<any, any, any, 2>;

let commandClient: Client | null = null;
let stateClient: Client | null = null;
let publisherClient: Client | null = null;
let subscriberClient: Client | null = null;
let available = false;
let duplicateIndex = 0;
const errorLogTimes = new Map<string, number>();

function logClientError(label: string, err: unknown): void {
  const now = Date.now();
  const previous = errorLogTimes.get(label) ?? 0;
  if (now - previous < 5_000) return;
  errorLogTimes.set(label, now);
  console.error(`[redis:${label}]`, err instanceof Error ? err.message : err);
}

function attachClientEvents(client: Client, label: string, affectsAvailability = false): Client {
  client.on('error', (err) => {
    if (affectsAvailability) available = false;
    logClientError(label, err);
  });
  if (affectsAvailability) client.on('ready', () => {
    available = true;
  });
  return client;
}

function makeClient(label: string): Client {
  return attachClientEvents(
    createClient({ url: config.redisUrl, RESP: 2 }) as Client,
    label,
    true
  );
}

function duplicateClient(label: string): Client {
  if (!commandClient) throw new Error('REDIS_NOT_INITIALIZED');
  return attachClientEvents(commandClient.duplicate() as Client, label);
}

export function redisKey(key: string): string {
  return `${config.redisPrefix}${key}`;
}

export async function initRedis(): Promise<boolean> {
  if (commandClient?.isReady) return true;
  commandClient = makeClient('command');
  stateClient = duplicateClient('state');
  publisherClient = duplicateClient('publisher');
  subscriberClient = duplicateClient('subscriber');
  try {
    await Promise.all([
      commandClient.connect(),
      stateClient.connect(),
      publisherClient.connect(),
      subscriberClient.connect(),
    ]);
    available = true;
    console.log(`[redis] connected: ${config.redisUrl}`);
    return true;
  } catch (err) {
    available = false;
    await closeRedis();
    if (config.redisRequired) throw err;
    console.warn('[redis] unavailable, single-instance fallback enabled');
    return false;
  }
}

export function isRedisAvailable(): boolean {
  return available && Boolean(commandClient?.isReady && stateClient?.isReady);
}

export function redis(): Client | null {
  if (!isRedisAvailable() || !commandClient) return null;
  return commandClient.withCommandOptions({ timeout: config.redisCommandTimeoutMs }) as Client;
}

/** Isolate room and matchmaking state from HTTP, presence, and rate-limit traffic. */
export function redisState(): Client | null {
  if (!isRedisAvailable() || !stateClient) return null;
  return stateClient.withCommandOptions({ timeout: config.redisCommandTimeoutMs }) as Client;
}

export function redisPublisher(): Client | null {
  return publisherClient?.isReady ? publisherClient : null;
}

export function redisSubscriber(): Client | null {
  return subscriberClient?.isReady ? subscriberClient : null;
}

export function duplicateRedisClient(label?: string): Client | null {
  return commandClient?.isReady
    ? duplicateClient(label || `duplicate-${++duplicateIndex}`)
    : null;
}

export function isRedisTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError' || err.message.includes('TimeoutError')) return true;
  return 'cause' in err && isRedisTimeoutError(err.cause);
}

export async function closeRedis(): Promise<void> {
  const clients = [subscriberClient, publisherClient, stateClient, commandClient].filter(
    (client): client is Client => Boolean(client)
  );
  await Promise.allSettled(clients.map((client) => (client.isOpen ? client.quit() : undefined)));
  commandClient = null;
  stateClient = null;
  publisherClient = null;
  subscriberClient = null;
  available = false;
}

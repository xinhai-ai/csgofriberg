import { createClient, RedisClientType } from 'redis';
import { config } from './config';

type Client = RedisClientType<any, any, any, 2>;

let commandClient: Client | null = null;
let publisherClient: Client | null = null;
let subscriberClient: Client | null = null;
let available = false;

function makeClient(label: string): Client {
  const client = createClient({ url: config.redisUrl, RESP: 2 });
  client.on('error', (err) => {
    available = false;
    console.error(`[redis:${label}]`, err instanceof Error ? err.message : err);
  });
  client.on('ready', () => {
    available = true;
  });
  return client as Client;
}

export function redisKey(key: string): string {
  return `${config.redisPrefix}${key}`;
}

export async function initRedis(): Promise<boolean> {
  if (commandClient?.isReady) return true;
  commandClient = makeClient('command');
  publisherClient = commandClient.duplicate() as Client;
  subscriberClient = commandClient.duplicate() as Client;
  try {
    await Promise.all([
      commandClient.connect(),
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
  return available && Boolean(commandClient?.isReady);
}

export function redis(): Client | null {
  return isRedisAvailable() ? commandClient : null;
}

export function redisPublisher(): Client | null {
  return publisherClient?.isReady ? publisherClient : null;
}

export function redisSubscriber(): Client | null {
  return subscriberClient?.isReady ? subscriberClient : null;
}

export function duplicateRedisClient(): Client | null {
  return commandClient?.isReady ? commandClient.duplicate() as Client : null;
}

export async function closeRedis(): Promise<void> {
  const clients = [subscriberClient, publisherClient, commandClient].filter(
    (client): client is Client => Boolean(client)
  );
  await Promise.allSettled(clients.map((client) => (client.isOpen ? client.quit() : undefined)));
  commandClient = null;
  publisherClient = null;
  subscriberClient = null;
  available = false;
}

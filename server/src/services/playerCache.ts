import { db } from '../db/knex';
import { redis, redisKey, redisPublisher, redisSubscriber } from '../redis';
import { Player } from '../types';
import { EASY_MIN_MAJORS } from './gameService';

const INVALIDATE_CHANNEL = redisKey('players:invalidate');
const VERSION_KEY = redisKey('players:version');
const LIST_KEY = redisKey('players:list');

let playersById = new Map<number, Player>();
let allPlayers: Player[] = [];
let easyPlayers: Player[] = [];
let version = '1';
let refreshPromise: Promise<void> | null = null;

export async function refreshPlayerCache(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const rows = await db<Player>('players').orderBy('nickname');
    allPlayers = rows;
    easyPlayers = rows.filter((p) => p.major_appearances >= EASY_MIN_MAJORS);
    playersById = new Map(rows.map((p) => [p.id, p]));

    const client = redis();
    if (client) {
      version = (await client.get(VERSION_KEY)) || version;
      await client.set(
        LIST_KEY,
        JSON.stringify({
          version,
          players: rows.map((p) => ({ id: p.id, nickname: p.nickname })),
        }),
        { EX: 24 * 60 * 60 }
      );
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function initPlayerCache(): Promise<void> {
  const client = redis();
  if (client) {
    version = (await client.get(VERSION_KEY)) || '1';
    await client.set(VERSION_KEY, version, { NX: true });
    const subscriber = redisSubscriber();
    if (subscriber) {
      await subscriber.subscribe(INVALIDATE_CHANNEL, async (nextVersion) => {
        version = nextVersion || version;
        await refreshPlayerCache().catch((err) => console.error('[players] refresh failed', err));
      });
    }
  }
  await refreshPlayerCache();
}

export function getPlayer(id: number): Player | undefined {
  return playersById.get(id);
}

export function pickCachedTarget(mode: 'easy' | 'normal'): Player | null {
  const pool = mode === 'easy' ? easyPlayers : allPlayers;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export async function getPublicPlayerList(): Promise<{
  version: string;
  players: { id: number; nickname: string }[];
}> {
  const client = redis();
  if (client) {
    const cached = await client.get(LIST_KEY);
    if (cached) return JSON.parse(cached);
  }
  return {
    version,
    players: allPlayers.map((p) => ({ id: p.id, nickname: p.nickname })),
  };
}

export async function invalidatePlayerCache(): Promise<void> {
  const client = redis();
  if (client) {
    version = String(await client.incr(VERSION_KEY));
    await client.del(LIST_KEY);
    await redisPublisher()?.publish(INVALIDATE_CHANNEL, version);
  } else {
    version = String(Number(version) + 1);
  }
  await refreshPlayerCache();
}

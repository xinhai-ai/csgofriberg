import { db } from '../db/knex';
import { redis, redisKey, redisPublisher, redisSubscriber } from '../redis';
import { Player } from '../types';

const INVALIDATE_CHANNEL = redisKey('players:invalidate');
// v1 stored a SHA string and cannot be incremented safely during rolling upgrades.
const VERSION_KEY = redisKey('players:revision:v2');
const REFRESH_DEBOUNCE_MS = 100;

type PublicPlayer = { id: number; nickname: string };
type SearchablePlayer = { player: Player; search: string };

let playersById = new Map<number, Player>();
let allPlayers: Player[] = [];
let easyPlayers: Player[] = [];
let searchablePlayers: SearchablePlayer[] = [];
let publicList: { version: string; players: PublicPlayer[] } = { version: '1', players: [] };
let refreshPromise: Promise<void> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let refreshGeneration = 0;

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export async function refreshPlayerCache(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let appliedGeneration = -1;
    while (appliedGeneration !== refreshGeneration) {
      const requestedGeneration = refreshGeneration;
      const [rows, storedVersion] = await Promise.all([
        db<Player>('players').orderBy('nickname'),
        redis()?.get(VERSION_KEY) ?? Promise.resolve(null),
      ]);
      const enabled = rows.filter((player) => Boolean(player.is_enabled));
      playersById = new Map(rows.map((player) => [player.id, player]));
      allPlayers = enabled;
      easyPlayers = enabled.filter((player) => Boolean(player.is_easy));
      searchablePlayers = enabled.map((player) => ({
        player,
        search: normalizeSearch(`${player.nickname}\0${player.team}`),
      }));
      publicList = {
        version: storedVersion || String(Date.now()),
        players: enabled.map((player) => ({ id: player.id, nickname: player.nickname })),
      };
      appliedGeneration = requestedGeneration;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function schedulePlayerCacheRefresh(): void {
  refreshGeneration += 1;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshPlayerCache().catch((err) => console.error('[players] refresh failed', err));
  }, REFRESH_DEBOUNCE_MS);
  refreshTimer.unref?.();
}

export async function initPlayerCache(): Promise<void> {
  const client = redis();
  if (client) {
    await client.set(VERSION_KEY, '1', { NX: true });
    const subscriber = redisSubscriber();
    if (subscriber) await subscriber.subscribe(INVALIDATE_CHANNEL, schedulePlayerCacheRefresh);
  }
  await refreshPlayerCache();
}

export function getPlayer(id: number): Player | undefined {
  return playersById.get(id);
}

export function getEnabledPlayer(id: number): Player | undefined {
  const player = playersById.get(id);
  return player && Boolean(player.is_enabled) ? player : undefined;
}

export function pickCachedTarget(mode: 'easy' | 'normal'): Player | null {
  const pool = mode === 'easy' ? easyPlayers : allPlayers;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export function searchCachedPlayers(search: string, limit: number): Player[] {
  const normalized = normalizeSearch(search);
  if (!normalized) return allPlayers.slice(0, limit);
  const result: Player[] = [];
  for (const entry of searchablePlayers) {
    if (!entry.search.includes(normalized)) continue;
    result.push(entry.player);
    if (result.length >= limit) break;
  }
  return result;
}

export async function getPublicPlayerList(): Promise<typeof publicList> {
  return publicList;
}

export async function invalidatePlayerCache(): Promise<void> {
  schedulePlayerCacheRefresh();
  const client = redis();
  if (!client) return;
  try {
    const nextVersion = await client.incr(VERSION_KEY);
    await redisPublisher()?.publish(INVALIDATE_CHANNEL, String(nextVersion));
  } catch (err) {
    console.warn('[players] cache invalidation notification failed', err instanceof Error
      ? err.message
      : err);
  }
}

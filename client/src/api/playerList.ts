import { api } from './client';

export interface PlayerSuggestion {
  id: number;
  nickname: string;
}

interface CachedPlayerList {
  version: string;
  players: PlayerSuggestion[];
  fetchedAt: number;
}

const STORAGE_KEY = 'player-list-v1';
const REVALIDATE_INTERVAL_MS = 30_000;
let memory: CachedPlayerList | null = null;
let loading: Promise<PlayerSuggestion[]> | null = null;

function readStored(): CachedPlayerList | null {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as CachedPlayerList | null;
    if (parsed?.players?.length) memory = parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return memory;
}

async function refresh(cached: CachedPlayerList | null): Promise<PlayerSuggestion[]> {
  const response = await api.get('/players/list', {
    headers: cached ? { 'If-None-Match': `\"players-${cached.version}\"` } : undefined,
    validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
  });
  if (response.status === 304 && cached) {
    const next = { ...cached, fetchedAt: Date.now() };
    memory = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next.players;
  }
  const next: CachedPlayerList = {
    version: String(response.data.version),
    players: response.data.players,
    fetchedAt: Date.now(),
  };
  memory = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next.players;
}

export async function getPlayerList(): Promise<PlayerSuggestion[]> {
  const cached = readStored();
  if (cached) {
    if (Date.now() - cached.fetchedAt > REVALIDATE_INTERVAL_MS) {
      loading ??= refresh(cached).finally(() => { loading = null; });
      try {
        return await loading;
      } catch {
        return cached.players;
      }
    }
    return cached.players;
  }
  loading ??= refresh(null).finally(() => { loading = null; });
  return loading;
}

export function clearPlayerListCache(): void {
  memory = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function searchPlayerList(players: PlayerSuggestion[], query: string): PlayerSuggestion[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return players
    .filter((player) => player.nickname.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => {
      const aName = a.nickname.toLocaleLowerCase();
      const bName = b.nickname.toLocaleLowerCase();
      return Number(bName.startsWith(normalized)) - Number(aName.startsWith(normalized)) ||
        a.nickname.localeCompare(b.nickname);
    })
    .slice(0, 10);
}

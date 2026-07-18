import axios from 'axios';

const powApi = axios.create({ baseURL: '/api/pow', withCredentials: true });
const EXPIRY_STORAGE_KEY = 'csgofriberg_pow_expires_at';

interface ChallengeResponse {
  valid?: boolean;
  expiresAt?: number;
  id?: string;
  challenge?: string;
  difficulty?: number;
  algorithm?: string;
}

function readStoredExpiry(): number {
  try {
    const value = Number(localStorage.getItem(EXPIRY_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function persistExpiry(value: number): void {
  expiresAt = value;
  try {
    if (value > 0) localStorage.setItem(EXPIRY_STORAGE_KEY, String(value));
    else localStorage.removeItem(EXPIRY_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable in strict privacy modes. */
  }
}

let expiresAt = readStoredExpiry();
let activeRequest: Promise<void> | null = null;
let refreshTimer: number | null = null;

function scheduleRefresh(): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  if (expiresAt <= Date.now()) return;
  const delay = Math.max(1_000, expiresAt - Date.now());
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void ensurePow(true).catch(() => undefined);
  }, delay);
}

function solveChallenge(challenge: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<{ nonce?: string; error?: string }>) => {
      finish();
      if (event.data.nonce) resolve(event.data.nonce);
      else reject(new Error(event.data.error || 'POW_FAILED'));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'POW_WORKER_FAILED'));
    };
    worker.postMessage({ challenge, difficulty });
  });
}

async function refreshPow(): Promise<void> {
  const challengeResponse = await powApi.post<ChallengeResponse>('/challenge', undefined, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  const data = challengeResponse.data;
  if (data.valid && data.expiresAt) {
    persistExpiry(data.expiresAt);
    scheduleRefresh();
    return;
  }
  if (
    data.algorithm !== 'csgofriberg-pow-v1' ||
    !data.id ||
    !data.challenge ||
    !data.difficulty
  ) throw new Error('POW_CHALLENGE_INVALID');

  const nonce = await solveChallenge(data.challenge, data.difficulty);
  const verifyResponse = await powApi.post<{ expiresAt: number }>('/verify', {
    id: data.id,
    nonce,
  });
  persistExpiry(verifyResponse.data.expiresAt);
  scheduleRefresh();
}

export function ensurePow(force = false): Promise<void> {
  if (activeRequest) return activeRequest;
  if (!force && expiresAt > Date.now()) {
    scheduleRefresh();
    return Promise.resolve();
  }
  if (force) persistExpiry(0);
  activeRequest = refreshPow()
    .catch((error) => {
      persistExpiry(0);
      throw error;
    })
    .finally(() => {
      activeRequest = null;
    });
  return activeRequest;
}

export function notePowExpiry(value: unknown): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > expiresAt) {
    persistExpiry(parsed);
    scheduleRefresh();
  }
}

scheduleRefresh();

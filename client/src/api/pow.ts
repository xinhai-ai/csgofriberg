import axios from 'axios';

const powApi = axios.create({ baseURL: '/api/pow', withCredentials: true });
const REFRESH_MARGIN_MS = 30_000;

interface ChallengeResponse {
  valid?: boolean;
  expiresAt?: number;
  id?: string;
  challenge?: string;
  difficulty?: number;
  algorithm?: string;
}

let expiresAt = 0;
let activeRequest: Promise<void> | null = null;
let refreshTimer: number | null = null;

function scheduleRefresh(): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  const delay = Math.max(1_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
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
    expiresAt = data.expiresAt;
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
  expiresAt = verifyResponse.data.expiresAt;
  scheduleRefresh();
}

export function ensurePow(force = false): Promise<void> {
  if (activeRequest) return activeRequest;
  if (!force && expiresAt > Date.now() + REFRESH_MARGIN_MS) return Promise.resolve();
  activeRequest = refreshPow().finally(() => {
    activeRequest = null;
  });
  return activeRequest;
}

export function notePowExpiry(value: unknown): void {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > expiresAt) {
    expiresAt = parsed;
    scheduleRefresh();
  }
}

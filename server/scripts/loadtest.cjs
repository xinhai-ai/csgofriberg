const { io } = require('socket.io-client');
const { createClient } = require('redis');

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const requests = Number(process.env.HTTP_REQUESTS || 500);
const concurrency = Number(process.env.HTTP_CONCURRENCY || 50);
const socketPairs = Number(process.env.SOCKET_PAIRS || 8);

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

async function httpLoad() {
  let next = 0;
  let errors = 0;
  const durations = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const id = next++;
      if (id >= requests) break;
      const requestStarted = performance.now();
      const path = id % 2 ? '/api/players/list' : '/api/leaderboard';
      try {
        const response = await fetch(`${baseUrl}${path}`);
        if (!response.ok) errors++;
        await response.arrayBuffer();
      } catch {
        errors++;
      }
      durations.push(performance.now() - requestStarted);
    }
  }));
  const elapsed = performance.now() - started;
  return {
    requests,
    errors,
    rps: Number((requests / (elapsed / 1000)).toFixed(1)),
    avgMs: Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
  };
}

async function guestCookie() {
  const response = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST' });
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const guest = cookies.find((cookie) => cookie.startsWith('csgofriberg_guest='));
  if (!guest) throw new Error('guest session cookie was not returned');
  return guest.split(';')[0];
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emit(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function socketLoad() {
  const started = performance.now();
  let errors = 0;
  const roomIds = [];
  await Promise.all(Array.from({ length: socketPairs }, async (_, index) => {
    const stamp = `${Date.now()}-${index}`;
    void stamp;
    const [cookieA, cookieB] = await Promise.all([guestCookie(), guestCookie()]);
    const [a, b] = await Promise.all([connect(cookieA), connect(cookieB)]);
    try {
      const created = await emit(a, 'room:create', { dbType: 'easy', boType: 1 });
      if (!created.room) { errors++; return; }
      roomIds.push(created.room.id);
      const joined = await emit(b, 'room:join', { roomId: created.room.id });
      if (!joined.room) { errors++; return; }
      await emit(b, 'room:ready');
      const startedGame = await emit(a, 'game:start');
      if (!startedGame.ok) errors++;
      await emit(a, 'room:leave');
    } finally {
      a.disconnect();
      b.disconnect();
    }
  }));
  const redis = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', RESP: 2 });
  await redis.connect();
  for (const roomId of roomIds) {
    const key = `csgofriberg:room:${roomId}`;
    const raw = await redis.get(key);
    if (!raw) continue;
    const room = JSON.parse(raw);
    const identityKeys = [...room.players, ...room.spectators]
      .map((member) => `csgofriberg:identity-room:${member.key}`);
    await redis.del([key, ...identityKeys]);
    await redis.zRem('csgofriberg:rooms:active', roomId);
    await redis.zRem(`csgofriberg:rooms:active:ip:${room.ownerIp}`, roomId);
  }
  await redis.quit();
  return {
    pairs: socketPairs,
    errors,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
  };
}

(async () => {
  const result = { http: await httpLoad() };
  result.socket = await socketLoad();
  console.log(JSON.stringify(result, null, 2));
  if (result.http.errors || result.socket?.errors) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

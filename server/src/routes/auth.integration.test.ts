import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authRoutes from './auth';
import { errorHandler } from '../middleware/common';
import { initDb } from '../db/init';
import { db } from '../db/knex';
import { initRedis } from '../redis';
import { config } from '../config';

let server: http.Server;
let baseUrl: string;
const TEST_IP = `198.51.100.${(Date.now() % 250) + 1}`;

function mergeCookies(current: string, response: Response): string {
  const getSetCookie = (response.headers as any).getSetCookie?.bind(response.headers);
  const values: string[] = getSetCookie ? getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean) as string[];
  const jar = new Map(current.split('; ').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index), item.slice(index + 1)];
  }));
  for (const value of values) {
    const first = value.split(';')[0];
    const index = first.indexOf('=');
    jar.set(first.slice(0, index), first.slice(index + 1));
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(path: string, cookie: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': TEST_IP,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { response, data: await response.json(), cookie: mergeCookies(cookie, response) };
}

describe('cookie authentication', () => {
  beforeAll(async () => {
    await initDb();
    await initRedis();
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('binds guest claims and revokes logout immediately', async () => {
    const stamp = String(Date.now()).slice(-10);
    const username = `at${stamp}`;
    const password = `Strong-${stamp}-Password`;
    let cookie = '';
    let result = await request('/api/auth/session', cookie, { method: 'POST', body: '{}' });
    cookie = result.cookie;
    const guestToken = cookie.split('; ').find((item) => item.startsWith('csgofriberg_guest='))!.split('=')[1];
    const guest = jwt.verify(guestToken, config.jwtSecret) as { key: string };
    const sessionId = `auth-test-${Date.now()}`;
    const [player] = await db('players').select('id').limit(1);
    await db('games').insert({
      session_id: sessionId,
      guest_key: guest.key,
      target_player_id: player.id,
      mode: 'easy',
      guesses: '[]',
      status: 'lost',
      guess_count: 0,
      finished_at: db.fn.now(),
    });

    result = await request('/api/auth/register', cookie, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    cookie = result.cookie;
    expect(result.response.status).toBe(200);
    expect(cookie).toContain('csgofriberg_session=');

    result = await request('/api/auth/claim', cookie, {
      method: 'POST',
      body: JSON.stringify({ guestKey: 'forged-guest-key' }),
    });
    expect(result.data.claimed).toBe(1);
    const game = await db('games').where({ session_id: sessionId }).first();
    expect(game.guest_key).toBeNull();

    result = await request('/api/auth/logout', cookie, { method: 'POST', body: '{}' });
    cookie = result.cookie;
    result = await request('/api/auth/me', cookie);
    expect(result.response.status).toBe(401);

    const user = await db('users').where({ username }).first();
    await db('games').where({ session_id: sessionId }).del();
    await db('users').where({ id: user.id }).del();
  });
});

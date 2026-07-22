import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import leaderboardRoutes from './leaderboard';
import { errorHandler } from '../middleware/common';
import { db } from '../db/knex';
import { initDb } from '../db/init';
import { initRedis } from '../redis';
import { initPlayerCache } from '../services/playerCache';
import { invalidateCached } from '../services/queryCache';
import { signToken, userNameFromUsername } from '../middleware/auth';
import { config } from '../config';

let server: http.Server;
let baseUrl: string;

describe('leaderboard', () => {
  beforeAll(async () => {
    await initDb();
    await initRedis();
    await initPlayerCache();
    const app = express();
    app.use('/api/leaderboard', leaderboardRoutes);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns at most 50 users with anonymous display IDs', async () => {
    const stamp = Date.now();
    const users = Array.from({ length: 51 }, (_, index) => ({
      username: `leaderboard-${stamp}-${index}`,
      password_hash: 'not-used',
      role: 'user',
      token_version: 0,
    }));
    const inserted = await db('users').insert(users).returning(['id', 'username']);
    const userIds = inserted.map((row: any) => Number(row.id));
    const [target] = await db('players').select('id').limit(1);
    await db('games').insert(inserted.map((row: any, index: number) => ({
      session_id: `leaderboard-${stamp}-${index}`,
      user_id: Number(row.id),
      target_player_id: Number(target.id),
      mode: 'easy',
      guesses: '[]',
      status: 'won',
      guess_count: 1,
      finished_at: db.fn.now(),
    })));
    await invalidateCached('leaderboard');

    try {
      const response = await fetch(`${baseUrl}/api/leaderboard`);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.items).toHaveLength(50);
      expect(data.items.every((row: any) => /^用户#[0-9A-Z]{5}$/.test(row.displayId))).toBe(true);
      expect(data.items.every((row: any) => !Object.hasOwn(row, 'username'))).toBe(true);
      expect(data.currentUser).toBeNull();

      const token = signToken({ id: userIds[0], token_version: 0 });
      const ownResponse = await fetch(`${baseUrl}/api/leaderboard`, {
        headers: { Cookie: `csgofriberg_session=${token}` },
      });
      const ownData = await ownResponse.json();
      expect(ownResponse.status).toBe(200);
      expect(ownData.currentUser).toEqual({
        displayId: userNameFromUsername(users[0].username),
        rank: expect.any(Number),
      });
    } finally {
      await db('games').whereIn('user_id', userIds).del();
      await db('users').whereIn('id', userIds).del();
      await invalidateCached('leaderboard');
    }
  });
});

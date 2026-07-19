import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import statsRoutes from './stats';
import { config } from '../config';
import { db } from '../db/knex';
import { initDb } from '../db/init';
import { initRedis } from '../redis';
import { errorHandler } from '../middleware/common';
import { initPlayerCache, getPlayer } from '../services/playerCache';
import { compareGuess } from '../services/gameService';
import { invalidateCached } from '../services/queryCache';

let server: http.Server;
let baseUrl: string;

function guestCookie(key: string): string {
  const token = jwt.sign({ key, typ: 'guest' }, config.jwtSecret, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
  return `csgofriberg_guest=${token}`;
}

async function request(path: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
  return { response, data: await response.json() };
}

describe('stats and replay', () => {
  beforeAll(async () => {
    await initDb();
    await initRedis();
    await initPlayerCache();
    const app = express();
    app.use('/api/stats', statsRoutes);
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns personal and global stats and protects replay ownership', async () => {
    const stamp = Date.now();
    const ownerKey = `stats-owner-${stamp}`;
    const otherKey = `stats-other-${stamp}`;
    const sessionId = `stats-session-${stamp}`;
    const [row] = await db('players').select('id').limit(1);
    const target = getPlayer(Number(row.id))!;
    const feedback = compareGuess(target, target);
    const [gameId] = await db('games')
      .insert({
        session_id: sessionId,
        guest_key: ownerKey,
        target_player_id: target.id,
        mode: 'easy',
        guesses: JSON.stringify([feedback]),
        status: 'won',
        guess_count: 1,
        finished_at: db.fn.now(),
      })
      .returning('id')
      .then((rows) => rows.map((item: any) => typeof item === 'object' ? item.id : item));
    await invalidateCached('stats:global');

    try {
      const stats = await request('/api/stats/me', guestCookie(ownerKey));
      expect(stats.response.status).toBe(200);
      expect(stats.data.personal.totalGames).toBe(1);
      expect(stats.data.personal.wins).toBe(1);
      expect(stats.data.global.totalGames).toBeGreaterThanOrEqual(1);
      expect(stats.data.recent[0].id).toBe(gameId);

      const replay = await request(`/api/stats/games/${gameId}/replay`, guestCookie(ownerKey));
      expect(replay.response.status).toBe(200);
      expect(replay.data.answer.nickname).toBe(target.nickname);
      expect(replay.data.guesses).toHaveLength(1);
      expect(replay.data.guesses[0].correct).toBe(true);

      const forbidden = await request(`/api/stats/games/${gameId}/replay`, guestCookie(otherKey));
      expect(forbidden.response.status).toBe(404);
      expect(forbidden.data.code).toBe('GAME_NOT_FOUND');
    } finally {
      await db('games').where({ session_id: sessionId }).del();
      await invalidateCached('stats:global');
    }
  });
});

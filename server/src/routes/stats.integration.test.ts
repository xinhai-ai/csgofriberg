import http from 'http';
import { randomUUID } from 'crypto';
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
    const playerRows = await db('players').select('id').limit(2);
    const target = getPlayer(Number(playerRows[0].id))!;
    const otherPlayer = getPlayer(Number(playerRows[1].id))!;
    const [gameId] = await db('games')
      .insert({
        session_id: sessionId,
        guest_key: ownerKey,
        target_player_id: target.id,
        mode: 'easy',
        guesses: JSON.stringify([target.id]),
        status: 'won',
        guess_count: 1,
        finished_at: db.fn.now(),
      })
      .returning('id')
      .then((rows) => rows.map((item: any) => typeof item === 'object' ? item.id : item));
    await invalidateCached('stats:global');

    const meKey = `g:${ownerKey}`;
    const opponentKey = `g:${otherKey}`;
    const [matchId] = await db('match_records')
      .insert({
        room_id: randomUUID(),
        db_type: 'easy',
        bo_type: 1,
        replay: JSON.stringify([{
          round: 1,
          targetPlayerId: target.id,
          winnerKey: meKey,
          reason: 'guessed',
          guessesByPlayer: {
            [meKey]: [target.id],
            [opponentKey]: [otherPlayer.id],
          },
        }]),
      })
      .returning('id')
      .then((rows) => rows.map((item: any) => typeof item === 'object' ? item.id : item));
    await db('match_players').insert([
      {
        match_id: matchId,
        player_key: meKey,
        player_name: '',
        score: 1,
        is_winner: true,
      },
      {
        match_id: matchId,
        player_key: opponentKey,
        player_name: '',
        score: 0,
        is_winner: false,
      },
    ]);

    try {
      const stats = await request('/api/stats/me', guestCookie(ownerKey));
      expect(stats.response.status).toBe(200);
      expect(stats.data.personal.totalGames).toBe(1);
      expect(stats.data.personal.wins).toBe(1);
      expect(stats.data.global.totalGames).toBeGreaterThanOrEqual(1);
      const singleList = await request('/api/stats/replays?type=single&page=1&pageSize=5', guestCookie(ownerKey));
      expect(singleList.response.status).toBe(200);
      expect(singleList.data.items[0]).toMatchObject({ type: 'single', id: gameId });

      const multiList = await request('/api/stats/replays?type=multi&page=1&pageSize=5', guestCookie(ownerKey));
      expect(multiList.response.status).toBe(200);
      expect(multiList.data.items[0]).toMatchObject({
        type: 'multi',
        id: matchId,
        result: 'won',
        me: { score: 1 },
        opponent: { score: 0 },
      });

      const replay = await request(`/api/stats/games/${gameId}/replay`, guestCookie(ownerKey));
      expect(replay.response.status).toBe(200);
      expect(replay.data.answer.nickname).toBe(target.nickname);
      expect(replay.data.guesses).toHaveLength(1);
      expect(replay.data.guesses[0].correct).toBe(true);

      const multiReplay = await request(`/api/stats/matches/${matchId}/replay`, guestCookie(ownerKey));
      expect(multiReplay.response.status).toBe(200);
      expect(multiReplay.data.rounds).toHaveLength(1);
      expect(multiReplay.data.rounds[0].winner).toBe('me');
      expect(multiReplay.data.rounds[0].me.guesses[0].correct).toBe(true);
      expect(multiReplay.data.rounds[0].opponent.guesses[0].playerId).toBe(otherPlayer.id);

      const forbidden = await request(`/api/stats/games/${gameId}/replay`, guestCookie(otherKey));
      expect(forbidden.response.status).toBe(404);
      expect(forbidden.data.code).toBe('GAME_NOT_FOUND');

      const forbiddenMulti = await request(`/api/stats/matches/${matchId}/replay`, guestCookie(`third-${stamp}`));
      expect(forbiddenMulti.response.status).toBe(404);
      expect(forbiddenMulti.data.code).toBe('GAME_NOT_FOUND');
    } finally {
      await db('games').where({ session_id: sessionId }).del();
      await db('match_records').where({ id: matchId }).del();
      await invalidateCached('stats:global');
    }
  });
});

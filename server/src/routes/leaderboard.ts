import { Router } from 'express';
import { db } from '../db/knex';
import { asyncHandler } from '../middleware/common';
import { cached } from '../services/queryCache';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

/** 排行榜: 单人胜场/胜率/平均猜测次数 + 多人胜场 */
router.get(
  '/',
  rateLimit({ name: 'leaderboard', limit: 60, windowSeconds: 60, failClosed: true }),
  asyncHandler(async (_req, res) => {
    const board = await cached('leaderboard', 30, async () => {
      const rows = await db('games as g')
      .join('users as u', 'u.id', 'g.user_id')
      .whereNot('g.status', 'playing')
      .groupBy('u.id', 'u.username')
      .select('u.id', 'u.username')
      .count({ total: 'g.id' })
      .sum({ wins: db.raw("case when g.status = 'won' then 1 else 0 end") })
      .avg({
        avgGuesses: db.raw("case when g.status = 'won' then g.guess_count else null end"),
      });

    const multiRows = await db('match_players')
      .where({ is_winner: true })
      .whereNotNull('user_id')
      .groupBy('user_id')
      .select('user_id')
      .count({ wins: 'id' });
    const multiWins = new Map<number, number>();
    for (const r of multiRows as any[]) {
      multiWins.set(Number(r.user_id), Number(r.wins));
    }

    return (rows as any[])
      .map((r) => ({
        id: r.id,
        username: r.username,
        total: Number(r.total),
        wins: Number(r.wins ?? 0),
        winRate: Number(r.total) ? Number(r.wins ?? 0) / Number(r.total) : 0,
        avgGuesses: r.avgGuesses != null ? Number(r.avgGuesses) : null,
        multiWins: multiWins.get(r.id) ?? 0,
      }))
      .sort((a, b) => b.wins - a.wins || a.winRate - b.winRate)
      .slice(0, 50);
    });

    res.json(board);
  })
);

export default router;

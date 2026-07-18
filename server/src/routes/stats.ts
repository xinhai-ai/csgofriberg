import { Router } from 'express';
import { db } from '../db/knex';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/common';

const router = Router();

/** 生涯记录:登录用户按 user_id,匿名访客按 guest_key */
router.get(
  '/me',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const who = req.user
      ? { user_id: req.user.id }
      : req.guestKey
        ? { guest_key: req.guestKey }
        : null;
    if (!who) throw new HttpError(400, 'GUEST_KEY_REQUIRED');

    const games = await db('games').where(who).whereNot('status', 'playing');
    const won = games.filter((g: any) => g.status === 'won');
    const wonGuessCounts = won.map((g: any) => g.guess_count);

    const recent = await db('games as g')
      .join('players as p', 'p.id', 'g.target_player_id')
      .where(
        Object.fromEntries(Object.entries(who).map(([k, v]) => [`g.${k}`, v]))
      )
      .whereNot('g.status', 'playing')
      .orderBy('g.finished_at', 'desc')
      .limit(20)
      .select(
        'g.id',
        'g.mode',
        'g.status',
        'g.guess_count as guessCount',
        'g.finished_at as finishedAt',
        'p.nickname as answer'
      );

    let multiGames = 0;
    let multiWins = 0;
    if (req.user) {
      const userId = req.user.id;
      const multiRows = await db('match_records').select('winner_id', 'players');
      const mine = multiRows.filter((r: any) =>
        (JSON.parse(r.players) as { userId: number | null }[]).some(
          (p) => p.userId === userId
        )
      );
      multiGames = mine.length;
      multiWins = mine.filter((r: any) => r.winner_id === userId).length;
    }

    res.json({
      totalGames: games.length,
      wins: won.length,
      winRate: games.length ? won.length / games.length : 0,
      avgGuesses: wonGuessCounts.length
        ? wonGuessCounts.reduce((a: number, b: number) => a + b, 0) / wonGuessCounts.length
        : 0,
      bestGuesses: wonGuessCounts.length ? Math.min(...wonGuessCounts) : null,
      multiGames,
      multiWins,
      recent,
    });
  })
);

export default router;

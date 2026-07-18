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

    const aggregate = await db('games')
      .where(who)
      .whereNot('status', 'playing')
      .first()
      .count({ totalGames: 'id' })
      .sum({ wins: db.raw("case when status = 'won' then 1 else 0 end") })
      .avg({ avgGuesses: db.raw("case when status = 'won' then guess_count else null end") })
      .min({ bestGuesses: db.raw("case when status = 'won' then guess_count else null end") });

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
      const multi = await db('match_players')
        .where({ user_id: userId })
        .first()
        .count({ total: 'id' })
        .sum({ wins: db.raw('case when is_winner then 1 else 0 end') });
      multiGames = Number(multi?.total ?? 0);
      multiWins = Number(multi?.wins ?? 0);
    }

    res.json({
      totalGames: Number(aggregate?.totalGames ?? 0),
      wins: Number(aggregate?.wins ?? 0),
      winRate: Number(aggregate?.totalGames ?? 0)
        ? Number(aggregate?.wins ?? 0) / Number(aggregate?.totalGames)
        : 0,
      avgGuesses: Number(aggregate?.avgGuesses ?? 0),
      bestGuesses: aggregate?.bestGuesses != null ? Number(aggregate.bestGuesses) : null,
      multiGames,
      multiWins,
      recent,
    });
  })
);

export default router;

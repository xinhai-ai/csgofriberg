import { Router } from 'express';
import { db } from '../db/knex';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/common';
import { cached } from '../services/queryCache';
import { completeGuessFeedback } from '../services/gameService';
import { getPlayer } from '../services/playerCache';
import { GuessFeedback, Player } from '../types';
import { rateLimit, requestIdentity } from '../middleware/rateLimit';

const router = Router();
router.use(optionalAuth);

type Owner = { user_id: number } | { guest_key: string };

function ownerFor(req: { user?: { id: number }; guestKey?: string }): Owner | null {
  if (req.user) return { user_id: req.user.id };
  if (req.guestKey) return { guest_key: req.guestKey };
  return null;
}

function qualifiedOwner(owner: Owner, alias: string): Record<string, number | string> {
  return Object.fromEntries(
    Object.entries(owner).map(([key, value]) => [`${alias}.${key}`, value])
  );
}

function singleSummary(row: any) {
  const totalGames = Number(row?.totalGames ?? 0);
  const wins = Number(row?.wins ?? 0);
  return {
    totalGames,
    wins,
    winRate: totalGames ? wins / totalGames : 0,
    avgGuesses: row?.avgGuesses != null ? Number(row.avgGuesses) : null,
    bestGuesses: row?.bestGuesses != null ? Number(row.bestGuesses) : null,
  };
}

function singleAggregate(query: ReturnType<typeof db>) {
  return query
    .whereNot('status', 'playing')
    .first()
    .count({ totalGames: 'id' })
    .sum({ wins: db.raw("case when status = 'won' then 1 else 0 end") })
    .avg({ avgGuesses: db.raw("case when status = 'won' then guess_count else null end") })
    .min({ bestGuesses: db.raw("case when status = 'won' then guess_count else null end") });
}

function answerView(target: Player) {
  return {
    id: target.id,
    nickname: target.nickname,
    team: target.team,
    nationality: target.nationality,
    region: target.region,
    age: new Date().getFullYear() - target.birth_year,
    role: target.role,
    majorChampionships: target.major_championships,
    majorAppearances: target.major_appearances,
    isActive: Boolean(target.is_active),
  };
}

async function globalStats() {
  return cached('stats:global', 30, async () => {
    const [single, multi, users] = await Promise.all([
      singleAggregate(db('games')),
      db('match_records').count({ total: 'id' }).first(),
      db('users').count({ total: 'id' }).first(),
    ]);
    return {
      ...singleSummary(single),
      multiGames: Number(multi?.total ?? 0),
      registeredUsers: Number(users?.total ?? 0),
    };
  });
}

/** 统计:当前身份的个人数据、全站聚合和最近单人对局。 */
router.get(
  '/me',
  rateLimit({
    name: 'stats-me',
    limit: 30,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  asyncHandler(async (req, res) => {
    const owner = ownerFor(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');

    const personalSinglePromise = singleAggregate(db('games').where(owner));
    const recentPromise = db('games as g')
      .join('players as p', 'p.id', 'g.target_player_id')
      .where(qualifiedOwner(owner, 'g'))
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
    const personalMultiPromise = req.user
      ? db('match_players')
        .where({ user_id: req.user.id })
        .first()
        .count({ total: 'id' })
        .sum({ wins: db.raw('case when is_winner then 1 else 0 end') })
      : Promise.resolve({ total: 0, wins: 0 });

    const [personalSingle, recent, personalMulti, global] = await Promise.all([
      personalSinglePromise,
      recentPromise,
      personalMultiPromise,
      globalStats(),
    ]);

    res.json({
      personal: {
        ...singleSummary(personalSingle),
        multiGames: Number(personalMulti?.total ?? 0),
        multiWins: Number(personalMulti?.wins ?? 0),
      },
      global,
      recent,
    });
  })
);

/** 最近单人对局回放详情，仅允许记录所属账号或访客读取。 */
router.get(
  '/games/:id/replay',
  rateLimit({
    name: 'stats-replay',
    limit: 60,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  asyncHandler(async (req, res) => {
    const owner = ownerFor(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'VALIDATION_FAILED');

    const game = await db('games')
      .where({ id, ...owner })
      .whereNot('status', 'playing')
      .first();
    if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
    const target = getPlayer(Number(game.target_player_id));
    if (!target) throw new HttpError(404, 'PLAYER_NOT_FOUND');

    let storedGuesses: GuessFeedback[] = [];
    try {
      const parsed = JSON.parse(String(game.guesses));
      if (Array.isArray(parsed)) storedGuesses = parsed as GuessFeedback[];
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR');
    }
    const guesses = storedGuesses.map((feedback) => completeGuessFeedback(
      feedback,
      getPlayer(feedback.playerId),
      target
    ));

    res.json({
      id: game.id,
      mode: game.mode,
      status: game.status,
      guessCount: Number(game.guess_count),
      createdAt: game.created_at,
      finishedAt: game.finished_at,
      answer: answerView(target),
      guesses,
    });
  })
);

export default router;

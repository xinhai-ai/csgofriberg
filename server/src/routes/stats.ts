import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/common';
import { cached } from '../services/queryCache';
import { compareGuess, completeGuessFeedback, MAX_GUESSES } from '../services/gameService';
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

function identityKeyFor(req: { user?: { id: number }; guestKey?: string }): string | null {
  if (req.user) return `u:${req.user.id}`;
  return req.guestKey ? `g:${req.guestKey}` : null;
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
    age: target.age,
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

const replayListQuery = z.object({
  type: z.enum(['single', 'multi']).default('single'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(5).max(30).default(15),
});

function safeGuessIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_GUESSES)
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function replayGuesses(target: Player, ids: number[]): GuessFeedback[] {
  return ids.flatMap((id) => {
    const guess = getPlayer(id);
    return guess ? [compareGuess(guess, target)] : [];
  });
}

/** 统计:当前身份的个人数据和全站聚合。回放列表独立分页查询。 */
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
    const identityKey = identityKeyFor(req);
    if (!identityKey) throw new HttpError(400, 'GUEST_KEY_REQUIRED');

    const personalSinglePromise = singleAggregate(db('games').where(owner));
    const personalMultiPromise = db('match_players')
      .where({ player_key: identityKey })
      .first()
      .count({ total: 'id' })
      .sum({ wins: db.raw('case when is_winner then 1 else 0 end') });

    const [personalSingle, personalMulti, global] = await Promise.all([
      personalSinglePromise,
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
    });
  })
);

/** 个人回放列表。固定类型分页，避免跨大表合并和每页 count。 */
router.get(
  '/replays',
  rateLimit({
    name: 'stats-replay-list',
    limit: 30,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  asyncHandler(async (req, res) => {
    const parsed = replayListQuery.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_FAILED');
    const { type, page, pageSize } = parsed.data;
    const offset = (page - 1) * pageSize;

    if (type === 'single') {
      const owner = ownerFor(req);
      if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
      const rows = await db('games as g')
        .join('players as p', 'p.id', 'g.target_player_id')
        .where(qualifiedOwner(owner, 'g'))
        .whereNot('g.status', 'playing')
        .orderBy('g.finished_at', 'desc')
        .orderBy('g.id', 'desc')
        .offset(offset)
        .limit(pageSize + 1)
        .select(
          'g.id',
          'g.mode',
          'g.status',
          'g.guess_count as guessCount',
          'g.finished_at as finishedAt',
          'p.nickname as answer'
        );
      const hasNext = rows.length > pageSize;
      return res.json({
        type,
        page,
        pageSize,
        hasNext,
        items: rows.slice(0, pageSize).map((row) => ({ type: 'single', ...row })),
      });
    }

    const identityKey = identityKeyFor(req);
    if (!identityKey) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const rows = await db('match_players as me')
      .join('match_records as m', 'm.id', 'me.match_id')
      .where('me.player_key', identityKey)
      .orderBy('m.created_at', 'desc')
      .orderBy('m.id', 'desc')
      .offset(offset)
      .limit(pageSize + 1)
      .select(
        'm.id',
        'm.db_type as mode',
        'm.bo_type as boType',
        'm.created_at as finishedAt',
        'me.score as meScore',
        'me.is_winner as meWinner'
      );
    const visibleRows = rows.slice(0, pageSize);
    const matchIds = visibleRows.map((row) => Number(row.id));
    const opponents = matchIds.length
      ? await db('match_players')
        .whereIn('match_id', matchIds)
        .whereNot('player_key', identityKey)
        .select('match_id as matchId', 'score', 'is_winner as isWinner')
      : [];
    const opponentByMatch = new Map(opponents.map((row) => [Number(row.matchId), row]));
    res.json({
      type,
      page,
      pageSize,
      hasNext: rows.length > pageSize,
      items: visibleRows.map((row) => ({
        type: 'multi',
        id: Number(row.id),
        mode: row.mode,
        boType: Number(row.boType),
        finishedAt: row.finishedAt,
        result: Boolean(row.meWinner)
          ? 'won'
          : Boolean(opponentByMatch.get(Number(row.id))?.isWinner)
            ? 'lost'
            : 'draw',
        me: { score: Number(row.meScore) },
        opponent: opponentByMatch.has(Number(row.id))
          ? { score: Number(opponentByMatch.get(Number(row.id))!.score) }
          : null,
      })),
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

    let storedGuesses: unknown[] = [];
    try {
      const parsed = JSON.parse(String(game.guesses));
      if (Array.isArray(parsed)) storedGuesses = parsed;
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR');
    }
    const guesses = storedGuesses.flatMap((stored) => {
      if (typeof stored === 'number') {
        const guess = getPlayer(stored);
        return guess ? [compareGuess(guess, target)] : [];
      }
      if (!stored || typeof stored !== 'object' || !('playerId' in stored)) return [];
      const feedback = stored as GuessFeedback;
      return [completeGuessFeedback(feedback, getPlayer(feedback.playerId), target)];
    });

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

/** 多人回放详情，仅返回当前身份对应的我方与对方。 */
router.get(
  '/matches/:id/replay',
  rateLimit({
    name: 'stats-multi-replay',
    limit: 60,
    windowSeconds: 60,
    key: requestIdentity,
    failClosed: true,
  }),
  asyncHandler(async (req, res) => {
    const identityKey = identityKeyFor(req);
    if (!identityKey) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'VALIDATION_FAILED');

    const match = await db('match_records as m')
      .join('match_players as me', 'me.match_id', 'm.id')
      .where('m.id', id)
      .where('me.player_key', identityKey)
      .first(
        'm.id',
        'm.db_type as mode',
        'm.bo_type as boType',
        'm.replay',
        'm.created_at as finishedAt',
        'me.score as meScore',
        'me.is_winner as meWinner'
      );
    if (!match) throw new HttpError(404, 'GAME_NOT_FOUND');
    const opponent = await db('match_players')
      .where('match_id', id)
      .whereNot('player_key', identityKey)
      .first('player_key as key', 'score', 'is_winner as isWinner');
    if (!opponent) throw new HttpError(404, 'GAME_NOT_FOUND');

    let storedRounds: unknown[] = [];
    try {
      const parsedReplay = JSON.parse(String(match.replay));
      if (Array.isArray(parsedReplay)) storedRounds = parsedReplay.slice(0, 30);
    } catch {
      throw new HttpError(500, 'INTERNAL_ERROR');
    }
    const rounds = storedRounds.flatMap((stored) => {
      if (!stored || typeof stored !== 'object') return [];
      const round = stored as Record<string, unknown>;
      const target = getPlayer(Number(round.targetPlayerId));
      if (!target) return [];
      const guessesByPlayer = round.guessesByPlayer;
      if (!guessesByPlayer || typeof guessesByPlayer !== 'object') return [];
      const guesses = guessesByPlayer as Record<string, unknown>;
      const winnerKey = typeof round.winnerKey === 'string' ? round.winnerKey : null;
      return [{
        round: Number(round.round),
        reason: typeof round.reason === 'string' ? round.reason : '',
        winner: winnerKey === identityKey ? 'me' : winnerKey === opponent.key ? 'opponent' : null,
        answer: answerView(target),
        me: { guesses: replayGuesses(target, safeGuessIds(guesses[identityKey])) },
        opponent: { guesses: replayGuesses(target, safeGuessIds(guesses[opponent.key])) },
      }];
    });

    res.json({
      id: Number(match.id),
      mode: match.mode,
      boType: Number(match.boType),
      finishedAt: match.finishedAt,
      result: Boolean(match.meWinner)
        ? 'won'
        : Boolean(opponent.isWinner)
          ? 'lost'
          : 'draw',
      me: { score: Number(match.meScore) },
      opponent: { score: Number(opponent.score) },
      rounds,
    });
  })
);

export default router;

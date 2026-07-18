import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex';
import { optionalAuth } from '../middleware/auth';
import { validateBody, asyncHandler, HttpError } from '../middleware/common';
import { GameRow, Player, GuessFeedback } from '../types';
import { compareGuess, MAX_GUESSES, EASY_MIN_MAJORS } from '../services/gameService';

const router = Router();
router.use(optionalAuth);

async function pickTarget(mode: string): Promise<Player> {
  let query = db<Player>('players');
  if (mode === 'easy') {
    query = query.where('major_appearances', '>=', EASY_MIN_MAJORS);
  }
  const players = await query;
  if (!players.length) throw new HttpError(500, 'EMPTY_PLAYER_POOL');
  return players[Math.floor(Math.random() * players.length)];
}

/** 单人模式无需登录:登录用户按 user_id 记账,匿名按 guest_key */
function identity(req: { user?: { id: number }; guestKey?: string }) {
  if (req.user) return { user_id: req.user.id };
  if (req.guestKey) return { guest_key: req.guestKey };
  return null;
}

router.post(
  '/start',
  validateBody(z.object({ mode: z.enum(['easy', 'normal']).default('easy') })),
  asyncHandler(async (req, res) => {
    const { mode } = req.body;
    const who = identity(req);
    if (!who) throw new HttpError(400, 'GUEST_KEY_REQUIRED');

    const pending = await db<GameRow>('games')
      .where({ ...who, status: 'playing', mode })
      .first();
    if (pending) {
      return res.json({
        gameId: pending.id,
        mode: pending.mode,
        maxGuesses: MAX_GUESSES,
        guesses: JSON.parse(pending.guesses) as GuessFeedback[],
      });
    }
    const target = await pickTarget(mode);
    const [id] = await db('games')
      .insert({ ...who, target_player_id: target.id, mode })
      .returning('id')
      .then((rows) => rows.map((r: any) => (typeof r === 'object' ? r.id : r)));
    res.json({ gameId: id, mode, maxGuesses: MAX_GUESSES, guesses: [] });
  })
);

async function loadPlayingGame(
  gameId: number,
  who: Record<string, unknown>
): Promise<GameRow> {
  const game = await db<GameRow>('games').where({ id: gameId, ...who }).first();
  if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
  if (game.status !== 'playing') throw new HttpError(400, 'GAME_FINISHED');
  return game;
}

function answerView(target: Player) {
  return {
    id: target.id,
    nickname: target.nickname,
    realName: target.real_name,
    team: target.team,
    nationality: target.nationality,
    role: target.role,
    majorAppearances: target.major_appearances,
  };
}

router.post(
  '/:id/guess',
  validateBody(z.object({ playerId: z.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const who = identity(req);
    if (!who) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const game = await loadPlayingGame(Number(req.params.id), who);
    const guess = await db<Player>('players').where({ id: req.body.playerId }).first();
    if (!guess) throw new HttpError(404, 'PLAYER_NOT_FOUND');
    const target = await db<Player>('players')
      .where({ id: game.target_player_id })
      .first();
    if (!target) throw new HttpError(500, 'INTERNAL_ERROR');

    const guesses = JSON.parse(game.guesses) as GuessFeedback[];
    if (guesses.some((g) => g.playerId === guess.id)) {
      throw new HttpError(400, 'ALREADY_GUESSED');
    }
    const feedback = compareGuess(guess, target);
    guesses.push(feedback);

    const finished = feedback.correct || guesses.length >= MAX_GUESSES;
    const status = feedback.correct ? 'won' : finished ? 'lost' : 'playing';
    await db('games')
      .where({ id: game.id })
      .update({
        guesses: JSON.stringify(guesses),
        guess_count: guesses.length,
        status,
        finished_at: finished ? db.fn.now() : null,
      });

    res.json({
      feedback,
      status,
      guessCount: guesses.length,
      maxGuesses: MAX_GUESSES,
      answer: finished ? answerView(target) : undefined,
    });
  })
);

router.post(
  '/:id/giveup',
  asyncHandler(async (req, res) => {
    const who = identity(req);
    if (!who) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const game = await loadPlayingGame(Number(req.params.id), who);
    await db('games')
      .where({ id: game.id })
      .update({ status: 'lost', finished_at: db.fn.now() });
    const target = await db<Player>('players')
      .where({ id: game.target_player_id })
      .first();
    res.json({ status: 'lost', answer: target ? answerView(target) : undefined });
  })
);

export default router;

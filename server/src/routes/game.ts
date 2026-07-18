import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex';
import { optionalAuth } from '../middleware/auth';
import { validateBody, asyncHandler, HttpError } from '../middleware/common';
import { Player } from '../types';
import { compareGuess, MAX_GUESSES } from '../services/gameService';
import { getPlayer, pickCachedTarget } from '../services/playerCache';
import { rateLimit } from '../middleware/rateLimit';
import { withKeyLock } from '../services/keyLock';
import { invalidateCached } from '../services/queryCache';
import {
  SingleGameMode,
  SingleGameState,
  createOrResumeSingleGame,
  deleteSingleGame,
  loadSingleGame,
  saveSingleGame,
} from '../services/singleGameStore';

const router = Router();
router.use(optionalAuth);

function identity(req: { user?: { id: number }; guestKey?: string }) {
  if (req.user) {
    return { identityKey: `u:${req.user.id}`, userId: req.user.id, guestKey: null };
  }
  if (req.guestKey) {
    return { identityKey: `g:${req.guestKey}`, userId: null, guestKey: req.guestKey };
  }
  return null;
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

async function loadOwnedGame(id: string, identityKey: string): Promise<SingleGameState> {
  const game = await loadSingleGame(id, identityKey);
  if (!game) throw new HttpError(404, 'GAME_NOT_FOUND');
  return game;
}

async function settleGame(game: SingleGameState, status: 'won' | 'lost'): Promise<void> {
  await db('games')
    .insert({
      session_id: game.id,
      user_id: game.userId,
      guest_key: game.guestKey,
      target_player_id: game.targetPlayerId,
      mode: game.mode,
      guesses: JSON.stringify(game.guesses),
      status,
      guess_count: game.guesses.length,
      created_at: new Date(game.createdAt),
      finished_at: db.fn.now(),
    })
    .onConflict('session_id')
    .ignore();
  await deleteSingleGame(game);
  await invalidateCached('leaderboard');
}

router.post(
  '/start',
  rateLimit({ name: 'game-start', limit: 30, windowSeconds: 60 }),
  validateBody(z.object({ mode: z.enum(['easy', 'normal']).default('easy') })),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const mode = req.body.mode as SingleGameMode;
    const response = await withKeyLock(`single-start:${owner.identityKey}:${mode}`, async () => {
      const target = pickCachedTarget(mode);
      if (!target) throw new HttpError(500, 'EMPTY_PLAYER_POOL');
      const game = await createOrResumeSingleGame({
        ...owner,
        mode,
        targetPlayerId: target.id,
      });
      return {
        gameId: game.id,
        mode: game.mode,
        maxGuesses: MAX_GUESSES,
        guesses: game.guesses,
      };
    });
    res.json(response);
  })
);

router.post(
  '/:id/guess',
  rateLimit({
    name: 'game-guess',
    limit: 30,
    windowSeconds: 10,
    key: (req) => req.user ? `u:${req.user.id}` : `g:${req.guestKey ?? req.ip}`,
  }),
  validateBody(z.object({ playerId: z.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = String(req.params.id);
    const response = await withKeyLock(`single-game:${gameId}`, async () => {
      const game = await loadOwnedGame(gameId, owner.identityKey);
      const guess = getPlayer(req.body.playerId);
      if (!guess) throw new HttpError(404, 'PLAYER_NOT_FOUND');
      const target = getPlayer(game.targetPlayerId);
      if (!target) throw new HttpError(500, 'INTERNAL_ERROR');
      if (game.guesses.some((item) => item.playerId === guess.id)) {
        throw new HttpError(400, 'ALREADY_GUESSED');
      }

      const feedback = compareGuess(guess, target);
      game.guesses.push(feedback);
      const finished = feedback.correct || game.guesses.length >= MAX_GUESSES;
      const status = feedback.correct ? 'won' : finished ? 'lost' : 'playing';
      if (finished) await settleGame(game, feedback.correct ? 'won' : 'lost');
      else await saveSingleGame(game);

      return {
        feedback,
        status,
        guessCount: game.guesses.length,
        maxGuesses: MAX_GUESSES,
        answer: finished ? answerView(target) : undefined,
      };
    });
    res.json(response);
  })
);

router.post(
  '/:id/giveup',
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = String(req.params.id);
    const response = await withKeyLock(`single-game:${gameId}`, async () => {
      const game = await loadOwnedGame(gameId, owner.identityKey);
      const target = getPlayer(game.targetPlayerId);
      if (!target) throw new HttpError(500, 'INTERNAL_ERROR');
      await settleGame(game, 'lost');
      return { status: 'lost', answer: answerView(target) };
    });
    res.json(response);
  })
);

router.post(
  '/:id/exit',
  asyncHandler(async (req, res) => {
    const owner = identity(req);
    if (!owner) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const gameId = String(req.params.id);
    await withKeyLock(`single-game:${gameId}`, async () => {
      const game = await loadSingleGame(gameId, owner.identityKey);
      if (game) await deleteSingleGame(game);
    });
    res.json({ ok: true });
  })
);

export default router;

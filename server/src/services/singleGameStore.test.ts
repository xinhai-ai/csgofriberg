import { describe, expect, it } from 'vitest';
import {
  createOrResumeSingleGame,
  deleteSingleGame,
  loadSingleGame,
  saveSingleGame,
} from './singleGameStore';
import { initRedis } from '../redis';

describe('singleGameStore', () => {
  it('requires Redis instead of silently writing active games to the database', async () => {
    await expect(createOrResumeSingleGame({
      identityKey: 'g:test',
      userId: null,
      guestKey: 'test-guest',
      mode: 'easy',
      targetPlayerId: 1,
    })).rejects.toThrow('REDIS_UNAVAILABLE');
    await expect(loadSingleGame('missing', 'g:test')).rejects.toThrow('REDIS_UNAVAILABLE');
    await expect(deleteSingleGame({
      id: 'missing',
      identityKey: 'g:test',
      userId: null,
      guestKey: 'test-guest',
      mode: 'easy',
      targetPlayerId: 1,
      guesses: [],
      createdAt: 0,
      lastActiveAt: 0,
    })).rejects.toThrow('REDIS_UNAVAILABLE');
  });

  it('restores the same active game and guesses until it is explicitly deleted', async () => {
    await initRedis();
    const identityKey = `g:single-resume-${Date.now()}`;
    const created = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetPlayerId: 1,
    });
    created.guesses.push({ playerId: 2, nickname: 'test' } as any);
    await saveSingleGame(created);

    const restored = await createOrResumeSingleGame({
      identityKey,
      userId: null,
      guestKey: identityKey.slice(2),
      mode: 'easy',
      targetPlayerId: 3,
    });
    expect(restored.id).toBe(created.id);
    expect(restored.targetPlayerId).toBe(1);
    expect(restored.guesses).toEqual(created.guesses);

    await deleteSingleGame(restored);
    expect(await loadSingleGame(restored.id, identityKey)).toBeNull();
  });
});

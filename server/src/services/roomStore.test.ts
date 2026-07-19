import { describe, expect, it } from 'vitest';
import { StoredRoom, deleteRoom, getRoomForIdentity, saveRoom, withRoomLock } from './roomStore';

function makeRoom(id: string): StoredRoom {
  const now = Date.now();
  return {
    id,
    ownerIp: '127.0.0.1',
    hostKey: 'u:1',
    status: 'waiting',
    dbType: 'normal',
    boType: 3,
    allowSpectators: false,
    round: 0,
    players: [{
      key: 'u:1', userId: 1, name: 'one', socketId: 's1', ready: true,
      score: 0, guesses: [], connected: true, disconnectDeadline: null,
    }],
    spectators: [],
    targetPlayerId: null,
    roundEndsAt: null,
    nextRoundAt: null,
    eventResults: {},
    createdAt: now,
    updatedAt: now,
  };
}

describe('roomStore local fallback', () => {
  it('serializes concurrent room updates and indexes identities', async () => {
    const room = makeRoom(`T${Date.now()}`);
    await saveRoom(room);
    await Promise.all(Array.from({ length: 20 }, () =>
      withRoomLock(room.id, (locked) => {
        locked.players[0].score += 1;
      })
    ));
    const found = await getRoomForIdentity('u:1');
    expect(found?.players[0].score).toBe(20);
    if (found) await deleteRoom(found);
  });
});

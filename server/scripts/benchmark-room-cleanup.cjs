process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
process.env.REDIS_REQUIRED = 'true';
process.env.REDIS_PREFIX = `csgofriberg-benchmark:${process.pid}:`;
process.env.DB_CLIENT ||= 'sqlite';

const { performance } = require('perf_hooks');
const {
  clearIdentityRoom,
  deleteRoom,
  getRoom,
  removeExpiredSpectators,
  saveRoom,
  withRoomLock,
} = require('../dist/services/roomStore');
const { closeRedis, initRedis, redis } = require('../dist/redis');

function makeRoom(id, spectatorCount) {
  const now = Date.now();
  const owner = `g:owner-${id}`;
  return {
    id,
    ownerIp: '127.0.0.1',
    hostKey: owner,
    status: 'waiting',
    dbType: 'normal',
    boType: 3,
    allowSpectators: true,
    anonymous: false,
    round: 0,
    players: [{
      key: owner,
      userId: null,
      name: 'owner',
      socketId: `socket-${id}`,
      ready: true,
      score: 0,
      guesses: [],
      lastGuessAt: null,
      connected: true,
      disconnectDeadline: null,
    }],
    spectators: Array.from({ length: spectatorCount }, (_, index) => ({
      key: `g:spectator-${id}-${index}`,
      userId: null,
      name: `spectator-${index}`,
      socketId: `socket-${id}-${index}`,
      connected: false,
      disconnectDeadline: now - 1,
    })),
    targetPlayerId: null,
    roundEndsAt: null,
    nextRoundAt: null,
    eventResults: {},
    roundResult: null,
    matchResult: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function oldCleanup(room) {
  const identities = room.spectators.map((spectator) => spectator.key);
  for (const identity of identities) {
    await getRoom(room.id);
    await withRoomLock(room.id, (locked) => {
      locked.spectators = locked.spectators.filter((spectator) => spectator.key !== identity);
      return { room: locked };
    });
    await clearIdentityRoom(identity, room.id);
  }
}

async function timed(label, fn) {
  const started = performance.now();
  await fn();
  return { label, ms: Number((performance.now() - started).toFixed(2)) };
}

async function run(spectatorCount) {
  const oldRoom = makeRoom(`old-${spectatorCount}-${Date.now()}`, spectatorCount);
  const newRoom = makeRoom(`new-${spectatorCount}-${Date.now()}`, spectatorCount);
  await saveRoom(oldRoom);
  await saveRoom(newRoom);
  const oldResult = await timed('old-per-item', () => oldCleanup(oldRoom));
  const newResult = await timed('new-batched', () => removeExpiredSpectators(
    newRoom.id,
    newRoom.spectators.map((spectator) => spectator.key),
  ));
  const oldStored = await getRoom(oldRoom.id);
  const newStored = await getRoom(newRoom.id);
  const output = {
    spectatorCount,
    old: oldResult.ms,
    new: newResult.ms,
    speedup: Number((oldResult.ms / newResult.ms).toFixed(2)),
    oldRemaining: oldStored?.spectators.length ?? -1,
    newRemaining: newStored?.spectators.length ?? -1,
  };
  if (oldStored) await deleteRoom(oldStored);
  if (newStored) await deleteRoom(newStored);
  return output;
}

async function clearBenchmarkKeys() {
  const client = redis();
  if (!client) return;
  for await (const value of client.scanIterator({
    MATCH: `${process.env.REDIS_PREFIX}*`,
    COUNT: 100,
  })) {
    const keys = Array.isArray(value) ? value : [value];
    if (keys.length) await client.del(keys);
  }
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function payloadComparison(spectatorCount = 100) {
  const spectators = Array.from({ length: spectatorCount }, (_, index) => ({
    key: `g:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `spectator-${index}`,
  }));
  const room = {
    id: 'ABCDE',
    hostKey: 'g:player-a',
    status: 'waiting',
    dbType: 'normal',
    boType: 3,
    allowSpectators: true,
    anonymous: false,
    round: 0,
    winsNeeded: 2,
    maxGuesses: 8,
    roundEndsAt: null,
    roundId: 0,
    stateVersion: 42,
    spectators,
    roundResult: null,
    matchResult: null,
    players: ['a', 'b'].map((key, index) => ({
      key: `g:player-${key}`,
      name: `player-${index + 1}`,
      ready: index === 0,
      connected: true,
      score: 0,
      guessCount: 0,
      guesses: [],
    })),
  };
  const readyPatch = {
    roomId: room.id,
    baseVersion: 41,
    stateVersion: 42,
    players: { updated: [{ key: 'g:player-b', ready: true }] },
  };
  const guessBase = {
    kind: 'applied',
    round: 1,
    correct: false,
    shouldFinish: false,
    matchOver: false,
    revision: 43,
    guessCount: 1,
    playerKeys: ['g:player-a', 'g:player-b'],
  };
  const oldGuessResult = { ...guessBase, spectatorKeys: spectators.map((item) => item.key) };
  const newGuessResult = guessBase;
  const fullRoomBytes = serializedBytes(room);
  const readyPatchBytes = serializedBytes(readyPatch);
  const oldGuessBytes = serializedBytes(oldGuessResult);
  const newGuessBytes = serializedBytes(newGuessResult);
  return {
    spectatorCount,
    readyBroadcast: {
      fullRoomBytes,
      patchBytes: readyPatchBytes,
      reduction: Number((fullRoomBytes / readyPatchBytes).toFixed(2)),
    },
    guessLuaResponse: {
      oldBytes: oldGuessBytes,
      newBytes: newGuessBytes,
      reduction: Number((oldGuessBytes / newGuessBytes).toFixed(2)),
    },
  };
}

(async () => {
  await initRedis();
  try {
    const results = [];
    for (const count of [10, 40, 100]) results.push(await run(count));
    console.log(JSON.stringify({ cleanup: results, payloads: payloadComparison() }, null, 2));
  } finally {
    await clearBenchmarkKeys();
    await closeRedis();
  }
})().catch(async (error) => {
  console.error(error.stack || error);
  await closeRedis();
  process.exitCode = 1;
});

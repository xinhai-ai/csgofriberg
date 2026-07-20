const http = require('http');
const { fork } = require('child_process');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const { Server } = require('socket.io');
const { io: clientIo } = require('socket.io-client');

const CLIENT_MODE = process.argv.includes('--client');
function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const CLIENTS = Number(argument('clients') || process.env.WS_BENCH_CLIENTS || 20);
const WARMUP_MESSAGES = Number(process.env.WS_BENCH_WARMUP || 50);
const MESSAGE_COUNTS = {
  patch: Number(argument('patch-messages') || process.env.WS_BENCH_PATCH_MESSAGES || 3000),
  guess: Number(argument('guess-messages') || process.env.WS_BENCH_GUESS_MESSAGES || 1500),
  room: Number(argument('room-messages') || process.env.WS_BENCH_ROOM_MESSAGES || 300),
};
const COMPRESSION_THRESHOLD = Number(argument('threshold') || process.env.WS_BENCH_THRESHOLD || 1024);
const TIMEOUT_MS = Number(process.env.WS_BENCH_TIMEOUT_MS || 120000);
const COMPRESSION_MODES = (argument('modes') || process.env.WS_BENCH_MODES || 'off,takeover,threshold,selective')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => ['off', 'takeover', 'threshold', 'selective'].includes(value));

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function makePatch(index) {
  return {
    roomId: 'ABCDE',
    baseVersion: 40 + index,
    stateVersion: 41 + index,
    players: { updated: [{ key: 'g:player-b', ready: index % 2 === 0 }] },
  };
}

function attribute(value, level, hint) {
  return hint ? { value, level, hint } : { value, level };
}

function makeGuess(index) {
  return {
    roomId: 'ABCDE',
    roundId: 7,
    key: 'g:71316e5e-8f73-4506-bbce-d9cfb0625b1e',
    stateVersion: 1000 + index,
    feedback: {
      playerId: 1000 + (index % 250),
      nickname: `benchmark-player-${index % 250}`,
      correct: false,
      attributes: {
        nationality: attribute('Denmark', 'correct'),
        team: attribute('Team Vitality', 'wrong'),
        age: attribute(27, 'close', 'lower'),
        role: attribute('Rifler', 'wrong'),
        majorChampionships: attribute(1, 'close', 'higher'),
        majorAppearances: attribute(12, 'close', 'lower'),
        isActive: attribute(true, 'correct'),
      },
    },
  };
}

function makeRoom(index) {
  return {
    id: 'ABCDE',
    hostKey: 'g:player-a',
    status: 'waiting',
    dbType: 'normal',
    boType: 3,
    allowSpectators: true,
    anonymous: false,
    round: 0,
    roundId: 0,
    stateVersion: 1000 + index,
    winsNeeded: 2,
    maxGuesses: 8,
    roundEndsAt: null,
    spectatorCount: 100,
    players: ['a', 'b'].map((key, playerIndex) => ({
      key: `g:player-${key}`,
      name: `player-${playerIndex + 1}`,
      ready: playerIndex === 0,
      connected: true,
      score: 0,
      guessCount: 0,
      guesses: [],
    })),
    roundResult: null,
    matchResult: null,
  };
}

const PAYLOADS = {
  patch: makePatch,
  guess: makeGuess,
  room: makeRoom,
};

function waitForMessage(child, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for client message: ${type}`));
    }, TIMEOUT_MS);
    const onMessage = (message) => {
      if (message?.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Benchmark client exited before ${type} (code ${code})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function runClient() {
  const url = process.env.WS_BENCH_URL;
  const expectedMessages = Number(process.env.WS_BENCH_EXPECTED_MESSAGES);
  const sockets = [];
  let warmupReceived = 0;
  let messagesReceived = 0;
  let warmupReported = false;
  let doneReported = false;

  await Promise.all(Array.from({ length: CLIENTS }, () => new Promise((resolve, reject) => {
    const socket = clientIo(url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    socket.on('bench:warmup', () => {
      warmupReceived += 1;
      if (!warmupReported && warmupReceived === WARMUP_MESSAGES * CLIENTS) {
        warmupReported = true;
        process.send?.({ type: 'warmup-done' });
      }
    });
    socket.on('bench:event', () => {
      messagesReceived += 1;
      if (!doneReported && messagesReceived === expectedMessages * CLIENTS) {
        doneReported = true;
        process.send?.({ type: 'done' });
      }
    });
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  })));

  process.send?.({ type: 'ready' });
  await new Promise((resolve) => {
    process.on('message', (message) => {
      if (message?.type !== 'stop') return;
      for (const socket of sockets) socket.disconnect();
      resolve();
    });
  });
}

function sumBytesWritten(sockets) {
  let total = 0;
  for (const socket of sockets) total += socket.bytesWritten;
  return total;
}

function emitInBatches(io, event, count, makePayload, compress = true) {
  return new Promise((resolve) => {
    let index = 0;
    const target = compress ? io : io.compress(false);
    const next = () => {
      const end = Math.min(index + 100, count);
      while (index < end) {
        target.emit(event, makePayload(index));
        index += 1;
      }
      if (index < count) setImmediate(next);
      else resolve();
    };
    next();
  });
}

async function closeServer(io, server) {
  await new Promise((resolve) => io.close(resolve));
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

function compressionOptions(mode) {
  if (mode === 'off') return false;
  if (mode === 'takeover') return { threshold: COMPRESSION_THRESHOLD };
  return {
    threshold: COMPRESSION_THRESHOLD,
    serverNoContextTakeover: true,
    clientNoContextTakeover: true,
  };
}

function compressionLabel(mode) {
  if (mode === 'off') return 'off';
  if (mode === 'takeover') return `deflate with context takeover (threshold ${COMPRESSION_THRESHOLD} B)`;
  if (mode === 'selective') return `deflate only for snapshots (threshold ${COMPRESSION_THRESHOLD} B)`;
  return `deflate without context takeover (threshold ${COMPRESSION_THRESHOLD} B)`;
}

async function runScenario({ mode, payloadName }) {
  const rawSockets = new Set();
  const negotiatedExtensions = new Set();
  const server = http.createServer();
  server.on('connection', (socket) => {
    rawSockets.add(socket);
    socket.once('close', () => rawSockets.delete(socket));
  });
  const io = new Server(server, {
    transports: ['websocket'],
    perMessageDeflate: compressionOptions(mode),
  });
  io.on('connection', (socket) => {
    const extensions = socket.conn.transport.socket?._extensions;
    for (const name of Object.keys(extensions || {})) negotiatedExtensions.add(name);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  const messageCount = MESSAGE_COUNTS[payloadName];
  const child = fork(__filename, ['--client'], {
    env: {
      ...process.env,
      WS_BENCH_URL: url,
      WS_BENCH_CLIENTS: String(CLIENTS),
      WS_BENCH_EXPECTED_MESSAGES: String(messageCount),
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });

  try {
    await waitForMessage(child, 'ready');
    const makePayload = PAYLOADS[payloadName];
    const compressPayload = mode !== 'selective' || payloadName === 'room';
    const warmupDone = waitForMessage(child, 'warmup-done');
    await emitInBatches(io, 'bench:warmup', WARMUP_MESSAGES, makePayload, compressPayload);
    await warmupDone;

    const baselineBytes = sumBytesWritten(rawSockets);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const cpuStarted = process.cpuUsage();
    const wallStarted = performance.now();
    const done = waitForMessage(child, 'done');
    await emitInBatches(io, 'bench:event', messageCount, makePayload, compressPayload);
    await done;
    const elapsedMs = performance.now() - wallStarted;
    const cpu = process.cpuUsage(cpuStarted);
    delay.disable();
    const wireBytes = sumBytesWritten(rawSockets) - baselineBytes;
    const deliveries = messageCount * CLIENTS;
    const samplePayload = makePayload(0);

    return {
      compressionMode: mode,
      compression: compressionLabel(mode),
      payload: payloadName,
      jsonPayloadBytes: Buffer.byteLength(JSON.stringify(samplePayload)),
      clients: CLIENTS,
      messages: messageCount,
      deliveries,
      wireBytes,
      bytesPerDelivery: round(wireBytes / deliveries),
      elapsedMs: round(elapsedMs),
      deliveriesPerSecond: round(deliveries / (elapsedMs / 1000), 0),
      serverCpuMs: round((cpu.user + cpu.system) / 1000),
      cpuMsPer1000Deliveries: round(((cpu.user + cpu.system) / 1000) / deliveries * 1000, 3),
      eventLoopP99Ms: round(delay.percentile(99) / 1e6, 3),
      eventLoopMaxMs: round(delay.max / 1e6, 3),
      negotiatedExtensions: [...negotiatedExtensions],
    };
  } finally {
    if (child.connected) child.send({ type: 'stop' });
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await closeServer(io, server);
  }
}

async function runBenchmark() {
  const results = [];
  const payloadNames = (argument('payloads') || process.env.WS_BENCH_PAYLOADS || Object.keys(PAYLOADS).join(','))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => Object.hasOwn(PAYLOADS, value));
  if (!payloadNames.length || !COMPRESSION_MODES.length) {
    throw new Error('No valid payloads or compression modes selected');
  }
  for (const payloadName of payloadNames) {
    for (const mode of COMPRESSION_MODES) {
      results.push(await runScenario({ mode, payloadName }));
    }
  }

  const comparisons = payloadNames.flatMap((payloadName) => {
    const plain = results.find((result) => (
      result.payload === payloadName && result.compressionMode === 'off'
    ));
    if (!plain) return [];
    return COMPRESSION_MODES.filter((mode) => mode !== 'off').map((mode) => {
      const compressed = results.find((result) => (
        result.payload === payloadName && result.compressionMode === mode
      ));
      return {
        payload: payloadName,
        compressionMode: mode,
        bandwidthReductionPercent: round((1 - compressed.wireBytes / plain.wireBytes) * 100),
        cpuIncreasePercent: round((compressed.serverCpuMs / plain.serverCpuMs - 1) * 100),
        throughputChangePercent: round((compressed.deliveriesPerSecond / plain.deliveriesPerSecond - 1) * 100),
        addedCpuMsPer1000Deliveries: round(
          compressed.cpuMsPer1000Deliveries - plain.cpuMsPer1000Deliveries,
          3,
        ),
      };
    });
  });

  console.log(JSON.stringify({
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      compressionThreshold: COMPRESSION_THRESHOLD,
    },
    results,
    comparisons,
  }, null, 2));
}

(CLIENT_MODE ? runClient() : runBenchmark()).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as clientIo, Socket as ClientSocket } from 'socket.io-client';
import { initDb } from '../db/init';
import { db } from '../db/knex';
import { initRedis, redis } from '../redis';
import { initPlayerCache } from '../services/playerCache';
import { setupSocket } from './index';
import { browserFingerprint, POW_COOKIE } from '../services/pow';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { guestNameFromKey, signToken } from '../middleware/auth';

let server: http.Server;
let io: Server;
let baseUrl: string;
let stopSocket: (() => void) | undefined;
const createdRoomIds: string[] = [];
const TEST_USER_AGENT = 'csgofriberg-socket-test';

function connect(cookie: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = clientIo(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie, 'User-Agent': TEST_USER_AGENT },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function withPowCookie(cookie: string, expiresIn: string | number = '10m'): string {
  const token = jwt.sign(
    {
      typ: 'pow',
      fp: browserFingerprint(TEST_USER_AGENT),
      jti: `test-${Date.now()}-${Math.random()}`,
      difficulty: 18,
    },
    config.jwtSecret,
    { expiresIn, algorithm: 'HS256' }
  );
  return `${cookie}; ${POW_COOKIE}=${token}`;
}

function emit(socket: ClientSocket, event: string, payload: unknown = {}): Promise<any> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

describe('multiplayer socket integration', () => {
  beforeAll(async () => {
    await initDb();
    await initRedis();
    await initPlayerCache();
    server = http.createServer();
    io = new Server(server, { cors: { origin: '*' } });
    stopSocket = setupSocket(io);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    const client = redis();
    if (client) {
      for (const roomId of createdRoomIds) {
        const key = `csgofriberg:room:${roomId}`;
        const raw = await client.get(key);
        if (!raw) continue;
        const room = JSON.parse(raw);
        await client.del([key, ...[...room.players, ...room.spectators]
          .map((member: any) => `csgofriberg:identity-room:${member.key}`)]);
        await client.zRem('csgofriberg:rooms:active', roomId);
        await client.zRem(`csgofriberg:rooms:active:ip:${room.ownerIp}`, roomId);
      }
    }
    stopSocket?.();
    io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serializes starts and rejects stale or duplicate guesses', async () => {
    const stamp = Date.now();
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config');
    const guestTokenA = jwt.default.sign({ key: `socket-a-${stamp}`, typ: 'guest' }, config.jwtSecret, { expiresIn: '1h' });
    const guestTokenB = jwt.default.sign({ key: `socket-b-${stamp}`, typ: 'guest' }, config.jwtSecret, { expiresIn: '1h' });
    const a = await connect(withPowCookie(`csgofriberg_guest=${guestTokenA}`));
    const b = await connect(withPowCookie(`csgofriberg_guest=${guestTokenB}`));
    try {
      const created = await emit(a, 'room:create', { dbType: 'normal', boType: 1 });
      createdRoomIds.push(created.room.id);
      expect(created.room.players[0].name).toBe(guestNameFromKey(`socket-a-${stamp}`));
      await emit(b, 'room:join', { roomId: created.room.id });
      await emit(b, 'room:ready');
      const starts = await Promise.all([emit(a, 'game:start'), emit(a, 'game:start')]);
      expect(starts.filter((result) => result.ok)).toHaveLength(1);
      const synced = await emit(a, 'room:sync');
      const room = await redis()!.get(`csgofriberg:room:${created.room.id}`);
      const stored = JSON.parse(room!);
      const targetId = stored.targetPlayerId;
      const stale = await emit(a, 'game:guess', {
        playerId: targetId,
        roundId: synced.room.roundId - 1,
        eventId: `stale-${stamp}-0001`,
      });
      expect(stale.code).toBe('STALE_ROUND');
      const eventId = `valid-${stamp}-0001`;
      const results = await Promise.all([
        emit(a, 'game:guess', { playerId: targetId, roundId: synced.room.roundId, eventId }),
        emit(a, 'game:guess', { playerId: targetId, roundId: synced.room.roundId, eventId }),
        emit(b, 'game:guess', { playerId: targetId, roundId: synced.room.roundId, eventId: `valid-${stamp}-0002` }),
      ]);
      expect(results.filter((result) => result.feedback?.correct)).toHaveLength(2);
      const finalRoom = JSON.parse((await redis()!.get(`csgofriberg:room:${created.room.id}`))!);
      expect(finalRoom.players.reduce((sum: number, player: any) => sum + player.score, 0)).toBe(1);
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });

  it('limits concurrent sockets for one identity', async () => {
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config');
    const token = jwt.default.sign(
      { key: `socket-limit-${Date.now()}`, typ: 'guest' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const cookie = withPowCookie(`csgofriberg_guest=${token}`);
    const sockets = await Promise.all([connect(cookie), connect(cookie), connect(cookie)]);
    try {
      await expect(connect(cookie)).rejects.toMatchObject({ message: 'TOO_MANY_CONNECTIONS' });
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  });

  it('restores room state after reconnect without forfeiting', async () => {
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config');
    const stamp = Date.now();
    const tokenA = jwt.default.sign({ key: `reconnect-a-${stamp}`, typ: 'guest' }, config.jwtSecret, { expiresIn: '1h' });
    const tokenB = jwt.default.sign({ key: `reconnect-b-${stamp}`, typ: 'guest' }, config.jwtSecret, { expiresIn: '1h' });
    const cookieA = withPowCookie(`csgofriberg_guest=${tokenA}`);
    const cookieB = withPowCookie(`csgofriberg_guest=${tokenB}`);
    let a = await connect(cookieA);
    const b = await connect(cookieB);
    try {
      const created = await emit(a, 'room:create', { dbType: 'normal', boType: 3 });
      createdRoomIds.push(created.room.id);
      await emit(b, 'room:join', { roomId: created.room.id });
      await emit(b, 'room:ready');
      await emit(a, 'game:start');
      const before = await emit(a, 'room:sync');
      a.disconnect();
      a = await connect(cookieA);
      const restored = await emit(a, 'room:sync');
      expect(restored.room.id).toBe(before.room.id);
      expect(restored.room.roundId).toBe(before.room.roundId);
      expect(restored.room.players.every((player: any) => player.connected)).toBe(true);
      await emit(a, 'room:leave');
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });

  it('does not interrupt an established socket when its PoW pass expires', async () => {
    const token = jwt.sign(
      { key: `socket-expiry-${Date.now()}`, typ: 'guest' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const socket = await connect(withPowCookie(`csgofriberg_guest=${token}`, 1));
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(socket.connected).toBe(true);
      const synced = await emit(socket, 'room:sync');
      expect(synced.code).toBe('NOT_IN_ROOM');
    } finally {
      socket.disconnect();
    }
  });

  it('restricts live presence stats to admins and deduplicates their sockets', async () => {
    const stamp = Date.now();
    const guestToken = jwt.sign(
      { key: `presence-guest-${stamp}`, typ: 'guest' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const guest = await connect(withPowCookie(`csgofriberg_guest=${guestToken}`));
    const [adminId] = await db('users')
      .insert({
        username: `presence-admin-${stamp}`,
        password_hash: 'not-used',
        role: 'admin',
        token_version: 0,
      })
      .returning('id')
      .then((rows) => rows.map((row: any) => typeof row === 'object' ? row.id : row));
    const adminToken = signToken({ id: adminId, token_version: 0 });
    const adminCookie = withPowCookie(`csgofriberg_session=${adminToken}`);
    const adminA = await connect(adminCookie);
    const adminB = await connect(adminCookie);
    try {
      expect((await emit(guest, 'presence:subscribe')).code).toBe('FORBIDDEN');
      const subscribed = await emit(adminA, 'presence:subscribe');
      expect(subscribed.ok).toBe(true);
      expect(subscribed.stats).toMatchObject({
        onlineUsers: expect.any(Number),
        multiplayerRooms: expect.any(Number),
        singleGames: expect.any(Number),
      });
      expect(await redis()!.zScore('csgofriberg:presence:online', `u:${adminId}`)).not.toBeNull();
      expect(await redis()!.zCard(`csgofriberg:connections:identity:u:${adminId}`)).toBe(2);
      expect(await redis()!.zCount(
        'csgofriberg:presence:online',
        '-inf',
        '+inf'
      )).toBeGreaterThanOrEqual(1);
    } finally {
      guest.disconnect();
      adminA.disconnect();
      adminB.disconnect();
      await db('users').where({ id: adminId }).del();
    }
  });

  it('tracks active multiplayer rooms until they are deleted', async () => {
    const stamp = Date.now();
    const guestToken = jwt.sign(
      { key: `presence-room-${stamp}`, typ: 'guest' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );
    const socket = await connect(withPowCookie(`csgofriberg_guest=${guestToken}`));
    try {
      const created = await emit(socket, 'room:create', { dbType: 'easy', boType: 1 });
      createdRoomIds.push(created.room.id);
      expect(await redis()!.zScore('csgofriberg:presence:rooms', created.room.id)).not.toBeNull();
      await emit(socket, 'room:leave');
      expect(await redis()!.zScore('csgofriberg:presence:rooms', created.room.id)).toBeNull();
    } finally {
      socket.disconnect();
    }
  });
});

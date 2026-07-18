import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/knex';
import { User } from '../types';
import { redis, redisKey } from '../redis';

const AUTH_COOKIE = 'csgofriberg_session';
const GUEST_COOKIE = 'csgofriberg_guest';
const AUTH_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const GUEST_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

interface AuthTokenPayload {
  sub: string;
  ver: number;
  typ: 'auth';
}

interface GuestTokenPayload {
  key: string;
  typ: 'guest';
}

export interface AuthPayload {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

export interface GuestIdentity {
  key: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      guestKey?: string;
      guestName?: string;
    }
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const index = part.indexOf('=');
      const key = index >= 0 ? part.slice(0, index).trim() : part.trim();
      const value = index >= 0 ? part.slice(index + 1).trim() : '';
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    })
  );
}

export function signToken(user: Pick<User, 'id' | 'token_version'>): string {
  return jwt.sign(
    { sub: String(user.id), ver: Number(user.token_version), typ: 'auth' } satisfies AuthTokenPayload,
    config.jwtSecret,
    { expiresIn: '2h', algorithm: 'HS256' }
  );
}

export function setAuthCookie(res: Response, user: Pick<User, 'id' | 'token_version'>): void {
  res.cookie(AUTH_COOKIE, signToken(user), cookieOptions(AUTH_MAX_AGE_MS));
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, cookieOptions(0));
}

function signGuestToken(key: string): string {
  return jwt.sign({ key, typ: 'guest' } satisfies GuestTokenPayload, config.jwtSecret, {
    expiresIn: '365d',
    algorithm: 'HS256',
  });
}

function verifyGuestToken(token: string | undefined): GuestIdentity | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as GuestTokenPayload;
    if (payload.typ !== 'guest' || !/^[\w-]{8,64}$/.test(payload.key)) return null;
    return { key: payload.key, name: `访客${payload.key.slice(0, 4)}` };
  } catch {
    return null;
  }
}

export function getGuestFromCookie(cookieHeader: string | undefined): GuestIdentity | null {
  return verifyGuestToken(parseCookies(cookieHeader)[GUEST_COOKIE]);
}

export function ensureGuestCookie(req: Request, res: Response): GuestIdentity {
  const existing = getGuestFromCookie(req.headers.cookie);
  if (existing) return existing;
  const guest = { key: crypto.randomUUID(), name: '' };
  guest.name = `访客${guest.key.slice(0, 4)}`;
  res.cookie(GUEST_COOKIE, signGuestToken(guest.key), cookieOptions(GUEST_MAX_AGE_MS));
  return guest;
}

export async function authenticateCookie(cookieHeader: string | undefined): Promise<AuthPayload | null> {
  const token = parseCookies(cookieHeader)[AUTH_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as AuthTokenPayload;
    if (payload.typ !== 'auth' || !/^\d+$/.test(payload.sub)) return null;
    const userId = Number(payload.sub);
    const client = redis();
    const cacheKey = redisKey(`auth:user:${userId}`);
    const versionKey = redisKey(`auth:version:${userId}`);
    let user: User | undefined;
    let currentVersion: number | null = null;
    if (client) {
      const cachedVersion = await client.get(versionKey);
      if (cachedVersion != null) currentVersion = Number(cachedVersion);
      const cached = await client.get(cacheKey);
      if (cached) user = JSON.parse(cached) as User;
    }
    if (!user || currentVersion == null) {
      user = await db<User>('users').where({ id: userId }).first();
      currentVersion = user ? Number(user.token_version) : null;
      if (user && client) {
        await client.multi()
          .set(cacheKey, JSON.stringify(user), { EX: 300 })
          .set(versionKey, String(currentVersion))
          .exec();
      }
    }
    if (!user || currentVersion !== Number(payload.ver)) return null;
    return { id: user.id, username: user.username, role: user.role };
  } catch {
    return null;
  }
}

export async function invalidateAuthUser(userId: number): Promise<void> {
  const client = redis();
  if (!client) return;
  const user = await db<User>('users').where({ id: userId }).first();
  const multi = client.multi().del(redisKey(`auth:user:${userId}`));
  if (user) multi.set(redisKey(`auth:version:${userId}`), String(user.token_version));
  else multi.del(redisKey(`auth:version:${userId}`));
  await multi.exec();
}

async function attachIdentity(req: Request, res: Response): Promise<void> {
  const user = await authenticateCookie(req.headers.cookie);
  if (user) req.user = user;
  const guest = ensureGuestCookie(req, res);
  req.guestKey = guest.key;
  req.guestName = guest.name;
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  void attachIdentity(req, res).then(() => next(), next);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  void attachIdentity(req, res).then(() => {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED' });
    next();
  }, next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED' });
  void db<User>('users').where({ id: req.user.id }).first().then((user) => {
    if (!user || user.role !== 'admin') return res.status(403).json({ code: 'FORBIDDEN' });
    req.user = { id: user.id, username: user.username, role: user.role };
    next();
  }, next);
}

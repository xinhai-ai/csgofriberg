import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/knex';
import { User } from '../types';
import { redis, redisKey } from '../redis';

const AUTH_COOKIE = 'csgofriberg_session';
const GUEST_COOKIE = 'csgofriberg_guest';
const AUTH_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;
const GUEST_MAX_AGE_MS = 3 * 365 * 24 * 60 * 60 * 1000;

interface AuthTokenPayload {
  sub: string;
  ver: number;
  typ: 'auth';
}

interface GuestTokenPayload {
  key: string;
  typ: 'guest';
}

interface CachedAuthUser extends AuthPayload {
  tokenVersion: number;
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

export function guestNameFromKey(key: string): string {
  const value = crypto
    .createHmac('sha256', config.guestIdSalt)
    .update('csgofriberg-guest-id-v1\0', 'ascii')
    .update(key, 'utf8')
    .digest()
    .readUInt32BE(0) % (36 ** 5);
  return `访客#${value.toString(36).padStart(5, '0').toUpperCase()}`;
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
    { expiresIn: '15d', algorithm: 'HS256' }
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
    expiresIn: '1095d',
    algorithm: 'HS256',
  });
}

function verifyGuestToken(token: string | undefined): GuestIdentity | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as GuestTokenPayload;
    if (payload.typ !== 'guest' || !/^[\w-]{8,64}$/.test(payload.key)) return null;
    return { key: payload.key, name: guestNameFromKey(payload.key) };
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
  guest.name = guestNameFromKey(guest.key);
  res.cookie(GUEST_COOKIE, signGuestToken(guest.key), cookieOptions(GUEST_MAX_AGE_MS));
  return guest;
}

export async function authenticateCookie(cookieHeader: string | undefined): Promise<AuthPayload | null> {
  const token = parseCookies(cookieHeader)[AUTH_COOKIE];
  if (!token) return null;
  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as AuthTokenPayload;
  } catch {
    return null;
  }
  if (payload.typ !== 'auth' || !/^\d+$/.test(payload.sub)) return null;
  const userId = Number(payload.sub);
  const client = redis();
  const cacheKey = redisKey(`auth:user:${userId}`);
  if (client) {
    try {
      const cached = await client.get(cacheKey);
      if (cached) {
        const user = JSON.parse(cached) as CachedAuthUser;
        if (user.tokenVersion !== Number(payload.ver)) return null;
        return { id: user.id, username: user.username, role: user.role };
      }
    } catch (err) {
      console.warn('[auth:cache-read]', err instanceof Error ? err.message : err);
    }
  }
  const user = await db<User>('users').where({ id: userId }).first();
  if (!user || Number(user.token_version) !== Number(payload.ver)) return null;
  if (client) {
    const cached: CachedAuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: Number(user.token_version),
    };
    try {
      await client.set(cacheKey, JSON.stringify(cached), { EX: 300 });
    } catch (err) {
      console.warn('[auth:cache-write]', err instanceof Error ? err.message : err);
    }
  }
  return { id: user.id, username: user.username, role: user.role };
}

export async function invalidateAuthUser(userId: number): Promise<void> {
  const client = redis();
  if (!client) return;
  await client.del(redisKey(`auth:user:${userId}`));
}

async function attachIdentity(req: Request, res: Response): Promise<void> {
  const user = await authenticateCookie(req.headers.cookie);
  if (user) req.user = user;
  const guest = user
    ? getGuestFromCookie(req.headers.cookie)
    : ensureGuestCookie(req, res);
  if (!guest) return;
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
  if (req.user.role !== 'admin') return res.status(403).json({ code: 'FORBIDDEN' });
  next();
}

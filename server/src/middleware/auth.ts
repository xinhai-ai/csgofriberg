import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthPayload {
  id: number;
  username: string;
  role: 'user' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
      /** 匿名访客标识(请求头 X-Guest-Key),用于登录后认领对局 */
      guestKey?: string;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
}

function parseAuth(req: Request): AuthPayload | null {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  return token ? verifyToken(token) : null;
}

/** 可选认证:已登录则挂 user,匿名则读取访客 key,均放行 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const payload = parseAuth(req);
  if (payload) req.user = payload;
  const guestKey = req.headers['x-guest-key'];
  if (typeof guestKey === 'string' && /^[\w-]{8,64}$/.test(guestKey)) {
    req.guestKey = guestKey;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const payload = parseAuth(req);
  if (!payload) {
    return res.status(401).json({ code: 'AUTH_REQUIRED' });
  }
  req.user = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ code: 'FORBIDDEN' });
  }
  next();
}

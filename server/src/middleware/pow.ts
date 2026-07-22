import { NextFunction, Request, Response } from 'express';
import { getRequestPow } from '../services/pow';

export function requirePow(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS') return next();
  const access = getRequestPow(req);
  if (!access) return res.status(428).json({ code: 'POW_REQUIRED' });
  res.setHeader('X-PoW-Expires-At', String(access.expiresAt));
  res.setHeader('X-PoW-Expires-In', String(Math.max(0, access.expiresAt - Date.now())));
  next();
}

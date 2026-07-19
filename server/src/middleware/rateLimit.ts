import { Request, Response, NextFunction } from 'express';
import { redis, redisKey } from '../redis';
import { config } from '../config';

interface RateLimitOptions {
  name: string;
  limit: number;
  windowSeconds: number;
  key?: (req: Request) => string;
  failClosed?: boolean;
}

const localCounters = new Map<string, { count: number; expiresAt: number }>();

export async function consumeRateLimit(
  name: string,
  identity: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = redisKey(`rl:${name}:${identity}:${bucket}`);
  const client = redis();
  if (client) {
    const bounded = client.withCommandOptions({ timeout: config.redisCommandTimeoutMs });
    const result = await bounded.multi()
      .incr(key)
      .expire(key, windowSeconds + 1)
      .exec();
    const count = Number(result?.[0] ?? 0);
    return count <= limit;
  }
  const now = Date.now();
  const current = localCounters.get(key);
  const item = !current || current.expiresAt <= now
    ? { count: 1, expiresAt: now + windowSeconds * 1000 }
    : { count: current.count + 1, expiresAt: current.expiresAt };
  localCounters.set(key, item);
  return item.count <= limit;
}

function remoteIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Prefer an authenticated/guest identity so users behind one NAT do not share a bucket. */
export function requestIdentity(req: Request): string {
  if (req.user) return `u:${req.user.id}`;
  if (req.guestKey) return `g:${req.guestKey}`;
  return remoteIp(req);
}

export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identity = options.key?.(req) || remoteIp(req);
    try {
      if (!(await consumeRateLimit(
        options.name,
        identity,
        options.limit,
        options.windowSeconds
      ))) {
        return res.status(429).json({ code: 'RATE_LIMITED' });
      }
      next();
    } catch (err) {
      if (options.failClosed) return res.status(503).json({ code: 'RATE_LIMIT_UNAVAILABLE' });
      next();
    }
  };
}

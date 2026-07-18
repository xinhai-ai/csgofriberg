import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/knex';
import {
  clearAuthCookie,
  ensureGuestCookie,
  authenticateCookie,
  requireAuth,
  setAuthCookie,
  invalidateAuthUser,
} from '../middleware/auth';
import { validateBody, asyncHandler, HttpError } from '../middleware/common';
import { User } from '../types';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

const credentialsSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[\w一-龥-]+$/),
  password: z.string().min(10).max(128),
});

router.post(
  '/register',
  rateLimit({ name: 'register', limit: 5, windowSeconds: 3600, failClosed: true }),
  validateBody(credentialsSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const existing = await db<User>('users').where({ username }).first();
    if (existing) throw new HttpError(409, 'USERNAME_TAKEN');

    const role = 'user' as const;

    const [id] = await db('users')
      .insert({
        username,
        password_hash: await bcrypt.hash(password, 10),
        role,
      })
      .returning('id')
      .then((rows) => rows.map((r: any) => (typeof r === 'object' ? r.id : r)));

    const user = { id, username, role, token_version: 0 };
    setAuthCookie(res, user);
    res.json({ user: { id, username, role } });
  })
);

router.post(
  '/login',
  rateLimit({
    name: 'login',
    limit: 10,
    windowSeconds: 60,
    failClosed: true,
    key: (req) => `${req.ip}:${String(req.body?.username ?? '').toLowerCase()}`,
  }),
  validateBody(credentialsSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const user = await db<User>('users').where({ username }).first();
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    setAuthCookie(res, user);
    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post(
  '/session',
  rateLimit({ name: 'session', limit: 60, windowSeconds: 60 }),
  asyncHandler(async (req, res) => {
    const user = await authenticateCookie(req.headers.cookie);
    if (user) return res.json({ authenticated: true, user });
    const guest = ensureGuestCookie(req, res);
    res.json({ authenticated: false, guest: { name: guest.name } });
  })
);

router.post(
  '/logout',
  rateLimit({ name: 'logout', limit: 30, windowSeconds: 60 }),
  requireAuth,
  asyncHandler(async (req, res) => {
    await db('users').where({ id: req.user!.id }).increment('token_version', 1);
    await invalidateAuthUser(req.user!.id);
    clearAuthCookie(res);
    ensureGuestCookie(req, res);
    res.json({ ok: true });
  })
);

/** 登录后认领匿名期间的对局记录,实现本地进度同步到账号 */
router.post(
  '/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.guestKey) throw new HttpError(400, 'GUEST_KEY_REQUIRED');
    const claimed = await db('games')
      .where({ guest_key: req.guestKey })
      .whereNull('user_id')
      .update({ user_id: req.user!.id, guest_key: null });
    res.json({ claimed });
  })
);

export default router;

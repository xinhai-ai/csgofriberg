import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/knex';
import { config } from '../config';
import { signToken, requireAuth } from '../middleware/auth';
import { validateBody, asyncHandler, HttpError } from '../middleware/common';
import { User } from '../types';

const router = Router();

const credentialsSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[\w一-龥-]+$/),
  password: z.string().min(6).max(64),
});

router.post(
  '/register',
  validateBody(credentialsSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const existing = await db<User>('users').where({ username }).first();
    if (existing) throw new HttpError(409, 'USERNAME_TAKEN');

    const userCount = Number(
      (await db('users').count<{ c: number }[]>({ c: '*' }))[0].c
    );
    const role =
      userCount === 0 || config.adminUsernames.includes(username)
        ? 'admin'
        : 'user';

    const [id] = await db('users')
      .insert({
        username,
        password_hash: await bcrypt.hash(password, 10),
        role,
      })
      .returning('id')
      .then((rows) => rows.map((r: any) => (typeof r === 'object' ? r.id : r)));

    const token = signToken({ id, username, role });
    res.json({ token, user: { id, username, role } });
  })
);

router.post(
  '/login',
  validateBody(credentialsSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const user = await db<User>('users').where({ username }).first();
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    const token = signToken({ id: user.id, username: user.username, role: user.role });
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** 登录后认领匿名期间的对局记录,实现本地进度同步到账号 */
router.post(
  '/claim',
  requireAuth,
  validateBody(z.object({ guestKey: z.string().regex(/^[\w-]{8,64}$/) })),
  asyncHandler(async (req, res) => {
    const claimed = await db('games')
      .where({ guest_key: req.body.guestKey })
      .whereNull('user_id')
      .update({ user_id: req.user!.id, guest_key: null });
    res.json({ claimed });
  })
);

export default router;

import { Router } from 'express';
import { db } from '../db/knex';
import { asyncHandler } from '../middleware/common';
import { cached } from '../services/queryCache';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

router.get(
  '/',
  rateLimit({ name: 'announcements', limit: 60, windowSeconds: 60, failClosed: true }),
  asyncHandler(async (_req, res) => {
    const rows = await cached('announcements', 300, () =>
      db('announcements').orderBy('created_at', 'desc').limit(50)
    );
    res.json(rows);
  })
);

export default router;

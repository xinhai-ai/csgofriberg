import { Router } from 'express';
import { db } from '../db/knex';
import { asyncHandler } from '../middleware/common';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db('announcements').orderBy('created_at', 'desc').limit(50);
    res.json(rows);
  })
);

export default router;

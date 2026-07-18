import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { validateBody, asyncHandler, HttpError } from '../middleware/common';
import { invalidatePlayerCache } from '../services/playerCache';
import { invalidateCached } from '../services/queryCache';

const router = Router();
router.use(requireAuth, requireAdmin);

const playerSchema = z.object({
  nickname: z.string().min(1).max(64),
  real_name: z.string().max(128).default(''),
  nationality: z.string().min(1).max(64),
  region: z.string().max(32).default(''),
  team: z.string().max(64).default(''),
  birth_year: z.number().int().min(1970).max(2015),
  role: z.string().max(32).default('Rifler'),
  major_appearances: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

router.get(
  '/players',
  asyncHandler(async (_req, res) => {
    res.json(await db('players').orderBy('nickname'));
  })
);

router.post(
  '/players',
  validateBody(playerSchema),
  asyncHandler(async (req, res) => {
    const exists = await db('players').where({ nickname: req.body.nickname }).first();
    if (exists) throw new HttpError(409, 'NICKNAME_TAKEN');
    const [id] = await db('players')
      .insert(req.body)
      .returning('id')
      .then((rows) => rows.map((r: any) => (typeof r === 'object' ? r.id : r)));
    await invalidatePlayerCache();
    res.json({ id });
  })
);

router.put(
  '/players/:id',
  validateBody(playerSchema.partial()),
  asyncHandler(async (req, res) => {
    const count = await db('players').where({ id: Number(req.params.id) }).update(req.body);
    if (!count) throw new HttpError(404, 'PLAYER_NOT_FOUND');
    await invalidatePlayerCache();
    res.json({ ok: true });
  })
);

router.delete(
  '/players/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const used = await db('games').where({ target_player_id: id }).first();
    if (used) {
      // 有历史对局引用时不物理删除,标记退役并保留数据
      await db('players').where({ id }).update({ is_active: false });
      await invalidatePlayerCache();
      return res.json({ ok: true, softDeleted: true });
    }
    const count = await db('players').where({ id }).del();
    if (!count) throw new HttpError(404, 'PLAYER_NOT_FOUND');
    await invalidatePlayerCache();
    res.json({ ok: true });
  })
);

/** JSON 批量导入,按昵称 upsert */
router.post(
  '/players/import',
  validateBody(z.object({ players: z.array(playerSchema).min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    let created = 0;
    let updated = 0;
    await db.transaction(async (trx) => {
      const nicknames = req.body.players.map((p: { nickname: string }) => p.nickname);
      const existing = await trx('players').whereIn('nickname', nicknames).select('nickname');
      const existingNames = new Set(existing.map((p: any) => p.nickname));
      updated = req.body.players.filter((p: { nickname: string }) => existingNames.has(p.nickname)).length;
      created = req.body.players.length - updated;
      const chunkSize = 200;
      for (let index = 0; index < req.body.players.length; index += chunkSize) {
        await trx('players')
          .insert(req.body.players.slice(index, index + chunkSize))
          .onConflict('nickname')
          .merge();
      }
    });
    await invalidatePlayerCache();
    res.json({ created, updated });
  })
);

const announcementSchema = z.object({
  title: z.string().min(1).max(128),
  content: z.string().min(1).max(10000),
});

router.post(
  '/announcements',
  validateBody(announcementSchema),
  asyncHandler(async (req, res) => {
    const [id] = await db('announcements')
      .insert(req.body)
      .returning('id')
      .then((rows) => rows.map((r: any) => (typeof r === 'object' ? r.id : r)));
    await invalidateCached('announcements');
    res.json({ id });
  })
);

router.delete(
  '/announcements/:id',
  asyncHandler(async (req, res) => {
    const count = await db('announcements').where({ id: Number(req.params.id) }).del();
    if (!count) throw new HttpError(404, 'NOT_FOUND');
    await invalidateCached('announcements');
    res.json({ ok: true });
  })
);

export default router;

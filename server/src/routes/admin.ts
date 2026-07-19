import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { validateBody, asyncHandler, HttpError } from '../middleware/common';
import { invalidatePlayerCache } from '../services/playerCache';
import { invalidateCached } from '../services/queryCache';
import { rateLimit, requestIdentity } from '../middleware/rateLimit';

const router = Router();
router.use(requireAuth, requireAdmin);
const adminReadLimit = rateLimit({
  name: 'admin-read',
  limit: 60,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const adminWriteLimit = rateLimit({
  name: 'admin-write',
  limit: 30,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const adminImportLimit = rateLimit({
  name: 'admin-import',
  limit: 10,
  windowSeconds: 60,
  key: requestIdentity,
  failClosed: true,
});
const playerRoles = ['Rifler', 'AWPer', 'Coach'] as const;

const playerSchema = z.object({
  nickname: z.string().min(1).max(64),
  nationality: z.string().min(1).max(64),
  region: z.string().max(32).default(''),
  team: z.string().max(64).default(''),
  birth_year: z.number().int().min(1970).max(2015),
  role: z.enum(playerRoles).default('Rifler'),
  major_championships: z.number().int().min(0).default(0),
  major_appearances: z.number().int().min(0).default(0),
  is_easy: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

const playerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  search: z.string().trim().max(100).default(''),
});

router.get(
  '/players',
  adminReadLimit,
  asyncHandler(async (req, res) => {
    const parsed = playerListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_FAILED');
    const { pageSize, search } = parsed.data;
    const query = db('players');
    if (search) {
      query.where((builder) => {
        builder.whereILike('nickname', `%${search}%`)
          .orWhereILike('nationality', `%${search}%`)
          .orWhereILike('region', `%${search}%`)
          .orWhereILike('team', `%${search}%`);
      });
    }
    const countRow = await query.clone().count({ count: 'id' }).first();
    const total = Number(countRow?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(parsed.data.page, totalPages);
    const players = await query.clone()
      .orderBy('nickname')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({ players, total, page, pageSize, totalPages });
  })
);

router.post(
  '/players',
  adminWriteLimit,
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
  adminWriteLimit,
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
  adminWriteLimit,
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
  adminImportLimit,
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
  adminWriteLimit,
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
  adminWriteLimit,
  asyncHandler(async (req, res) => {
    const count = await db('announcements').where({ id: Number(req.params.id) }).del();
    if (!count) throw new HttpError(404, 'NOT_FOUND');
    await invalidateCached('announcements');
    res.json({ ok: true });
  })
);

export default router;

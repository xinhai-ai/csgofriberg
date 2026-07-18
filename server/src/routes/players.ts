import { Router } from 'express';
import { db } from '../db/knex';
import { asyncHandler } from '../middleware/common';
import { Player } from '../types';
import { ageOf } from '../services/gameService';

const router = Router();

/**
 * 查选手 / 自动补全。
 * - ?search=xxx 模糊搜索昵称/真名/队伍
 * - ?suggest=1 仅返回 id+nickname(猜测输入补全用,不泄露属性)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const suggest = req.query.suggest === '1';

    let query = db<Player>('players').orderBy('nickname');
    if (search) {
      query = query.where((b) => {
        b.whereILike('nickname', `%${search}%`)
          .orWhereILike('real_name', `%${search}%`)
          .orWhereILike('team', `%${search}%`);
      });
    }
    const players = await query.limit(suggest ? 10 : 100);

    if (suggest) {
      return res.json(players.map((p) => ({ id: p.id, nickname: p.nickname })));
    }
    res.json(
      players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        realName: p.real_name,
        nationality: p.nationality,
        region: p.region,
        team: p.team,
        age: ageOf(p),
        role: p.role,
        majorAppearances: p.major_appearances,
        isActive: Boolean(p.is_active),
      }))
    );
  })
);

export default router;

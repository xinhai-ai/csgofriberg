import { db } from './knex';
import { ensureSchema } from './schema';
import playersData from './seeds/players.json';

// 手动执行:补充种子数据中数据库尚不存在的选手(按昵称去重)
async function run() {
  await ensureSchema();
  const existing = new Set(
    (await db('players').select('nickname')).map((r: any) => r.nickname)
  );
  const rows = (playersData as any[])
    .filter((p) => !existing.has(p.nickname))
    .map((p) => ({
      nickname: p.nickname,
      real_name: p.real_name ?? '',
      nationality: p.nationality,
      region: p.region ?? '',
      team: p.team ?? '',
      birth_year: p.birth_year,
      role: p.role ?? 'Rifler',
      major_appearances: p.major_appearances ?? 0,
      is_active: p.is_active ?? true,
    }));
  if (rows.length) await db.batchInsert('players', rows, 50);
  console.log(`[seed] 新增 ${rows.length} 名选手`);
  await db.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

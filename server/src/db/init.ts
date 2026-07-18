import { db } from './knex';
import { ensureSchema } from './schema';
import playersData from './seeds/players.json';

export async function seedPlayersIfEmpty(): Promise<void> {
  const row = await db('players').count<{ c: number }[]>({ c: '*' });
  const count = Number(row[0].c);
  if (count > 0) return;
  const rows = (playersData as any[]).map((p) => ({
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
  await db.batchInsert('players', rows, 50);
  console.log(`[seed] 已导入 ${rows.length} 名选手`);
}

export async function initDb(): Promise<void> {
  await ensureSchema();
  await seedPlayersIfEmpty();
}

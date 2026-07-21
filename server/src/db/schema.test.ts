import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSchema } from './schema';

const instances: ReturnType<typeof knex>[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.destroy()));
});

describe('player schema migration', () => {
  it('replaces birth years with fixed ages without losing players', async () => {
    const instance = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    instances.push(instance);
    await instance.schema.createTable('players', (table) => {
      table.increments('id').primary();
      table.string('nickname', 64).notNullable().unique();
      table.string('real_name', 128).notNullable().defaultTo('');
      table.string('nationality', 64).notNullable();
      table.string('region', 32).notNullable().defaultTo('');
      table.string('team', 64).notNullable().defaultTo('');
      table.integer('birth_year').notNullable();
      table.string('role', 32).notNullable().defaultTo('Rifler');
      table.integer('major_appearances').notNullable().defaultTo(0);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
    await instance('players').insert({
      nickname: 'legacy',
      real_name: 'must be removed',
      nationality: '丹麦',
      region: '欧洲',
      team: 'NIP',
      birth_year: 1990,
      role: 'Rifler',
      major_appearances: 2,
    });

    await ensureSchema(instance);

    expect(await instance.schema.hasColumn('players', 'real_name')).toBe(false);
    expect(await instance.schema.hasColumn('players', 'major_championships')).toBe(true);
    expect(await instance.schema.hasColumn('players', 'is_easy')).toBe(true);
    expect(await instance.schema.hasColumn('players', 'is_enabled')).toBe(true);
    expect(await instance.schema.hasColumn('players', 'age')).toBe(true);
    expect(await instance.schema.hasColumn('players', 'birth_year')).toBe(false);
    expect(await instance.schema.hasTable('app_migrations')).toBe(true);
    expect(await instance.schema.hasColumn('match_records', 'winner_key')).toBe(true);
    expect(await instance.schema.hasColumn('match_records', 'finish_reason')).toBe(true);
    expect(await instance.schema.hasColumn('match_records', 'forfeited_key')).toBe(true);
    const player = await instance('players').where({ nickname: 'legacy' }).first();
    expect(player.age).toBe(new Date().getFullYear() - 1990);
    expect((await instance('players').columnInfo('age')).nullable).toBe(false);
    expect(player.major_championships).toBe(0);
    expect(player.is_easy).toBe(0);
    expect(player.is_enabled).toBe(1);
  });
});

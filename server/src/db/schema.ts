import { Knex } from 'knex';
import { db } from './knex';

export async function ensureSchema(instance: Knex = db): Promise<void> {
  if (!(await instance.schema.hasTable('users'))) {
    await instance.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username', 32).notNullable().unique();
      t.string('password_hash', 128).notNullable();
      t.string('role', 16).notNullable().defaultTo('user');
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }

  if (!(await instance.schema.hasTable('players'))) {
    await instance.schema.createTable('players', (t) => {
      t.increments('id').primary();
      t.string('nickname', 64).notNullable().unique();
      t.string('real_name', 128).notNullable().defaultTo('');
      t.string('nationality', 64).notNullable();
      t.string('region', 32).notNullable().defaultTo('');
      t.string('team', 64).notNullable().defaultTo('');
      t.integer('birth_year').notNullable();
      t.string('role', 32).notNullable().defaultTo('Rifler');
      t.integer('major_appearances').notNullable().defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }

  // 旧版 games 表 user_id 不可空且无 guest_key;检测到旧结构则重建(开发期数据可丢弃)
  if (
    (await instance.schema.hasTable('games')) &&
    !(await instance.schema.hasColumn('games', 'guest_key'))
  ) {
    await instance.schema.dropTable('games');
  }
  if (!(await instance.schema.hasTable('games'))) {
    await instance.schema.createTable('games', (t) => {
      t.increments('id').primary();
      t.integer('user_id').nullable().references('id').inTable('users');
      t.string('guest_key', 64).nullable().index();
      t.integer('target_player_id').notNullable().references('id').inTable('players');
      t.string('mode', 16).notNullable().defaultTo('easy');
      t.text('guesses').notNullable().defaultTo('[]');
      t.string('status', 16).notNullable().defaultTo('playing');
      t.integer('guess_count').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
      t.timestamp('finished_at').nullable();
    });
  }

  if (
    (await instance.schema.hasTable('match_records')) &&
    !(await instance.schema.hasColumn('match_records', 'bo_type'))
  ) {
    await instance.schema.dropTable('match_records');
  }
  if (!(await instance.schema.hasTable('match_records'))) {
    await instance.schema.createTable('match_records', (t) => {
      t.increments('id').primary();
      t.string('room_id', 16).notNullable();
      t.integer('bo_type').notNullable().defaultTo(3);
      t.integer('winner_id').nullable().references('id').inTable('users');
      t.text('players').notNullable().defaultTo('[]');
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }

  if (!(await instance.schema.hasTable('announcements'))) {
    await instance.schema.createTable('announcements', (t) => {
      t.increments('id').primary();
      t.string('title', 128).notNullable();
      t.text('content').notNullable();
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
}

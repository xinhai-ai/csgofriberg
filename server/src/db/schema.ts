import { Knex } from 'knex';
import { db } from './knex';

export async function ensureSchema(instance: Knex = db): Promise<void> {
  if (!(await instance.schema.hasTable('users'))) {
    await instance.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('username', 32).notNullable().unique();
      t.string('password_hash', 128).notNullable();
      t.string('role', 16).notNullable().defaultTo('user');
      t.integer('token_version').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  if (!(await instance.schema.hasColumn('users', 'token_version'))) {
    await instance.schema.alterTable('users', (t) => t.integer('token_version').notNullable().defaultTo(0));
  }

  if (!(await instance.schema.hasTable('app_migrations'))) {
    await instance.schema.createTable('app_migrations', (t) => {
      t.string('name', 128).primary();
      t.timestamp('applied_at').notNullable().defaultTo(instance.fn.now());
    });
  }

  if (!(await instance.schema.hasTable('players'))) {
    await instance.schema.createTable('players', (t) => {
      t.increments('id').primary();
      t.string('nickname', 64).notNullable().unique();
      t.string('nationality', 64).notNullable();
      t.string('region', 32).notNullable().defaultTo('');
      t.string('team', 64).notNullable().defaultTo('');
      t.integer('birth_year').notNullable();
      t.string('role', 32).notNullable().defaultTo('Rifler');
      t.integer('major_championships').notNullable().defaultTo(0);
      t.integer('major_appearances').notNullable().defaultTo(0);
      t.boolean('is_easy').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
  if (!(await instance.schema.hasColumn('players', 'major_championships'))) {
    await instance.schema.alterTable('players', (t) => {
      t.integer('major_championships').notNullable().defaultTo(0);
    });
  }
  if (!(await instance.schema.hasColumn('players', 'is_easy'))) {
    await instance.schema.alterTable('players', (t) => {
      t.boolean('is_easy').notNullable().defaultTo(false);
    });
  }
  if (await instance.schema.hasColumn('players', 'real_name')) {
    if (instance.client.config.client === 'pg') {
      await instance.raw('drop index if exists "players_real_name_trgm_idx"');
    }
    await instance.schema.alterTable('players', (t) => t.dropColumn('real_name'));
  }
  if (instance.client.config.client === 'pg') {
    await instance.raw('create extension if not exists pg_trgm');
    await instance.raw(
      'create index if not exists "players_nickname_trgm_idx" on "players" using gin ("nickname" gin_trgm_ops)'
    );
    await instance.raw(
      'create index if not exists "players_team_trgm_idx" on "players" using gin ("team" gin_trgm_ops)'
    );
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
      t.string('session_id', 64).nullable();
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
  if (!(await instance.schema.hasColumn('games', 'session_id'))) {
    await instance.schema.alterTable('games', (t) => t.string('session_id', 64).nullable());
  }
  await instance.raw(
    'create unique index if not exists "games_session_id_unique" on "games" ("session_id")'
  );
  // Active single-player games now live only in Redis and are not historical records.
  await instance('games').where({ status: 'playing' }).del();

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
      t.unique(['room_id']);
    });
  }

  if (!(await instance.schema.hasTable('match_players'))) {
    await instance.schema.createTable('match_players', (t) => {
      t.increments('id').primary();
      t.integer('match_id').notNullable().references('id').inTable('match_records').onDelete('CASCADE');
      t.integer('user_id').nullable().references('id').inTable('users');
      t.string('player_key', 80).notNullable();
      t.string('player_name', 32).notNullable();
      t.integer('score').notNullable().defaultTo(0);
      t.boolean('is_winner').notNullable().defaultTo(false);
      t.unique(['match_id', 'player_key']);
      t.index(['user_id', 'is_winner'], 'match_players_user_winner_idx');
    });
  }

  const matchPlayerCount = Number(
    (await instance('match_players').count<{ count: number }[]>({ count: '*' }))[0].count
  );
  if (matchPlayerCount === 0) {
    const legacyMatches = await instance('match_records').select('id', 'winner_id', 'players');
    for (const match of legacyMatches) {
      let players: { userId: number | null; name: string; score: number }[] = [];
      try {
        players = JSON.parse(match.players);
      } catch {
        continue;
      }
      if (players.length) {
        await instance('match_players').insert(
          players.map((player, index) => ({
            match_id: match.id,
            user_id: player.userId,
            player_key: player.userId != null ? `u:${player.userId}` : `legacy:${match.id}:${index}`,
            player_name: player.name,
            score: player.score,
            is_winner: player.userId != null && player.userId === match.winner_id,
          }))
        );
      }
    }
  }

  const gameIndexes = [
    ['games_user_status_mode_idx', ['user_id', 'status', 'mode']],
    ['games_guest_status_mode_idx', ['guest_key', 'status', 'mode']],
    ['games_user_finished_idx', ['user_id', 'finished_at']],
  ] as const;
  for (const [name, columns] of gameIndexes) {
    const quotedColumns = columns.map((column) => `\"${column}\"`).join(', ');
    await instance.raw(`create index if not exists \"${name}\" on \"games\" (${quotedColumns})`);
  }

  await instance.raw(
    'create unique index if not exists "match_records_room_id_unique" on "match_records" ("room_id")'
  );

  if (!(await instance.schema.hasTable('announcements'))) {
    await instance.schema.createTable('announcements', (t) => {
      t.increments('id').primary();
      t.string('title', 128).notNullable();
      t.text('content').notNullable();
      t.timestamp('created_at').notNullable().defaultTo(instance.fn.now());
    });
  }
}

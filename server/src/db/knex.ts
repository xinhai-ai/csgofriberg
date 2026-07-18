import knex, { Knex } from 'knex';
import path from 'path';
import fs from 'fs';
import { config } from '../config';

function buildConfig(): Knex.Config {
  if (config.dbClient === 'pg') {
    return {
      client: 'pg',
      connection: config.dbUrl,
      pool: { min: 2, max: 10 },
    };
  }
  const file = path.isAbsolute(config.dbUrl)
    ? config.dbUrl
    : path.resolve(__dirname, '../..', config.dbUrl);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
  };
}

export const db = knex(buildConfig());

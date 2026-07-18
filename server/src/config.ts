import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  dbClient: (process.env.DB_CLIENT || 'sqlite') as 'sqlite' | 'pg',
  dbUrl: process.env.DB_URL || './data/csgofriberg.sqlite3',
  adminUsernames: (process.env.ADMIN_USERNAMES || 'admin')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

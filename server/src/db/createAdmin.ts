import { db } from './knex';
import { initDb } from './init';
import { closeRedis, initRedis } from '../redis';
import { invalidateAuthUser } from '../middleware/auth';
import { closePasswordWorkers, hashPassword } from '../services/password';
import { userNameFromUsername } from '../services/identityDisplay';

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters)');
  }
  await initDb();
  await initRedis();
  const passwordHash = await hashPassword(password);
  const existing = await db('users').where({ username }).first();
  if (existing) {
    await db('users').where({ id: existing.id }).update({
      display_id: userNameFromUsername(username),
      password_hash: passwordHash,
      role: 'admin',
      token_version: Number(existing.token_version ?? 0) + 1,
    });
  } else {
    await db('users').insert({
      username,
      display_id: userNameFromUsername(username),
      password_hash: passwordHash,
      role: 'admin',
    });
  }
  const user = await db('users').where({ username }).first();
  if (user) await invalidateAuthUser(user.id);
  console.log(`[admin] ${username} is ready`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePasswordWorkers();
    await closeRedis();
    await db.destroy();
  });

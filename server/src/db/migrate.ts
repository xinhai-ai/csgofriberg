import { initDb } from './init';
import { db } from './knex';

initDb()
  .then(() => {
    console.log('[migrate] 数据库结构已就绪');
    return db.destroy();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

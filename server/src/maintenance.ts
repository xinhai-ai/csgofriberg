import { closeRedis, initRedis } from './redis';
import { beginMaintenanceWindow } from './services/roomStore';

const requestedSeconds = Number(process.argv[2] ?? 90);
const durationSeconds = Number.isFinite(requestedSeconds)
  ? Math.max(1, Math.min(600, Math.floor(requestedSeconds)))
  : 90;

initRedis()
  .then(async (ready) => {
    if (!ready) throw new Error('REDIS_UNAVAILABLE');
    const until = await beginMaintenanceWindow(durationSeconds * 1000);
    console.log(`[maintenance] disconnect forfeits paused until ${new Date(until).toISOString()}`);
  })
  .then(() => closeRedis())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeRedis();
    process.exit(1);
  });

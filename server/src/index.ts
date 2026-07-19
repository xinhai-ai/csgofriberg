import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { config, validateProductionConfig } from './config';
import { initDb } from './db/init';
import { db } from './db/knex';
import { errorHandler } from './middleware/common';
import authRoutes from './routes/auth';
import playerRoutes from './routes/players';
import gameRoutes from './routes/game';
import statsRoutes from './routes/stats';
import leaderboardRoutes from './routes/leaderboard';
import announcementRoutes from './routes/announcements';
import adminRoutes from './routes/admin';
import { setupSocket } from './socket';
import { closeRedis, duplicateRedisClient, initRedis, isRedisAvailable } from './redis';
import { initPlayerCache } from './services/playerCache';
import { rateLimit } from './middleware/rateLimit';
import { initMatchResultWorker } from './services/matchResultQueue';
import powRoutes from './routes/pow';
import { requirePow } from './middleware/pow';

async function main() {
  validateProductionConfig();
  console.log('[server] 正在检查数据库结构');
  await initDb();
  console.log('[server] 数据库结构已就绪');
  const redisReady = await initRedis();
  await initPlayerCache();
  const stopMatchWorker = redisReady ? await initMatchResultWorker() : async () => undefined;

  const app = express();
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        workerSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...config.corsOrigins],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !config.corsOrigins.includes(origin)) {
        return res.status(403).json({ code: 'INVALID_ORIGIN' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', rateLimit({ name: 'api', limit: 600, windowSeconds: 60 }));

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, redis: isRedisAvailable() ? 'up' : 'degraded' })
  );
  app.use('/api/pow', powRoutes);
  app.use('/api', requirePow);

  app.use('/api/auth', authRoutes);
  app.use('/api/players', playerRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/admin', adminRoutes);

  // 生产环境托管前端构建产物
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: config.corsOrigins, credentials: true } });
  if (redisReady) {
    const pubClient = duplicateRedisClient();
    const subClient = duplicateRedisClient();
    if (pubClient && subClient) {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
    }
  }
  const stopSocket = setupSocket(io);

  server.listen(config.port, () => {
    console.log(`[server] 弗一把服务已启动: http://localhost:${config.port}`);
    console.log(`[server] allowed origins: ${config.corsOrigins.join(', ')}`);
  });

  const shutdown = async () => {
    stopSocket();
    await stopMatchWorker();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeRedis();
    await db.destroy();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});

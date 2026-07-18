import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import { config } from './config';
import { initDb } from './db/init';
import { errorHandler } from './middleware/common';
import authRoutes from './routes/auth';
import playerRoutes from './routes/players';
import gameRoutes from './routes/game';
import statsRoutes from './routes/stats';
import leaderboardRoutes from './routes/leaderboard';
import announcementRoutes from './routes/announcements';
import adminRoutes from './routes/admin';
import { setupSocket } from './socket';

async function main() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/players', playerRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/admin', adminRoutes);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
  const io = new Server(server, { cors: { origin: '*' } });
  setupSocket(io);

  server.listen(config.port, () => {
    console.log(`[server] 弗一把服务已启动: http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});

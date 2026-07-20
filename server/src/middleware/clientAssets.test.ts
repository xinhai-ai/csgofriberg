import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';
import { rejectMissingClientAsset } from './clientAssets';

describe('client asset fallback', () => {
  it('returns 404 for missing Vite assets instead of the SPA HTML', async () => {
    const app = express();
    app.use(rejectMissingClientAsset);
    app.get('*', (_req, res) => res.type('html').send('<!doctype html>'));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const assetResponse = await fetch(`http://127.0.0.1:${port}/assets/missing.js`);
      expect(assetResponse.status).toBe(404);
      expect(assetResponse.headers.get('content-type')).toContain('text/plain');
      expect(await assetResponse.text()).toBe('Not Found');

      const routeResponse = await fetch(`http://127.0.0.1:${port}/room/example`);
      expect(routeResponse.status).toBe(200);
      expect(routeResponse.headers.get('content-type')).toContain('text/html');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });
});

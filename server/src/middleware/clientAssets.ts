import path from 'path';
import { NextFunction, Request, Response } from 'express';

export function setClientAssetCacheHeaders(res: Response, filePath: string): void {
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  if (path.basename(filePath) === 'index.html') {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

/** Keep missing files as 404; only extensionless application routes use the SPA fallback. */
export function rejectMissingClientAsset(req: Request, res: Response, next: NextFunction) {
  const filename = req.path.split('/').at(-1) ?? '';
  if (/^\/assets(?:\/|$)/.test(req.path) || /\.[A-Za-z0-9]{1,16}$/.test(filename)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  next();
}

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

/** Keep missing Vite chunks as 404 so Nginx can retry the other rolling instance. */
export function rejectMissingClientAsset(req: Request, res: Response, next: NextFunction) {
  if (/^\/assets(?:\/|$)/.test(req.path)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  next();
}

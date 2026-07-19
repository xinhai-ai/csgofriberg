import express, { NextFunction, Request, Response } from 'express';

const parsedRequests = new WeakSet<Request>();

export function rejectOversizedBody(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // A route-specific parser has already accepted this body. Do not apply the
    // smaller generic API limit after the request stream has been consumed.
    if (parsedRequests.has(req)) return next();
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return res.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        maxBytes,
        receivedBytes: declared,
      });
    }
    next();
  };
}

export function parseJsonOnce(limit: string) {
  const parser = express.json({ limit });
  return (req: Request, res: Response, next: NextFunction) => {
    if (parsedRequests.has(req)) return next();
    parsedRequests.add(req);
    parser(req, res, next);
  };
}

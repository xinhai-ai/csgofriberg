import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/common';
import { rateLimit } from '../middleware/rateLimit';
import {
  consumeAndVerifyChallenge,
  createChallenge,
  getRequestPow,
  PowVerificationError,
  signPowCookie,
} from '../services/pow';

const router = Router();

const verifySchema = z.object({
  id: z.string().uuid(),
  nonce: z.string().regex(/^\d{1,20}$/),
});

router.post(
  '/challenge',
  rateLimit({ name: 'pow:challenge', limit: 20, windowSeconds: 60, failClosed: true }),
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const current = getRequestPow(req);
    if (current && current.expiresAt > Date.now() + 30_000) {
      return res.json({ valid: true, expiresAt: current.expiresAt });
    }
    res.json(await createChallenge(req.headers['user-agent']));
  })
);

router.post(
  '/verify',
  rateLimit({ name: 'pow:verify', limit: 30, windowSeconds: 60, failClosed: true }),
  validateBody(verifySchema),
  asyncHandler(async (req, res) => {
    try {
      const difficulty = await consumeAndVerifyChallenge(
        req.body.id,
        req.body.nonce,
        req.headers['user-agent']
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, ...signPowCookie(res, req.headers['user-agent'], difficulty) });
    } catch (err) {
      if (err instanceof PowVerificationError) {
        return res.status(400).json({ code: err.code });
      }
      throw err;
    }
  })
);

export default router;

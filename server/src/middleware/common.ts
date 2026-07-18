import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * API 错误只携带机器可读的 code(以及 HTTP 状态码),
 * 具体文案由前端翻译。
 */
export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ code: 'VALIDATION_FAILED' });
    }
    req.body = result.data;
    next();
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.code });
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL_ERROR' });
}

/** 包装 async 路由,把 rejection 交给 errorHandler */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

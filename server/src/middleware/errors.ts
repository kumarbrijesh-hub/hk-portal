import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ValidationError } from '../services/rules.js';

/** Wraps an async handler so rejections reach the error middleware. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}

/**
 * Turns every failure into a predictable JSON envelope. Nothing fails silently
 * (spec section 22) and internal details are not leaked to the client.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message, fieldErrors: error.fieldErrors });
    return;
  }

  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.errors) {
      fieldErrors[issue.path.join('.') || 'body'] = issue.message;
    }
    res.status(400).json({ error: 'Validation failed', fieldErrors });
    return;
  }

  const status = (error as { status?: number })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const body: Record<string, unknown> = { error: (error as Error).message };
    const existingId = (error as { existingId?: string }).existingId;
    if (existingId) body.existingId = existingId;
    res.status(status).json(body);
    return;
  }

  console.error('[unhandled]', error);
  res.status(500).json({ error: 'Something went wrong. Please retry, and report this if it persists.' });
}

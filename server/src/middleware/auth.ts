import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { userRepo } from '../repos/userRepo.js';
import type { SessionUser } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** `uid` rather than the reserved `sub` claim, which JWT types as a string. */
interface TokenPayload {
  uid: number;
}

export function issueSession(res: Response, user: SessionUser): void {
  const token = jwt.sign({ uid: user.id } satisfies TokenPayload, env.jwtSecret, {
    expiresIn: `${env.sessionTtlHours}h`,
  });
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: env.sessionTtlHours * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(env.cookieName, { path: '/' });
}

function readUser(req: Request): SessionUser | null {
  const token = req.cookies?.[env.cookieName];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret) as unknown as TokenPayload;
    return userRepo.findById(payload.uid);
  } catch {
    return null;
  }
}

/** Populates req.user when a valid session cookie is present. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const user = readUser(req);
  if (user) req.user = user;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  next();
}

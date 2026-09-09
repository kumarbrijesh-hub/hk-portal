import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { auditRepo } from '../repos/auditRepo.js';
import { userRepo } from '../repos/userRepo.js';
import { clearSession, issueSession, requireAuth } from '../middleware/auth.js';

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

const loginSchema = z.object({
  email: z.string().min(3, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const user = userRepo.verify(parsed.data.email, parsed.data.password);
  if (!user) {
    // Deliberately generic so the response cannot be used to enumerate accounts.
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  issueSession(res, user);
  auditRepo.record({
    entityType: 'auth',
    entityId: String(user.id),
    action: 'login',
    actor: user.name,
  });
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

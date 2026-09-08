import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { loadConfig, missingSheetConfig } from './config.js';
import { migrate } from './db/index.js';
import { userRepo } from './repos/userRepo.js';
import { attachUser, requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { configRouter } from './routes/config.js';
import { disruptionRouter } from './routes/disruptions.js';
import { outletRouter } from './routes/outlets.js';
import { reportRouter } from './routes/reports.js';
import { syncRouter } from './routes/sync.js';
import { addClient, heartbeat, removeClient } from './services/events.js';
import { startScheduler, syncNow } from './services/syncService.js';

migrate();
const config = loadConfig();

/** Creates the first login on a fresh database when bootstrap env vars are set. */
function bootstrapAdmin(): void {
  if (userRepo.count() > 0) return;
  if (!env.bootstrapAdminEmail || !env.bootstrapAdminPassword) {
    console.warn(
      '[auth] No users exist yet. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, '
      + 'or run `npm run seed -- <email> <name> <password>` to create the first account.',
    );
    return;
  }
  userRepo.create({
    email: env.bootstrapAdminEmail,
    name: env.bootstrapAdminName,
    password: env.bootstrapAdminPassword,
    role: 'admin',
  });
  console.log(`[auth] Bootstrap admin created: ${env.bootstrapAdminEmail}`);
}

bootstrapAdmin();

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  helmet({
    // The report HTML ships its own <style> block, so inline styles must be allowed.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: config.brand.appName,
    timezone: config.brand.timezone,
    sheetConfigured: missingSheetConfig(config).length === 0,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/config', configRouter);
app.use('/api/outlets', outletRouter);
app.use('/api/disruptions', disruptionRouter);
app.use('/api/sync', syncRouter);
app.use('/api/reports', reportRouter);

/** SSE stream that drives the app's automatic refresh (spec section 20). */
app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  addClient(res);
  req.on('close', () => removeClient(res));
});

const heartbeatTimer = setInterval(heartbeat, 25_000);
heartbeatTimer.unref?.();

// Serve the built SPA when it exists; in dev the Vite server proxies to this API.
if (fs.existsSync(env.webDistPath)) {
  app.use(express.static(env.webDistPath, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(env.webDistPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      `${config.brand.appName} API is running. The web build was not found at ${env.webDistPath}.\n`
      + 'Run `npm run build` for production, or `npm run dev` and open the Vite dev server.',
    );
  });
}

app.use(errorHandler);

const server = app.listen(env.port, env.host, () => {
  console.log(`[${config.brand.appName}] listening on http://${env.host}:${env.port}`);
  const missing = missingSheetConfig(config);
  if (missing.length) {
    console.warn(`[sync] Google Sheet not configured yet - pending: ${missing.join(', ')}`);
  } else if (env.syncOnBoot) {
    void syncNow('boot');
  }
  startScheduler();
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[${signal}] shutting down`);
    server.close(() => process.exit(0));
  });
}

import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

const repoRoot = path.resolve(process.cwd().endsWith('server') ? path.join(process.cwd(), '..') : process.cwd());

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const dataDir = process.env.DATA_DIR ?? path.join(repoRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',

  /** Defaults to loopback. Container/PaaS deployments override with HOST=0.0.0.0. */
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 8080),

  repoRoot,
  dataDir,
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'disruption.sqlite'),
  configPath: process.env.APP_CONFIG_PATH ?? path.join(repoRoot, 'config', 'app.config.json'),
  webDistPath: process.env.WEB_DIST_PATH ?? path.join(repoRoot, 'web', 'dist'),

  // Auth. In production a real secret must be supplied; dev gets an ephemeral one.
  jwtSecret: process.env.JWT_SECRET
    ?? (process.env.NODE_ENV === 'production'
      ? required('JWT_SECRET')
      : 'dev-only-insecure-secret-change-me'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  cookieName: process.env.COOKIE_NAME ?? 'bd_session',

  /** Bootstrap admin, created on first boot when the users table is empty. */
  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL ?? '',
  bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME ?? 'Administrator',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '',

  // Google Sheets credentials - never sent to the frontend.
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '',

  /** Overrides for config/app.config.json, useful when the sheet id lives in secrets. */
  sheetIdOverride: process.env.GOOGLE_SHEET_ID ?? '',
  sheetTabOverride: process.env.GOOGLE_SHEET_TAB ?? '',
  syncIntervalMinutesOverride: process.env.SYNC_INTERVAL_MINUTES ?? '',
  syncOnBoot: (process.env.SYNC_ON_BOOT ?? 'true') !== 'false',
};

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load env vars in both setups:
// - running from repo root (./.env)
// - running via `cd bot-service && npm run dev` (dotenv would otherwise look for bot-service/.env)
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}
const rootEnvLocalPath = path.resolve(__dirname, '..', '..', '.env.local');
if (fs.existsSync(rootEnvLocalPath)) {
  // Local overrides (kept out of git), applied after `.env`.
  dotenv.config({ path: rootEnvLocalPath });
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {number} fallback
 */
function toInt(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const rawPort = toInt('PORT', process.env.PORT, 8080);

const telegramWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL || '';
let telegramWebhookPath = process.env.TELEGRAM_WEBHOOK_PATH || '/webhook';

if (telegramWebhookUrl) {
  const parsed = new URL(telegramWebhookUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('TELEGRAM_WEBHOOK_URL must be HTTPS');
  }
  telegramWebhookPath = parsed.pathname || '/webhook';
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: process.env.TELEGRAM_BOT_USERNAME || '',

  watchApiUrl: process.env.WATCH_API_URL || '',
  watchSourcesAllowlist: process.env.WATCH_SOURCES_ALLOWLIST || '',
  catalogServiceUrl: (process.env.CATALOG_SERVICE_URL || 'http://catalog:8080').replace(/\/+$/, ''),
  listServiceUrl: (process.env.LIST_SERVICE_URL || 'http://list:8080').replace(/\/+$/, ''),
  internalServiceToken: String(process.env.INTERNAL_SERVICE_TOKEN || '').trim(),
  botSearchMode: String(process.env.BOT_SEARCH_MODE || 'catalog').trim().toLowerCase() === 'local' ? 'local' : 'catalog',

  dbClient: process.env.DB_CLIENT || 'sqlite3',
  dbPath: path.resolve(process.env.DB_PATH || './data/anime.sqlite3'),
  databaseUrl: process.env.DATABASE_URL || '',

  port: rawPort,
  // Used for Telegram Mini App "Web App" button (must be HTTPS in Telegram).
  webAppUrl: process.env.WEB_APP_URL || `${process.env.FRONTEND_BASE_URL || 'http://localhost:3000'}/`,
  // Shared secret used by Next.js middleware to allow Mini App pages access.
  // Add it to the Mini App URL as `?mt=...` from bot code.
  miniAppAccessToken: process.env.MINIAPP_ACCESS_TOKEN || '',

  telegramWebhookUrl,
  telegramWebhookPath,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',

  startupMaxRetries: toInt('STARTUP_MAX_RETRIES', process.env.STARTUP_MAX_RETRIES, 20),
  startupRetryDelayMs: toInt('STARTUP_RETRY_DELAY_MS', process.env.STARTUP_RETRY_DELAY_MS, 2000),

  webAppAuthMaxAgeSec: toInt('WEBAPP_AUTH_MAX_AGE_SEC', process.env.WEBAPP_AUTH_MAX_AGE_SEC, 86400),

  // Extra diagnostic logging for Mini App issues; keep off in production.
  debugWebAppLogs: (process.env.DEBUG_WEBAPP_LOGS || '') === '1'
};

if (config.dbClient === 'pg' && !config.databaseUrl) {
  throw new Error('DATABASE_URL is required when DB_CLIENT=pg');
}

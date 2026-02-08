import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

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

const rawPort = toInt('API_PORT', process.env.API_PORT, 4000);

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

  dbClient: process.env.DB_CLIENT || 'sqlite3',
  dbPath: path.resolve(process.env.DB_PATH || './data/anime.sqlite3'),
  databaseUrl: process.env.DATABASE_URL || '',

  apiPort: rawPort,
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${rawPort}`,
  // Used for Telegram Mini App "Web App" button (must be HTTPS in Telegram).
  webAppUrl: process.env.WEB_APP_URL || `${process.env.FRONTEND_BASE_URL || 'http://localhost:3000'}/mini`,

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

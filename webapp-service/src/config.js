import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load env vars in both setups:
// - running from repo root (./.env)
// - running from service dir (dotenv default)
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

function toInt(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const config = {
  port: toInt('PORT', process.env.PORT, 8080),

  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
  webAppAuthMaxAgeSec: toInt('WEBAPP_AUTH_MAX_AGE_SEC', process.env.WEBAPP_AUTH_MAX_AGE_SEC, 86400),

  dbClient: process.env.DB_CLIENT || 'pg',
  dbPath: path.resolve(process.env.DB_PATH || './data/anime.sqlite3'),
  databaseUrl: process.env.DATABASE_URL || '',

  watchApiUrl: process.env.WATCH_API_URL || 'http://watch-api:8000',
  watchSourcesAllowlist: process.env.WATCH_SOURCES_ALLOWLIST || '',

  catalogServiceUrl: (process.env.CATALOG_SERVICE_URL || 'http://catalog:8080').replace(/\/+$/, ''),
  listServiceUrl: (process.env.LIST_SERVICE_URL || 'http://list:8080').replace(/\/+$/, ''),
  internalServiceToken: String(process.env.INTERNAL_SERVICE_TOKEN || '').trim(),

  // Extra diagnostic logging for Mini App issues; keep off in production.
  debugWebAppLogs: (process.env.DEBUG_WEBAPP_LOGS || '') === '1'
};

if (config.dbClient === 'pg' && !config.databaseUrl) {
  throw new Error('DATABASE_URL is required when DB_CLIENT=pg');
}

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
const rootEnvLocalPath = path.resolve(__dirname, '..', '..', '.env.local');
if (fs.existsSync(rootEnvLocalPath)) {
  // Local overrides (kept out of git), applied after `.env`.
  dotenv.config({ path: rootEnvLocalPath });
}

function normalizeBaseUrl(raw, fallback) {
  return String(raw || fallback || '').trim().replace(/\/+$/, '');
}

function toInt(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const apiGatewayUrl = normalizeBaseUrl(process.env.API_GATEWAY_URL, 'http://gateway:8080');

export const config = {
  port: toInt('PORT', process.env.PORT, 8080),

  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
  webAppAuthMaxAgeSec: toInt('WEBAPP_AUTH_MAX_AGE_SEC', process.env.WEBAPP_AUTH_MAX_AGE_SEC, 86400),

  dbClient: process.env.DB_CLIENT || 'pg',
  dbPath: path.resolve(process.env.DB_PATH || './data/anime.sqlite3'),
  databaseUrl: process.env.DATABASE_URL || '',

  apiGatewayUrl,
  watchApiUrl: `${apiGatewayUrl}/api/watch`,
  watchSourcesAllowlist: process.env.WATCH_SOURCES_ALLOWLIST || '',

  catalogServiceUrl: `${apiGatewayUrl}/api`,
  listServiceUrl: `${apiGatewayUrl}/api`,
  internalServiceToken: String(process.env.INTERNAL_SERVICE_TOKEN || '').trim(),

  // Extra diagnostic logging for Mini App issues; keep off in production.
  debugWebAppLogs: (process.env.DEBUG_WEBAPP_LOGS || '') === '1'
};

if (config.dbClient === 'pg' && !config.databaseUrl) {
  throw new Error('DATABASE_URL is required when DB_CLIENT=pg');
}

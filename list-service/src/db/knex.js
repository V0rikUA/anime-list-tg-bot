import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

export function buildDb() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return knex({
    client: 'pg',
    connection: databaseUrl,
    migrations: {
      directory: migrationsDir,
      extension: 'cjs',
      loadExtensions: ['.cjs']
    },
    pool: { min: 0, max: 10 }
  });
}

export async function runMigrations(db) {
  await db.migrate.latest();
}

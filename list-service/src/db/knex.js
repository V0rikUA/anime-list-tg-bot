import knex from 'knex';

export function buildDb() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return knex({
    client: 'pg',
    connection: databaseUrl,
    pool: { min: 0, max: 10 }
  });
}


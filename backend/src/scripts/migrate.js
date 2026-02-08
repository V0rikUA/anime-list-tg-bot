import { config } from '../config.js';
import { AnimeRepository } from '../db.js';

const repository = new AnimeRepository({
  client: config.dbClient,
  dbPath: config.dbPath,
  databaseUrl: config.databaseUrl
});

try {
  await repository.init();
  console.log('Migrations completed.');
} finally {
  await repository.destroy();
}

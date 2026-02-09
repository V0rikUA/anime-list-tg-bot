import { config } from '../config.js';
import { AnimeRepository } from '../db.js';

const repository = new AnimeRepository({
  client: config.dbClient,
  dbPath: config.dbPath,
  databaseUrl: config.databaseUrl
});

await repository.init();
await repository.destroy();

// eslint-disable-next-line no-console
console.log('migrations applied');


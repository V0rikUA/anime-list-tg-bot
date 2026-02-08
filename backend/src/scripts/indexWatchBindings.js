import { config } from '../config.js';
import { AnimeRepository } from '../db.js';
import { watchSearch } from '../services/watchApiClient.js';

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    force: args.has('--force'),
    limit: Number(process.env.INDEX_WATCH_LIMIT || 5)
  };
}

async function main() {
  const { force, limit } = parseArgs(process.argv);

  if (!config.watchApiUrl) {
    throw new Error('WATCH_API_URL is not set');
  }

  const repository = new AnimeRepository({
    client: config.dbClient,
    dbPath: config.dbPath,
    databaseUrl: config.databaseUrl
  });
  await repository.init();

  try {
    const uids = await repository.db('user_anime_lists')
      .distinct('anime_uid')
      .pluck('anime_uid');

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const uid of uids) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await repository.getWatchMap(uid);
      if (existing) {
        skipped += 1;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const anime = await repository.getCatalogItem(uid);
      if (!anime) {
        skipped += 1;
        continue;
      }

      const q = String(anime.titleEn || anime.title || '').trim();
      if (!q) {
        skipped += 1;
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const out = await watchSearch({ q, limit });
        const items = Array.isArray(out?.items) ? out.items : [];
        if (!items.length) {
          skipped += 1;
          continue;
        }

        if (items.length > 1 && !force) {
          // Ambiguous: require manual pick to avoid wrong bindings.
          skipped += 1;
          continue;
        }

        const picked = items[0];
        const watchSource = String(picked?.source || '').trim();
        const watchUrl = String(picked?.url || '').trim();
        if (!watchSource || !watchUrl) {
          skipped += 1;
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await repository.setWatchMap(uid, watchSource, watchUrl, String(picked?.title || '').trim() || null);
        created += 1;
      } catch {
        failed += 1;
      }
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, created, skipped, failed, total: uids.length, force }, null, 2));
  } finally {
    await repository.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


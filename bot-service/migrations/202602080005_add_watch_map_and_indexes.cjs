/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('anime')) {
    // Basic lookup indexes (portable across sqlite/pg).
    await knex.schema.alterTable('anime', (table) => {
      table.index(['external_id'], 'idx_anime_external_id');
      table.index(['title_en'], 'idx_anime_title_en');
      table.index(['title_ru'], 'idx_anime_title_ru');
      table.index(['title_uk'], 'idx_anime_title_uk');
    }).catch(() => null);
  }

  if (await knex.schema.hasTable('user_anime_lists')) {
    await knex.schema.alterTable('user_anime_lists', (table) => {
      table.index(['user_id'], 'idx_user_anime_lists_user_id');
      table.index(['anime_uid'], 'idx_user_anime_lists_anime_uid');
      table.index(['list_type'], 'idx_user_anime_lists_list_type');
    }).catch(() => null);
  }

  if (!(await knex.schema.hasTable('watch_title_map'))) {
    await knex.schema.createTable('watch_title_map', (table) => {
      table.string('anime_uid', 128).primary().references('uid').inTable('anime').onDelete('CASCADE');
      table.string('watch_source', 64).notNullable();
      table.string('watch_url', 2048).notNullable();
      table.string('watch_title', 512);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  } else {
    // ensure columns exist (safe re-run)
    const cols = [
      ['watch_source', (t) => t.string('watch_source', 64).notNullable().defaultTo('')],
      ['watch_url', (t) => t.string('watch_url', 2048).notNullable().defaultTo('')],
      ['watch_title', (t) => t.string('watch_title', 512)]
    ];
    for (const [name, add] of cols) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await knex.schema.hasColumn('watch_title_map', name);
      if (!exists) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.alterTable('watch_title_map', (table) => add(table));
      }
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('watch_title_map');

  // Best-effort index cleanup (names are stable above).
  if (await knex.schema.hasTable('user_anime_lists')) {
    await knex.schema.alterTable('user_anime_lists', (table) => {
      table.dropIndex(['user_id'], 'idx_user_anime_lists_user_id');
      table.dropIndex(['anime_uid'], 'idx_user_anime_lists_anime_uid');
      table.dropIndex(['list_type'], 'idx_user_anime_lists_list_type');
    }).catch(() => null);
  }

  if (await knex.schema.hasTable('anime')) {
    await knex.schema.alterTable('anime', (table) => {
      table.dropIndex(['external_id'], 'idx_anime_external_id');
      table.dropIndex(['title_en'], 'idx_anime_title_en');
      table.dropIndex(['title_ru'], 'idx_anime_title_ru');
      table.dropIndex(['title_uk'], 'idx_anime_title_uk');
    }).catch(() => null);
  }
};


/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasAnime = await knex.schema.hasTable('anime');
  if (!hasAnime) return;

  const cols = [
    ['title_en', (t) => t.string('title_en', 512)],
    ['title_ru', (t) => t.string('title_ru', 512)],
    ['title_uk', (t) => t.string('title_uk', 512)]
  ];

  for (const [name, add] of cols) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await knex.schema.hasColumn('anime', name);
    if (!exists) {
      // eslint-disable-next-line no-await-in-loop
      await knex.schema.alterTable('anime', (table) => add(table));
    }
  }

  // Backfill English title from existing `title` for older rows.
  const hasTitleEn = await knex.schema.hasColumn('anime', 'title_en');
  if (hasTitleEn) {
    await knex('anime')
      .whereNull('title_en')
      .update({ title_en: knex.raw('"title"') });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasAnime = await knex.schema.hasTable('anime');
  if (!hasAnime) return;

  const cols = ['title_uk', 'title_ru', 'title_en'];
  for (const name of cols) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await knex.schema.hasColumn('anime', name);
    if (exists) {
      // eslint-disable-next-line no-await-in-loop
      await knex.schema.alterTable('anime', (table) => {
        table.dropColumn(name);
      });
    }
  }
};


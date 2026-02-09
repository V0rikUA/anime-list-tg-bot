/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasAnime = await knex.schema.hasTable('anime');
  if (!hasAnime) return;

  const cols = [
    ['image_small', (t) => t.string('image_small', 2048)],
    ['image_large', (t) => t.string('image_large', 2048)],
    ['synopsis_en', (t) => t.text('synopsis_en')]
  ];

  for (const [name, add] of cols) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await knex.schema.hasColumn('anime', name);
    if (!exists) {
      // eslint-disable-next-line no-await-in-loop
      await knex.schema.alterTable('anime', (table) => add(table));
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasAnime = await knex.schema.hasTable('anime');
  if (!hasAnime) return;

  const cols = ['synopsis_en', 'image_large', 'image_small'];
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


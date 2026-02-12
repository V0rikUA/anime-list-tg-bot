/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasAnime = await knex.schema.hasTable('anime');
  if (!hasAnime) return;

  const cols = [
    ['synopsis_json', (t) => t.text('synopsis_json')],
    ['posters_json', (t) => t.text('posters_json')]
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

  const cols = ['posters_json', 'synopsis_json'];
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

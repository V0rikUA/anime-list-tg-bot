/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('anime');
  if (!hasTable) return;

  const hasSynopsisJson = await knex.schema.hasColumn('anime', 'synopsis_json');
  const hasPostersJson = await knex.schema.hasColumn('anime', 'posters_json');

  if (hasSynopsisJson || hasPostersJson) {
    await knex.schema.alterTable('anime', (table) => {
      if (hasSynopsisJson) table.dropColumn('synopsis_json');
      if (hasPostersJson) table.dropColumn('posters_json');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('anime');
  if (!hasTable) return;

  const hasSynopsisJson = await knex.schema.hasColumn('anime', 'synopsis_json');
  const hasPostersJson = await knex.schema.hasColumn('anime', 'posters_json');

  await knex.schema.alterTable('anime', (table) => {
    if (!hasSynopsisJson) table.text('synopsis_json');
    if (!hasPostersJson) table.text('posters_json');
  });
};

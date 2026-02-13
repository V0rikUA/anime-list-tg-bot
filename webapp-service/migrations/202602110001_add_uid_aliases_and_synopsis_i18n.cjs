/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasAnime = await knex.schema.hasTable('anime');
  if (hasAnime) {
    const cols = [
      ['synopsis_ru', (t) => t.text('synopsis_ru')],
      ['synopsis_uk', (t) => t.text('synopsis_uk')]
    ];

    for (const [name, add] of cols) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await knex.schema.hasColumn('anime', name);
      if (!exists) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.alterTable('anime', (table) => add(table));
      }
    }
  }

  if (!(await knex.schema.hasTable('anime_uid_aliases'))) {
    await knex.schema.createTable('anime_uid_aliases', (table) => {
      table.string('alias_uid', 128).primary();
      table.string('canonical_uid', 128).notNullable().references('uid').inTable('anime').onDelete('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.index(['canonical_uid'], 'idx_anime_uid_aliases_canonical_uid');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable('anime_uid_aliases')) {
    await knex.schema.dropTable('anime_uid_aliases');
  }

  if (await knex.schema.hasTable('anime')) {
    const cols = ['synopsis_uk', 'synopsis_ru'];
    for (const name of cols) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await knex.schema.hasColumn('anime', name);
      if (exists) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.alterTable('anime', (table) => table.dropColumn(name));
      }
    }
  }
};


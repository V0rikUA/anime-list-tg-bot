/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    return;
  }

  const hasLang = await knex.schema.hasColumn('users', 'lang');
  if (!hasLang) {
    await knex.schema.alterTable('users', (table) => {
      table.string('lang', 8);
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) {
    return;
  }

  const hasLang = await knex.schema.hasColumn('users', 'lang');
  if (hasLang) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('lang');
    });
  }
};


/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('anime_title_roots'))) {
    await knex.schema.createTable('anime_title_roots', (table) => {
      table.increments('id').primary();
      table.string('root_key', 255).notNullable().unique();
      table.string('title_main', 512).notNullable();
      table.string('title_main_normalized', 512).notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.index(['title_main_normalized'], 'idx_anime_title_roots_main_normalized');
    });
  }

  if (!(await knex.schema.hasTable('anime_title_branches'))) {
    await knex.schema.createTable('anime_title_branches', (table) => {
      table.increments('id').primary();
      table.integer('root_id').notNullable().references('id').inTable('anime_title_roots').onDelete('CASCADE');
      table.string('anime_uid', 128).notNullable().unique().references('uid').inTable('anime').onDelete('CASCADE');
      table.string('branch_title', 512).notNullable();
      table.string('branch_title_normalized', 512).notNullable();
      table.integer('branch_order').nullable();
      table.string('branch_type', 64).nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.index(['root_id', 'branch_order'], 'idx_anime_title_branches_root_order');
      table.index(['branch_title_normalized'], 'idx_anime_title_branches_normalized');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('anime_title_branches');
  await knex.schema.dropTableIfExists('anime_title_roots');
};

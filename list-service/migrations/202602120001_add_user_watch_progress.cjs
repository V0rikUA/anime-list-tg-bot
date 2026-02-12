/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('user_watch_progress')) {
    return;
  }

  await knex.schema.createTable('user_watch_progress', (table) => {
    table.increments('id').primary();
    table.integer('user_id').notNullable();
    table.string('anime_uid', 128).notNullable();
    table.string('last_episode', 128).notNullable();
    table.decimal('last_episode_number', 10, 2);
    table.string('last_source', 255);
    table.string('last_quality', 64);
    table.string('started_via', 32).notNullable();
    table.timestamp('first_started_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.unique(['user_id', 'anime_uid']);
    table.index(['user_id', 'updated_at'], 'idx_user_watch_progress_user_updated');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_watch_progress');
};

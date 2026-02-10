/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('telegram_id', 64).notNullable().unique();
      table.string('username', 255);
      table.string('first_name', 255);
      table.string('last_name', 255);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('anime'))) {
    await knex.schema.createTable('anime', (table) => {
      table.string('uid', 128).primary();
      table.string('source', 64);
      table.string('external_id', 128);
      table.string('title', 512).notNullable();
      table.integer('episodes');
      table.float('score');
      table.string('status', 128);
      table.string('url', 1024);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('user_anime_lists'))) {
    await knex.schema.createTable('user_anime_lists', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('anime_uid', 128).notNullable().references('uid').inTable('anime').onDelete('CASCADE');
      table.string('list_type', 32).notNullable();
      table.integer('watch_count').notNullable().defaultTo(0);
      table.timestamp('added_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['user_id', 'anime_uid', 'list_type']);
    });
  } else if (!(await knex.schema.hasColumn('user_anime_lists', 'watch_count'))) {
    await knex.schema.alterTable('user_anime_lists', (table) => {
      table.integer('watch_count').notNullable().defaultTo(0);
    });
  }

  if (!(await knex.schema.hasTable('user_recommendations'))) {
    await knex.schema.createTable('user_recommendations', (table) => {
      table.increments('id').primary();
      table.integer('recommender_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('anime_uid', 128).notNullable().references('uid').inTable('anime').onDelete('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['recommender_user_id', 'anime_uid']);
    });
  }

  if (!(await knex.schema.hasTable('friendships'))) {
    await knex.schema.createTable('friendships', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('friend_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['user_id', 'friend_user_id']);
    });
  }

  if (!(await knex.schema.hasTable('friend_invites'))) {
    await knex.schema.createTable('friend_invites', (table) => {
      table.increments('id').primary();
      table.integer('inviter_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').unique();
      table.string('token', 128).notNullable().unique();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('friend_invites');
  await knex.schema.dropTableIfExists('friendships');
  await knex.schema.dropTableIfExists('user_recommendations');
  await knex.schema.dropTableIfExists('user_anime_lists');
  await knex.schema.dropTableIfExists('anime');
  await knex.schema.dropTableIfExists('users');
};

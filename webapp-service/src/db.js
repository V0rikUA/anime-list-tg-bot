import fs from 'node:fs/promises';
import path from 'node:path';
import knex from 'knex';
import { deriveTitleIndexPayload } from './db/titleUtils.js';
import { applyUserMethods } from './db/userMethods.js';
import { applyCatalogMethods } from './db/catalogMethods.js';
import { applyListMethods } from './db/listMethods.js';
import { applyRecommendationMethods } from './db/recommendationMethods.js';
import { applyDashboardMethods } from './db/dashboardMethods.js';

export { normalizeTitleForIndex, extractRootTitle, deriveTitleIndexPayload } from './db/titleUtils.js';

export class AnimeRepository {
  constructor(options) {
    this.client = options.client || 'sqlite3';
    this.dbPath = options.dbPath || null;
    this.databaseUrl = options.databaseUrl || null;

    const knexConfig = {
      client: this.client,
      migrations: {
        directory: path.resolve('migrations'),
        extension: 'cjs',
        loadExtensions: ['.cjs']
      }
    };

    if (this.client === 'sqlite3') {
      knexConfig.connection = {
        filename: this.dbPath
      };
      knexConfig.useNullAsDefault = true;
      knexConfig.pool = {
        afterCreate(connection, done) {
          connection.run('PRAGMA foreign_keys = ON', done);
        }
      };
    } else if (this.client === 'pg') {
      knexConfig.connection = this.databaseUrl;
      knexConfig.pool = { min: 0, max: 10 };
    } else {
      throw new Error(`Unsupported DB client: ${this.client}`);
    }

    this.db = knex(knexConfig);
    this._hasAliasTable = null;
    this._hasTitleRootsTable = null;
    this._hasTitleBranchesTable = null;
  }

  async hasAliasTable() {
    if (this._hasAliasTable !== null) return this._hasAliasTable;
    try {
      this._hasAliasTable = await this.db.schema.hasTable('anime_uid_aliases');
    } catch {
      this._hasAliasTable = false;
    }
    return this._hasAliasTable;
  }

  async hasTitleRootsTable() {
    if (this._hasTitleRootsTable !== null) return this._hasTitleRootsTable;
    try {
      this._hasTitleRootsTable = await this.db.schema.hasTable('anime_title_roots');
    } catch {
      this._hasTitleRootsTable = false;
    }
    return this._hasTitleRootsTable;
  }

  async hasTitleBranchesTable() {
    if (this._hasTitleBranchesTable !== null) return this._hasTitleBranchesTable;
    try {
      this._hasTitleBranchesTable = await this.db.schema.hasTable('anime_title_branches');
    } catch {
      this._hasTitleBranchesTable = false;
    }
    return this._hasTitleBranchesTable;
  }

  async upsertTitleIndex(trx, anime) {
    const hasRoots = await this.hasTitleRootsTable();
    const hasBranches = await this.hasTitleBranchesTable();
    if (!hasRoots || !hasBranches) return;

    const payload = deriveTitleIndexPayload(anime);

    await trx('anime_title_roots').insert({
      root_key: payload.rootKey,
      title_main: payload.rootTitle,
      title_main_normalized: payload.rootTitleNormalized,
      updated_at: this.db.fn.now()
    }).onConflict('root_key').merge({
      title_main: this.db.raw('excluded.title_main'),
      title_main_normalized: this.db.raw('excluded.title_main_normalized'),
      updated_at: this.db.fn.now()
    });

    const root = await trx('anime_title_roots').where({ root_key: payload.rootKey }).first('id');
    if (!root?.id) return;

    await trx('anime_title_branches').insert({
      root_id: root.id,
      anime_uid: anime.uid,
      branch_title: payload.branchTitle,
      branch_title_normalized: payload.branchTitleNormalized,
      updated_at: this.db.fn.now()
    }).onConflict('anime_uid').merge({
      root_id: this.db.raw('excluded.root_id'),
      branch_title: this.db.raw('excluded.branch_title'),
      branch_title_normalized: this.db.raw('excluded.branch_title_normalized'),
      updated_at: this.db.fn.now()
    });
  }

  async resolveCanonicalUid(uidRaw) {
    const uid = String(uidRaw || '').trim();
    if (!uid) return '';
    if (!(await this.hasAliasTable())) return uid;
    try {
      const row = await this.db('anime_uid_aliases')
        .where({ alias_uid: uid })
        .select('canonical_uid')
        .first();
      return row?.canonical_uid ? String(row.canonical_uid) : uid;
    } catch {
      return uid;
    }
  }

  async upsertUidAliases(trx, canonicalUidRaw, aliasesRaw) {
    const canonicalUid = String(canonicalUidRaw || '').trim();
    if (!canonicalUid) return;
    if (!(await this.hasAliasTable())) return;

    const aliases = Array.isArray(aliasesRaw)
      ? aliasesRaw.map((uid) => String(uid || '').trim()).filter(Boolean)
      : [];
    if (!aliases.length) return;

    const rows = aliases
      .filter((aliasUid) => aliasUid !== canonicalUid)
      .map((aliasUid) => ({
        alias_uid: aliasUid,
        canonical_uid: canonicalUid,
        updated_at: this.db.fn.now()
      }));

    if (!rows.length) return;

    await trx('anime_uid_aliases').insert(rows).onConflict('alias_uid').merge({
      canonical_uid: this.db.raw('excluded.canonical_uid'),
      updated_at: this.db.fn.now()
    });
  }

  async init() {
    if (this.client === 'sqlite3') {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    }
    await this.runMigrations();
  }

  async destroy() {
    await this.db.destroy();
  }

  async runMigrations() {
    await this.db.migrate.latest();
  }

  async checkHealth() {
    try {
      await this.db.raw('select 1 as ok');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  async indexAnimeInteraction(uid, { title = null } = {}) {
    const canonicalUid = await this.resolveCanonicalUid(uid);
    if (!canonicalUid) return;

    const existing = await this.db('anime').where({ uid: canonicalUid }).first();
    if (existing) {
      await this.db.transaction(async (trx) => {
        await this.upsertTitleIndex(trx, existing);
      });
      return;
    }

    const titleStr = String(title || '').trim();
    if (titleStr && titleStr.toLowerCase() !== 'unknown title') {
      await this.db.transaction(async (trx) => {
        await this.upsertTitleIndex(trx, { uid: canonicalUid, title: titleStr, titleEn: titleStr });
      });
    }
  }
}

applyUserMethods(AnimeRepository.prototype);
applyCatalogMethods(AnimeRepository.prototype);
applyListMethods(AnimeRepository.prototype);
applyRecommendationMethods(AnimeRepository.prototype);
applyDashboardMethods(AnimeRepository.prototype);

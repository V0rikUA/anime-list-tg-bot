import { normalizeAnimePayload } from './repository/normalizers.js';
import { applyUserMethods } from './repository/userMethods.js';
import { applyCatalogMethods } from './repository/catalogMethods.js';
import { applyListMethods } from './repository/listMethods.js';
import { applyFriendMethods } from './repository/friendMethods.js';
import { applyRecommendationMethods } from './repository/recommendationMethods.js';
import { applyWatchMapMethods } from './repository/watchMapMethods.js';
import { applyProgressMethods } from './repository/progressMethods.js';
import { applyLegacyListMethods } from './repository/legacyListMethods.js';

export class ListRepository {
  constructor(db) {
    this.db = db;
    this._hasAliasTable = null;
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

  async _ensureUserByTelegramId(db, telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) throw new Error('userId is required');

    await db('users').insert({
      telegram_id: telegramId,
      updated_at: db.fn.now()
    }).onConflict('telegram_id').merge({ updated_at: db.fn.now() });

    return db('users').where({ telegram_id: telegramId }).first();
  }

  async _upsertAnimeRow(trx, anime) {
    const row = normalizeAnimePayload(anime);
    const uid = await this.resolveCanonicalUid(row.uid);
    row.uid = uid;

    await trx('anime').insert({
      ...row,
      updated_at: this.db.fn.now()
    }).onConflict('uid').merge({
      source: this.db.raw('excluded.source'),
      external_id: this.db.raw('excluded.external_id'),
      title: this.db.raw('excluded.title'),
      title_en: this.db.raw('excluded.title_en'),
      title_ru: this.db.raw('excluded.title_ru'),
      title_uk: this.db.raw('excluded.title_uk'),
      episodes: this.db.raw('excluded.episodes'),
      score: this.db.raw('excluded.score'),
      status: this.db.raw('excluded.status'),
      url: this.db.raw('excluded.url'),
      image_small: this.db.raw('excluded.image_small'),
      image_large: this.db.raw('excluded.image_large'),
      synopsis_en: this.db.raw('excluded.synopsis_en'),
      synopsis_ru: this.db.raw('excluded.synopsis_ru'),
      synopsis_uk: this.db.raw('excluded.synopsis_uk'),
      updated_at: this.db.fn.now()
    });

    const legacyUids = row.legacy_uids || [];
    if (legacyUids.length) {
      await this.upsertUidAliases(trx, uid, [uid, ...legacyUids]);
    }

    return uid;
  }

  async checkHealth() {
    try {
      await this.db.raw('select 1 as ok');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }
}

applyUserMethods(ListRepository.prototype);
applyCatalogMethods(ListRepository.prototype);
applyListMethods(ListRepository.prototype);
applyFriendMethods(ListRepository.prototype);
applyRecommendationMethods(ListRepository.prototype);
applyWatchMapMethods(ListRepository.prototype);
applyProgressMethods(ListRepository.prototype);
applyLegacyListMethods(ListRepository.prototype);

import { normalizeAnimePayload, mapAnimeRow, pickTitleByLang } from './normalizers.js';

export function applyCatalogMethods(proto) {
  proto.upsertCatalog = async function(items) {
    if (!Array.isArray(items) || !items.length) return;

    await this.db.transaction(async (trx) => {
      const rows = items.map((item) => {
        const row = normalizeAnimePayload(item);
        return {
          uid: row.uid,
          source: row.source,
          external_id: row.external_id,
          title: row.title,
          title_en: row.title_en,
          title_ru: row.title_ru,
          title_uk: row.title_uk,
          episodes: row.episodes,
          score: row.score,
          status: row.status,
          url: row.url,
          image_small: row.image_small,
          image_large: row.image_large,
          synopsis_en: row.synopsis_en,
          synopsis_ru: row.synopsis_ru,
          synopsis_uk: row.synopsis_uk,
          updated_at: this.db.fn.now()
        };
      });

      await trx('anime').insert(rows).onConflict('uid').merge({
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

      for (const item of items) {
        const normalized = normalizeAnimePayload(item);
        if (normalized.legacy_uids.length) {
          // eslint-disable-next-line no-await-in-loop
          await this.upsertUidAliases(
            trx,
            normalized.uid,
            [normalized.uid, ...normalized.legacy_uids]
          );
        }
      }
    });
  };

  proto.getCatalogItem = async function(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return null;
    const row = await this.db('anime').where({ uid }).first();
    return row ? mapAnimeRow(row) : null;
  };

  proto.getCatalogItemLocalized = async function(uidRaw, lang) {
    const item = await this.getCatalogItem(uidRaw);
    if (!item) return null;
    return { ...item, title: pickTitleByLang(item, lang) };
  };
}

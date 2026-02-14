import {
  buildSynopsisJson,
  buildPostersJson,
  normalizeAnime,
  parseUidForStub,
  pickTitleByLang,
  mapAnimeRow,
  ensureTitlesI18n
} from './normalizers.js';

export function applyCatalogMethods(proto) {
  proto.upsertCatalog = async function(items) {
    if (!items.length) {
      return;
    }

    const normalizedItems = await Promise.all(items.map((item) => ensureTitlesI18n(item)));

    await this.db.transaction(async (trx) => {
      const rows = normalizedItems.map((normalized) => {
        const synopsis = buildSynopsisJson(normalized);
        const posters = buildPostersJson(normalized);
        return {
          uid: normalized.uid,
          source: normalized.source,
          external_id: normalized.externalId,
          title: normalized.title,
          title_en: normalized.titleEn,
          title_ru: normalized.titleRu,
          title_uk: normalized.titleUk,
          episodes: normalized.episodes,
          score: normalized.score,
          status: normalized.status,
          url: normalized.url,
          image_small: normalized.imageSmall,
          image_large: normalized.imageLarge,
          synopsis_en: normalized.synopsisEn,
          synopsis_ru: normalized.synopsisRu,
          synopsis_uk: normalized.synopsisUk,
          synopsis_json: JSON.stringify(synopsis),
          posters_json: JSON.stringify(posters),
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
        synopsis_json: this.db.raw('excluded.synopsis_json'),
        posters_json: this.db.raw('excluded.posters_json'),
        updated_at: this.db.fn.now()
      });

      for (const normalized of normalizedItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.upsertUidAliases(
          trx,
          normalized.uid,
          [normalized.uid, ...(normalized.legacyUids || [])]
        );
        // eslint-disable-next-line no-await-in-loop
        await this.upsertTitleIndex(trx, normalized);
      }
    });
  };

  proto.getCatalogItem = async function(uid) {
    const canonicalUid = await this.resolveCanonicalUid(uid);
    const row = await this.db('anime').where({ uid: canonicalUid }).first();
    return row ? mapAnimeRow(row) : null;
  };

  proto.ensureAnimeStub = async function(uidRaw) {
    const canonicalUid = await this.resolveCanonicalUid(uidRaw);
    if (!canonicalUid) return null;

    const existing = await this.db('anime').where({ uid: canonicalUid }).first();
    if (existing) return mapAnimeRow(existing);

    const parsed = parseUidForStub(canonicalUid);
    const synopsis = buildSynopsisJson({});
    const posters = buildPostersJson({});
    await this.db.transaction(async (trx) => {
      await trx('anime').insert({
        uid: parsed.uid,
        source: parsed.source,
        external_id: parsed.externalId,
        title: 'Unknown title',
        synopsis_json: JSON.stringify(synopsis),
        posters_json: JSON.stringify(posters),
        updated_at: this.db.fn.now()
      }).onConflict('uid').ignore();
      await this.upsertTitleIndex(trx, { uid: parsed.uid, title: 'Unknown title', titleEn: 'Unknown title' });
    });

    const created = await this.db('anime').where({ uid: canonicalUid }).first();
    return created ? mapAnimeRow(created) : null;
  };

  proto.getCatalogItemLocalized = async function(uid, lang) {
    const item = await this.getCatalogItem(uid);
    if (!item) return null;
    return { ...item, title: pickTitleByLang(item, lang) };
  };

  proto.getCatalogItemsLocalized = async function(uidsRaw, lang) {
    const uids = Array.isArray(uidsRaw) ? uidsRaw.map((u) => String(u || '').trim()).filter(Boolean) : [];
    if (!uids.length) return [];
    const resolvedUids = Array.from(new Set(await Promise.all(uids.map((uid) => this.resolveCanonicalUid(uid)))))
      .filter(Boolean);
    if (!resolvedUids.length) return [];
    const rows = await this.db('anime').whereIn('uid', resolvedUids);
    const items = rows.map((row) => mapAnimeRow(row));
    return items.map((it) => ({ ...it, title: pickTitleByLang(it, lang) }));
  };

  proto.upsertAnimeInTransaction = async function(trx, anime) {
    const normalized = await ensureTitlesI18n(anime);
    const synopsis = buildSynopsisJson(normalized);
    const posters = buildPostersJson(normalized);
    await trx('anime').insert({
      uid: normalized.uid,
      source: normalized.source,
      external_id: normalized.externalId,
      title: normalized.title,
      title_en: normalized.titleEn,
      title_ru: normalized.titleRu,
      title_uk: normalized.titleUk,
      episodes: normalized.episodes,
      score: normalized.score,
      status: normalized.status,
      url: normalized.url,
      image_small: normalized.imageSmall,
      image_large: normalized.imageLarge,
      synopsis_en: normalized.synopsisEn,
      synopsis_ru: normalized.synopsisRu,
      synopsis_uk: normalized.synopsisUk,
      synopsis_json: JSON.stringify(synopsis),
      posters_json: JSON.stringify(posters),
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
      synopsis_json: this.db.raw('excluded.synopsis_json'),
      posters_json: this.db.raw('excluded.posters_json'),
      updated_at: this.db.fn.now()
    });
    await this.upsertUidAliases(trx, normalized.uid, [normalized.uid, ...(normalized.legacyUids || [])]);
    await this.upsertTitleIndex(trx, normalized);
  };

  proto.upsertAnime = async function(animeRaw) {
    const anime = await ensureTitlesI18n(animeRaw);
    const synopsis = buildSynopsisJson(anime);
    const posters = buildPostersJson(anime);
    await this.db.transaction(async (trx) => {
      await trx('anime').insert({
        uid: anime.uid,
        source: anime.source,
        external_id: anime.externalId,
        title: anime.title,
        title_en: anime.titleEn,
        title_ru: anime.titleRu,
        title_uk: anime.titleUk,
        episodes: anime.episodes,
        score: anime.score,
        status: anime.status,
        url: anime.url,
        image_small: anime.imageSmall,
        image_large: anime.imageLarge,
        synopsis_en: anime.synopsisEn,
        synopsis_ru: anime.synopsisRu,
        synopsis_uk: anime.synopsisUk,
        synopsis_json: JSON.stringify(synopsis),
        posters_json: JSON.stringify(posters),
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
        synopsis_json: this.db.raw('excluded.synopsis_json'),
        posters_json: this.db.raw('excluded.posters_json'),
        updated_at: this.db.fn.now()
      });
      await this.upsertUidAliases(trx, anime.uid, [anime.uid, ...(anime.legacyUids || [])]);
      await this.upsertTitleIndex(trx, anime);
    });
  };
}

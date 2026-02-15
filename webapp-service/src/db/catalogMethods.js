import {
  normalizeAnime,
  parseUidForStub,
  pickTitleByLang,
  mapAnimeRow,
  ensureTitlesI18n
} from './normalizers.js';

function buildAnimeInsertRow(normalized, dbFnNow) {
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
    updated_at: dbFnNow
  };
}

function buildAnimeMergePayload(db) {
  return {
    source: db.raw('excluded.source'),
    external_id: db.raw('excluded.external_id'),
    title: db.raw('excluded.title'),
    title_en: db.raw('excluded.title_en'),
    title_ru: db.raw('excluded.title_ru'),
    title_uk: db.raw('excluded.title_uk'),
    episodes: db.raw('excluded.episodes'),
    score: db.raw('excluded.score'),
    status: db.raw('excluded.status'),
    url: db.raw('excluded.url'),
    image_small: db.raw('excluded.image_small'),
    image_large: db.raw('excluded.image_large'),
    synopsis_en: db.raw('excluded.synopsis_en'),
    synopsis_ru: db.raw('excluded.synopsis_ru'),
    synopsis_uk: db.raw('excluded.synopsis_uk'),
    updated_at: db.fn.now()
  };
}

export function applyCatalogMethods(proto) {
  proto.upsertCatalog = async function(items) {
    if (!items.length) {
      return;
    }

    const normalizedItems = await Promise.all(items.map((item) => ensureTitlesI18n(item)));

    await this.db.transaction(async (trx) => {
      const rows = normalizedItems.map((normalized) => buildAnimeInsertRow(normalized, this.db.fn.now()));

      await trx('anime').insert(rows).onConflict('uid').merge(buildAnimeMergePayload(this.db));

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
    await this.db.transaction(async (trx) => {
      await trx('anime').insert({
        uid: parsed.uid,
        source: parsed.source,
        external_id: parsed.externalId,
        title: 'Unknown title',
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
    await trx('anime').insert(buildAnimeInsertRow(normalized, this.db.fn.now()))
      .onConflict('uid').merge(buildAnimeMergePayload(this.db));
    await this.upsertUidAliases(trx, normalized.uid, [normalized.uid, ...(normalized.legacyUids || [])]);
    await this.upsertTitleIndex(trx, normalized);
  };

  proto.upsertAnime = async function(animeRaw) {
    const anime = await ensureTitlesI18n(animeRaw);
    await this.db.transaction(async (trx) => {
      await trx('anime').insert(buildAnimeInsertRow(anime, this.db.fn.now()))
        .onConflict('uid').merge(buildAnimeMergePayload(this.db));
      await this.upsertUidAliases(trx, anime.uid, [anime.uid, ...(anime.legacyUids || [])]);
      await this.upsertTitleIndex(trx, anime);
    });
  };
}

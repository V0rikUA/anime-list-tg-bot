export function applyWatchMapMethods(proto) {
  proto.getWatchMap = async function(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return null;
    const row = await this.db('watch_title_map').where({ anime_uid: uid }).first();
    if (!row) return null;
    return {
      uid,
      watchSource: row.watch_source,
      watchUrl: row.watch_url,
      watchTitle: row.watch_title || null,
      updatedAt: row.updated_at || null
    };
  };

  proto.setWatchMap = async function(uidRaw, watchSourceRaw, watchUrlRaw, watchTitleRaw = null) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    const watchSource = String(watchSourceRaw || '').trim().toLowerCase();
    const watchUrl = String(watchUrlRaw || '').trim();
    const watchTitle = watchTitleRaw === null || watchTitleRaw === undefined ? null : String(watchTitleRaw).trim();

    if (!uid) throw new Error('uid is required');
    if (!watchSource) throw new Error('watchSource is required');
    if (!watchUrl) throw new Error('watchUrl is required');

    const anime = await this.getCatalogItem(uid);
    if (!anime) throw new Error('anime_not_found');

    await this.db('watch_title_map').insert({
      anime_uid: uid,
      watch_source: watchSource,
      watch_url: watchUrl,
      watch_title: watchTitle,
      updated_at: this.db.fn.now()
    }).onConflict('anime_uid').merge({
      watch_source: this.db.raw('excluded.watch_source'),
      watch_url: this.db.raw('excluded.watch_url'),
      watch_title: this.db.raw('excluded.watch_title'),
      updated_at: this.db.fn.now()
    });

    return { ok: true };
  };

  proto.clearWatchMap = async function(uidRaw) {
    const uid = await this.resolveCanonicalUid(uidRaw);
    if (!uid) return { ok: false };
    await this.db('watch_title_map').where({ anime_uid: uid }).del();
    return { ok: true };
  };
}

import telegrafPkg from 'telegraf';
import { t } from '../i18n.js';
import { getSession } from '../session.js';
import * as listClient from '../services/listClient.js';
import { watchEpisodes, watchSearch } from '../services/watchApiClient.js';
import { renderScreen } from '../ui/renderState.js';
import { NOTICE, WATCH_TITLES, WATCH_EPISODES } from '../ui/renderState.js';
import { navRow } from '../ui/keyboards.js';
import { pushAndGo } from './navigation.js';

const { Markup } = telegrafPkg;

export async function startWatchFlow(ctx, lang, uid) {
  const session = getSession(ctx.from.id);
  const anime = await listClient.getCatalogItemLocalized(String(uid || '').trim(), lang);
  if (!anime) {
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
    return;
  }

  await renderScreen(ctx, session, t(lang, 'watch_loading'), Markup.inlineKeyboard([navRow(lang)]));
  try {
    const q = String(anime.titleEn || anime.title || '').trim();
    const map = await listClient.getWatchMap(anime.uid);

    // If we have a stored binding, try to resolve it to a fresh animeRef and jump to episodes.
    if (map?.watchSource && map?.watchUrl) {
      // Search in watch sources by EN title for better matching.
      const mappedOut = await watchSearch({ q, source: map.watchSource, limit: 50, page: 1 });
      const mappedItems = Array.isArray(mappedOut?.items) ? mappedOut.items : [];
      const match = mappedItems.find((it) => String(it?.url || '').trim() === String(map.watchUrl).trim());
      if (match?.animeRef) {
        session.watch = {
          uid: anime.uid,
          q,
          titles: mappedItems.slice(0, 5),
          titlePage: 1,
          titlePages: Number(mappedOut?.pages) || 1,
          titleTotal: Number(mappedOut?.total) || mappedItems.length,
          animeRef: String(match.animeRef),
          episodes: [],
          sources: [],
          videos: [],
          episodeNum: ''
        };

        const epsOut = await watchEpisodes({ animeRef: String(match.animeRef) });
        session.watch.episodes = Array.isArray(epsOut?.episodes) ? epsOut.episodes : [];
        await pushAndGo(ctx, lang, { id: WATCH_EPISODES });
        return;
      }
    }

    // Search in watch sources by EN title for better matching.
    const out = await watchSearch({ q, limit: 5, page: 1 });
    const items = Array.isArray(out?.items) ? out.items : [];
    session.watch = {
      uid: anime.uid,
      q,
      titles: items,
      titlePage: Number(out?.page) || 1,
      titlePages: Number(out?.pages) || 1,
      titleTotal: Number(out?.total) || items.length,
      animeRef: '',
      episodes: [],
      sources: [],
      videos: [],
      episodeNum: ''
    };
    await pushAndGo(ctx, lang, { id: WATCH_TITLES });
  } catch (error) {
    await pushAndGo(ctx, lang, { id: NOTICE, text: error?.message || t(lang, 'watch_failed') });
  }
}

import telegrafPkg from 'telegraf';
import { t } from '../i18n.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { getSession } from '../session.js';
import { searchAnime as searchAnimeLocal } from '../services/animeSources.js';
import { catalogSearch } from '../services/catalogClient.js';
import * as listClient from '../services/listClient.js';
import { translateShort, translateText } from '../services/translate.js';
import { renderScreen } from '../ui/renderState.js';
import { SEARCH_PROMPT, SEARCH_RESULTS, NOTICE } from '../ui/renderState.js';
import { navRow } from '../ui/keyboards.js';
import { pushAndGo } from './navigation.js';

const { Markup } = telegrafPkg;
const logger = createLogger('bot-service');

export async function performSearch(ctx, lang, queryRaw) {
  const session = getSession(ctx.from.id);
  const query = String(queryRaw || '').trim();
  if (!query) {
    session.awaiting = 'search_query';
    return pushAndGo(ctx, lang, { id: SEARCH_PROMPT });
  }

  session.awaiting = null;
  await renderScreen(ctx, session, t(lang, 'searching', { query }), Markup.inlineKeyboard([navRow(lang)]));

  try {
    let results = [];
    if (config.botSearchMode === 'catalog') {
      try {
        results = await catalogSearch({
          q: query,
          limit: 5,
          lang,
          sources: ['jikan', 'shikimori']
        });
      } catch (error) {
        logger.warn({ err: error?.message || String(error) }, 'catalog search failed, falling back to local search');
      }
    }
    if (!Array.isArray(results) || results.length === 0) {
      results = await searchAnimeLocal(query, 5);
    }

    // Persist i18n titles and show localized titles in bot UI immediately.
    const localized = await Promise.all(results.map(async (r) => {
      // Prefer localized titles from sources (e.g. Shikimori `russian`) and
      // only fall back to translation when a localized field is missing.
      let titleEn = String(r?.titleEn || r?.title || '').trim();
      let titleRu = String(r?.titleRu || '').trim();
      let titleUk = String(r?.titleUk || '').trim();

      if (lang === 'ru' && !titleRu) {
        titleRu = await translateShort(titleEn, 'ru').catch(() => '');
      }
      if (lang === 'uk' && !titleUk) {
        if (titleRu) {
          titleUk = await translateText(titleRu, { from: 'ru', to: 'uk' }).catch(() => '');
        } else {
          titleUk = await translateText(titleEn, { from: 'en', to: 'uk' }).catch(() => '');
        }
      }

      const title =
        lang === 'ru'
          ? (titleRu || titleEn)
          : (lang === 'uk' ? (titleUk || titleEn) : titleEn);

      return {
        ...r,
        title,
        titleEn: titleEn || null,
        titleRu: titleRu || null,
        titleUk: titleUk || null
      };
    }));

    await listClient.upsertCatalog(localized);
    const compact = localized.slice(0, 10).map((r) => ({
      uid: r.uid,
      title: r.title,
      source: r.source,
      url: r.url,
      score: r.score,
      episodes: r.episodes,
      status: r.status
    }));
    session.search = { query, results: compact };
    return pushAndGo(ctx, lang, { id: SEARCH_RESULTS });
  } catch (error) {
    session.search = null;
    return pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'search_failed', { error: error.message }) });
  }
}

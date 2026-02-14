import telegrafPkg from 'telegraf';
import { t, guessLangFromTelegram } from '../i18n.js';
import { getSession } from '../session.js';
import { ackCbQuery, ensureUserAndLang, parseEpisodeNumber } from '../utils/helpers.js';
import * as listClient from '../services/listClient.js';
import { watchEpisodes, watchSearch, watchSourcesForEpisode, watchVideos } from '../services/watchApiClient.js';
import {
  renderScreen, renderState,
  HELP, LANG, SEARCH_PROMPT, SEARCH_RESULTS, ANIME_ACTIONS,
  LIST, INVITE, APP, NOTICE, WATCH_TITLES, WATCH_EPISODES, WATCH_SOURCES, WATCH_VIDEOS
} from '../ui/renderState.js';
import { LANG_LABELS } from '../ui/keyboards.js';
import { navRow } from '../ui/keyboards.js';
import { goHome, pushAndGo } from './navigation.js';
import { startWatchFlow } from './watch.js';

const { Markup } = telegrafPkg;

export function registerCallbacks(bot) {
  bot.action('nav:home', async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    await goHome(ctx, lang);
  });

  bot.action('nav:back', async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);

    const prev = session.stack.pop();
    if (!prev) {
      await goHome(ctx, lang);
      return;
    }

    session.current = prev;
    await renderState(ctx, lang, session.current);
  });

  bot.action(/^menu:(search|watched|planned|favorites|feed|continue|friends|invite|app|lang|help|cancel)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    const action = String(ctx.match?.[1] || '');

    if (action === 'cancel') {
      await goHome(ctx, lang);
      return;
    }

    if (action === 'help') {
      await pushAndGo(ctx, lang, { id: HELP });
      return;
    }

    if (action === 'lang') {
      await pushAndGo(ctx, lang, { id: LANG });
      return;
    }

    if (action === 'search') {
      session.awaiting = 'search_query';
      await pushAndGo(ctx, lang, { id: SEARCH_PROMPT });
      return;
    }

    if (action === 'watched') {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'watched' });
      return;
    }

    if (action === 'planned') {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'planned' });
      return;
    }

    if (action === 'favorites') {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'favorites' });
      return;
    }

    if (action === 'feed') {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'feed' });
      return;
    }

    if (action === 'continue') {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'continue' });
      return;
    }

    if (action === 'friends') {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'friends' });
      return;
    }

    if (action === 'invite') {
      await pushAndGo(ctx, lang, { id: INVITE });
      return;
    }

    if (action === 'app') {
      await pushAndGo(ctx, lang, { id: APP });
    }
  });

  bot.action(/^lang:(en|ru|uk)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const selected = String(ctx.match?.[1] || 'en');
    const out = await listClient.setUserLang(String(ctx.from.id), selected);
    const lang = out.ok ? out.lang : guessLangFromTelegram(ctx.from);
    await goHome(ctx, lang, t(lang, 'lang_updated', { lang: (LANG_LABELS[lang] || lang) }));
  });

  bot.action(/^pick:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    const idx = Number(ctx.match?.[1] || -1);
    const results = session.search?.results;

    if (!Array.isArray(results) || idx < 0 || idx >= results.length) {
      await pushAndGo(ctx, lang, { id: SEARCH_PROMPT });
      return;
    }

    const picked = results[idx];
    await pushAndGo(ctx, lang, { id: ANIME_ACTIONS, uid: picked.uid });
  });

  bot.action(/^continue:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    const idx = Number(ctx.match?.[1] || -1);
    const items = Array.isArray(session.continueItems) ? session.continueItems : [];
    if (idx < 0 || idx >= items.length) {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'continue' });
      return;
    }

    const item = items[idx];
    const uid = String(item?.uid || '').trim();
    if (!uid) {
      await pushAndGo(ctx, lang, { id: LIST, kind: 'continue' });
      return;
    }

    await startWatchFlow(ctx, lang, uid);

    const resumeEpisode = String(item?.lastEpisode || '').trim();
    if (!resumeEpisode) return;

    const animeRef = String(session.watch?.animeRef || '').trim();
    const episodes = Array.isArray(session.watch?.episodes) ? session.watch.episodes : [];
    const episodeMatch = episodes.find((ep) => String(ep?.num || '').trim() === resumeEpisode);
    if (!animeRef || !episodeMatch) return;

    try {
      const episodeNum = String(episodeMatch.num || '').trim();
      if (!episodeNum) return;
      const sourcesOut = await watchSourcesForEpisode({ animeRef, episodeNum });
      session.watch.episodeNum = episodeNum;
      session.watch.sources = Array.isArray(sourcesOut?.sources) ? sourcesOut.sources : [];
      await pushAndGo(ctx, lang, { id: WATCH_SOURCES });

      const resumeSource = String(item?.lastSource || '').trim().toLowerCase();
      if (!resumeSource || !Array.isArray(session.watch.sources) || !session.watch.sources.length) return;

      const sourceMatch = session.watch.sources.find((src) => {
        const title = String(src?.title || '').trim().toLowerCase();
        const sourceRef = String(src?.sourceRef || '').trim().toLowerCase();
        return title === resumeSource || sourceRef === resumeSource;
      });
      if (!sourceMatch) return;

      const sourceRef = String(sourceMatch?.sourceRef || '').trim();
      if (!sourceRef) return;
      const videosOut = await watchVideos({ sourceRef });
      session.watch.sourceRef = sourceRef;
      session.watch.videos = Array.isArray(videosOut?.videos) ? videosOut.videos : [];
      await pushAndGo(ctx, lang, { id: WATCH_VIDEOS });
    } catch {
      // fall back to whatever step we already showed
    }
  });

  // Backwards compatibility for old messages that still have pick:back callback.
  bot.action(/^pick:back$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    if (session.search?.results?.length) {
      await pushAndGo(ctx, lang, { id: SEARCH_RESULTS });
      return;
    }
    await goHome(ctx, lang);
  });

  bot.action(/^act:(watch|plan|favorite|recommend):(.+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    const kind = String(ctx.match?.[1] || '');
    const uid = String(ctx.match?.[2] || '').trim();

    const anime = await listClient.getCatalogItemLocalized(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    if (kind === 'watch') {
      await listClient.addToTrackedList(String(ctx.from.id), 'watched', anime);
      const stats = await listClient.getWatchStats(String(ctx.from.id), uid);
      await pushAndGo(ctx, lang, {
        id: NOTICE,
        text: t(lang, 'saved_watched', { title: anime.title, you: stats.userWatchCount, friends: stats.friendsWatchCount })
      });
      return;
    }

    if (kind === 'plan') {
      await listClient.addToTrackedList(String(ctx.from.id), 'planned', anime);
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_planned', { title: anime.title }) });
      return;
    }

    if (kind === 'favorite') {
      await listClient.addToTrackedList(String(ctx.from.id), 'favorite', anime);
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_favorite', { title: anime.title }) });
      return;
    }

    await listClient.addRecommendation(String(ctx.from.id), anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'recommended_saved', { title: anime.title }) });
  });

  bot.action(/^watch:start:(.+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    const uid = String(ctx.match?.[1] || '').trim();
    await startWatchFlow(ctx, lang, uid);
  });

  bot.action(/^watch:rebind$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);
    const uid = String(session.watch?.uid || '').trim();
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    try {
      await listClient.clearWatchMap(uid);
    } catch {
      // ignore
    }

    // Restart watch flow without a stored binding.
    await startWatchFlow(ctx, lang, uid);
  });

  bot.action(/^watch:title:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);

    const idx = Number(ctx.match?.[1] || -1);
    const titles = session.watch?.titles;
    if (!Array.isArray(titles) || idx < 0 || idx >= titles.length) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    const picked = titles[idx];
    const animeRef = String(picked?.animeRef || '').trim();
    if (!animeRef) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    // Persist the binding so next time we can jump straight to episodes.
    try {
      const uid = String(session.watch?.uid || '').trim();
      const watchSource = String(picked?.source || '').trim();
      const watchUrl = String(picked?.url || '').trim();
      if (uid && watchSource && watchUrl) {
        await listClient.setWatchMap(uid, watchSource, watchUrl, String(picked?.title || '').trim() || null);
      }
    } catch {
      // ignore
    }

    session.watch.animeRef = animeRef;
    await renderScreen(ctx, session, t(lang, 'watch_loading'), Markup.inlineKeyboard([navRow(lang)]));

    try {
      const out = await watchEpisodes({ animeRef });
      session.watch.episodes = Array.isArray(out?.episodes) ? out.episodes : [];
      await pushAndGo(ctx, lang, { id: WATCH_EPISODES });
    } catch (error) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: error?.message || t(lang, 'watch_failed') });
    }
  });

  bot.action(/^watch:titles:page:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);

    const page = Number(ctx.match?.[1] || 1);
    const q = String(session.watch?.q || '').trim();
    if (!q || !Number.isFinite(page) || page <= 0) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    await renderScreen(ctx, session, t(lang, 'watch_loading'), Markup.inlineKeyboard([navRow(lang)]));
    try {
      const out = await watchSearch({ q, limit: 5, page });
      const items = Array.isArray(out?.items) ? out.items : [];
      session.watch.titles = items;
      session.watch.titlePage = Number(out?.page) || page;
      session.watch.titlePages = Number(out?.pages) || 1;
      session.watch.titleTotal = Number(out?.total) || items.length;
      await pushAndGo(ctx, lang, { id: WATCH_TITLES });
    } catch (error) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: error?.message || t(lang, 'watch_failed') });
    }
  });

  bot.action('noop', async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
  });

  bot.action(/^watch:ep:(.+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);

    const animeRef = String(session.watch?.animeRef || '').trim();
    const episodeNum = String(ctx.match?.[1] || '').trim();
    if (!animeRef || !episodeNum) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    session.watch.episodeNum = episodeNum;
    await renderScreen(ctx, session, t(lang, 'watch_loading'), Markup.inlineKeyboard([navRow(lang)]));

    try {
      const out = await watchSourcesForEpisode({ animeRef, episodeNum });
      session.watch.sources = Array.isArray(out?.sources) ? out.sources : [];
      await pushAndGo(ctx, lang, { id: WATCH_SOURCES });
    } catch (error) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: error?.message || t(lang, 'watch_failed') });
    }
  });

  bot.action(/^watch:src:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx);

    const idx = Number(ctx.match?.[1] || -1);
    const sources = session.watch?.sources;
    if (!Array.isArray(sources) || idx < 0 || idx >= sources.length) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    const src = sources[idx];
    const sourceRef = String(src?.sourceRef || '').trim();
    if (!sourceRef) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    session.watch.sourceRef = sourceRef;
    try {
      const progressEpisode = String(session.watch?.episodeNum || '').trim();
      const progressUid = String(session.watch?.uid || '').trim();
      if (progressUid && progressEpisode) {
        await listClient.listProgressStart({
          telegramUserId: String(ctx.from.id),
          animeUid: progressUid,
          episode: {
            label: progressEpisode,
            number: parseEpisodeNumber(progressEpisode)
          },
          source: String(src?.title || sourceRef || '').trim() || null,
          quality: null,
          startedVia: 'bot_source'
        });
      }
    } catch {
      // non-blocking
    }
    await renderScreen(ctx, session, t(lang, 'watch_loading'), Markup.inlineKeyboard([navRow(lang)]));

    try {
      const out = await watchVideos({ sourceRef });
      session.watch.videos = Array.isArray(out?.videos) ? out.videos : [];
      await pushAndGo(ctx, lang, { id: WATCH_VIDEOS });
    } catch (error) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: error?.message || t(lang, 'watch_failed') });
    }
  });
}

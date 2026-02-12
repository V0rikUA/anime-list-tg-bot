import telegrafPkg from 'telegraf';
import Fastify from 'fastify';
import { config } from './config.js';
import { AnimeRepository } from './db.js';
import { createLogger } from './logger.js';
import { guessLangFromTelegram, helpText, t } from './i18n.js';
import { searchAnime as searchAnimeLocal } from './services/animeSources.js';
import { catalogSearch } from './services/catalogClient.js';
import { listProgressStart, listRecentProgress } from './services/listClient.js';
import { translateShort, translateText } from './services/translate.js';
import {
  formatFriends,
  formatRecommendationsFromFriends,
  formatSearchResults,
  formatTrackedList
} from './utils/formatters.js';
import { watchEpisodes, watchSearch, watchSourcesForEpisode, watchVideos } from './services/watchApiClient.js';

const { Markup, Telegraf } = telegrafPkg;

const logger = createLogger('bot-service');

const LANGS = ['en', 'ru', 'uk'];
const LANG_LABELS = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська'
};

const userState = new Map();

function getSession(userId) {
  const key = String(userId || '');
  let session = userState.get(key);
  if (!session || typeof session !== 'object') {
    session = {};
    userState.set(key, session);
  }

  if (!('screenMessageId' in session)) session.screenMessageId = null;
  if (!('current' in session)) session.current = null;
  if (!Array.isArray(session.stack)) session.stack = [];
  if (!('awaiting' in session)) session.awaiting = null;
  if (!('search' in session)) session.search = null;
  if (!Array.isArray(session.continueItems)) session.continueItems = [];

  return session;
}

function parseEpisodeNumber(labelRaw) {
  const label = String(labelRaw || '').trim();
  const direct = Number(label);
  if (Number.isFinite(direct)) return direct;
  const m = label.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

async function tryDeleteMessage(telegram, chatId, messageId) {
  if (!chatId || !messageId) return;
  try {
    await telegram.deleteMessage(chatId, messageId);
  } catch {
    // ignore
  }
}

async function tryDeleteUserMessage(ctx) {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (!chatId || !messageId) return;
  await tryDeleteMessage(ctx.telegram, chatId, messageId);
}

async function ackCbQuery(ctx, session) {
  try {
    await ctx.answerCbQuery();
  } catch {
    // ignore
  }

  // If the user pressed a button on an "old" message (not our current screen),
  // delete it to keep the chat clean and move towards the single-screen UX.
  const chatId = ctx.chat?.id;
  const pressedId = ctx.callbackQuery?.message?.message_id;
  const screenId = session?.screenMessageId;
  if (chatId && pressedId && screenId && pressedId !== screenId) {
    await tryDeleteMessage(ctx.telegram, chatId, pressedId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractArgs(text, command) {
  if (!text) {
    return '';
  }

  const pattern = new RegExp(`^/${command}(?:@\\w+)?\\s*`, 'i');
  return text.replace(pattern, '').trim();
}

function buildInviteLink(token) {
  if (!config.botUsername) {
    return null;
  }
  return `https://t.me/${config.botUsername}?start=${token}`;
}

function buildMiniAppUrl(telegramUserId) {
  const url = new URL(config.webAppUrl);
  // Mini App no longer trusts uid for auth; this is only a debug fallback.
  if (!url.searchParams.has('uid')) {
    url.searchParams.set('uid', String(telegramUserId));
  }
  if (config.miniAppAccessToken && !url.searchParams.has('mt')) {
    url.searchParams.set('mt', String(config.miniAppAccessToken));
  }
  return url.toString();
}

function isHttpsUrl(urlRaw) {
  try {
    const url = new URL(String(urlRaw || ''));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function uiLabels(lang) {
  if (lang === 'ru') {
    return {
      emptyWord: 'пусто',
      watchedTitle: 'Просмотрено',
      plannedTitle: 'План',
      favoritesTitle: 'Избранное',
      ownRecommendationsTitle: 'Твои рекомендации',
      friends: {
        title: 'Друзья',
        empty: 'Друзья: пусто'
      },
      recsFromFriends: {
        title: 'Рекомендации от друзей',
        empty: 'Рекомендации от друзей: пусто',
        by: 'от',
        count: 'кол-во',
        unknown: 'неизвестно'
      },
      search: {
        empty: 'Ничего не найдено. Попробуй другое название.'
      }
    };
  }

  if (lang === 'uk') {
    return {
      emptyWord: 'порожньо',
      watchedTitle: 'Переглянуте',
      plannedTitle: 'План',
      favoritesTitle: 'Обране',
      ownRecommendationsTitle: 'Твої рекомендації',
      friends: {
        title: 'Друзі',
        empty: 'Друзі: порожньо'
      },
      recsFromFriends: {
        title: 'Рекомендації від друзів',
        empty: 'Рекомендації від друзів: порожньо',
        by: 'від',
        count: 'к-сть',
        unknown: 'невідомо'
      },
      search: {
        empty: 'Нічого не знайдено. Спробуй іншу назву.'
      }
    };
  }

  return {
    emptyWord: 'empty',
    watchedTitle: 'Watched',
    plannedTitle: 'Planned',
    favoritesTitle: 'Favorites',
    ownRecommendationsTitle: 'Your recommendations',
    friends: {
      title: 'Friends',
      empty: 'Friends: empty'
    },
    recsFromFriends: {
      title: 'Recommendations from friends',
      empty: 'Recommendations from friends: empty',
      by: 'by',
      count: 'count',
      unknown: 'unknown'
    },
    search: {
      empty: 'Nothing found. Try another title.'
    }
  };
}

async function ensureUserAndLang(ctx, repository) {
  const user = await repository.ensureUser(ctx.from);
  return user?.lang || guessLangFromTelegram(ctx.from);
}

function mainMenuKeyboard(ctx, lang) {
  const webAppUrl = buildMiniAppUrl(ctx.from.id);
  const canUseWebAppButton = isHttpsUrl(webAppUrl);

  const rows = [
    [
      Markup.button.callback(t(lang, 'menu_search'), 'menu:search'),
      Markup.button.callback(t(lang, 'menu_watched'), 'menu:watched'),
      Markup.button.callback(t(lang, 'menu_planned'), 'menu:planned')
    ],
    [
      Markup.button.callback(t(lang, 'menu_favorites'), 'menu:favorites'),
      Markup.button.callback(t(lang, 'menu_feed'), 'menu:feed'),
      Markup.button.callback(t(lang, 'menu_continue'), 'menu:continue'),
    ],
    [
      Markup.button.callback(t(lang, 'menu_friends'), 'menu:friends')
    ],
    [
      Markup.button.callback(t(lang, 'menu_invite'), 'menu:invite'),
      canUseWebAppButton
        ? Markup.button.webApp(t(lang, 'menu_app'), webAppUrl)
        : Markup.button.callback(t(lang, 'menu_app'), 'menu:app')
    ],
    [
      Markup.button.callback(t(lang, 'menu_language'), 'menu:lang'),
      Markup.button.callback(t(lang, 'menu_help'), 'menu:help')
    ]
  ];

  return Markup.inlineKeyboard(rows);
}

function navRow(lang, { back = true, home = true } = {}) {
  const row = [];
  if (back) row.push(Markup.button.callback(t(lang, 'menu_back'), 'nav:back'));
  if (home) row.push(Markup.button.callback(t(lang, 'menu_main'), 'nav:home'));
  return row;
}

function watchRebindRow(lang) {
  return [Markup.button.callback(t(lang, 'watch_rebind'), 'watch:rebind')];
}

function cancelKeyboard(lang) {
  // "Cancel" in the single-screen UX means: go to the main menu.
  return Markup.inlineKeyboard([navRow(lang, { back: false, home: true })]);
}

function pickKeyboard(lang, count) {
  const buttons = [];
  for (let i = 0; i < count; i += 1) {
    buttons.push(Markup.button.callback(String(i + 1), `pick:${i}`));
  }

  const rows = [];
  rows.push(buttons.slice(0, 5));
  if (buttons.length > 5) rows.push(buttons.slice(5, 10));

  rows.push([
    Markup.button.callback(t(lang, 'menu_new_search'), 'menu:search')
  ]);

  rows.push(navRow(lang));
  return Markup.inlineKeyboard(rows);
}

function actionKeyboard(lang, uid) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'act_watch'), `act:watch:${uid}`),
      Markup.button.callback(t(lang, 'act_plan'), `act:plan:${uid}`)
    ],
    [
      Markup.button.callback(t(lang, 'act_favorite'), `act:favorite:${uid}`),
      Markup.button.callback(t(lang, 'act_recommend'), `act:recommend:${uid}`)
    ],
    [Markup.button.callback(t(lang, 'act_watch_links'), `watch:start:${uid}`)],
    navRow(lang)
  ]);
}

async function renderScreen(ctx, session, text, keyboard) {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    // Should never happen in normal Telegram updates, but keep handlers safe.
    return null;
  }

  const extra = {
    disable_web_page_preview: true,
    ...(keyboard || {})
  };

  const messageId = session?.screenMessageId;
  if (messageId) {
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, text, extra);
      return messageId;
    } catch (error) {
      // "message is not modified" isn't actionable.
      const msg = error?.message || String(error);
      if (msg.includes('message is not modified')) {
        return messageId;
      }
      // If editing fails (e.g. message too old), fall through and send a new one.
    }
  }

  const sent = await ctx.telegram.sendMessage(chatId, text, extra);
  const sentId = sent?.message_id;

  if (sentId) {
    const prevId = session?.screenMessageId;
    session.screenMessageId = sentId;
    if (prevId && prevId !== sentId) {
      await tryDeleteMessage(ctx.telegram, chatId, prevId);
    }
  }

  return sentId || null;
}

async function waitForRepositoryReady(repository) {
  for (let attempt = 1; attempt <= config.startupMaxRetries; attempt += 1) {
    try {
      await repository.init();
      const health = await repository.checkHealth();
      if (!health.ok) {
        throw new Error(health.error || 'unknown database health error');
      }

      logger.info('database is healthy', { attempt });
      return;
    } catch (error) {
      logger.warn('database is not ready yet', {
        attempt,
        maxRetries: config.startupMaxRetries,
        error: error.message
      });

      if (attempt === config.startupMaxRetries) {
        throw error;
      }

      await sleep(config.startupRetryDelayMs);
    }
  }
}

const repository = new AnimeRepository({
  client: config.dbClient,
  dbPath: config.dbPath,
  databaseUrl: config.databaseUrl
});

await waitForRepositoryReady(repository);

const bot = config.telegramToken ? new Telegraf(config.telegramToken) : null;

if (!bot) {
  logger.warn(t('en', 'bot_disabled'));
} else {
  const HOME = 'home';
  const HELP = 'help';
  const LANG = 'lang';
  const SEARCH_PROMPT = 'search_prompt';
  const SEARCH_RESULTS = 'search_results';
  const ANIME_ACTIONS = 'anime_actions';
  const LIST = 'list';
  const INVITE = 'invite';
  const APP = 'app';
  const NOTICE = 'notice';
  const WATCH_TITLES = 'watch_titles';
  const WATCH_EPISODES = 'watch_episodes';
  const WATCH_SOURCES = 'watch_sources';
  const WATCH_VIDEOS = 'watch_videos';

  async function renderState(ctx, lang, state) {
    const session = getSession(ctx.from.id);
    const labels = uiLabels(lang);

    if (!state || !state.id) {
      session.current = { id: HOME };
      return renderScreen(ctx, session, t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
    }

    if (state.id === HOME) {
      const note = String(state.note || '').trim();
      const text = note ? `${note}\n\n${t(lang, 'menu_title')}` : t(lang, 'menu_title');
      return renderScreen(ctx, session, text, mainMenuKeyboard(ctx, lang));
    }

    if (state.id === HELP) {
      return renderScreen(ctx, session, helpText(lang), Markup.inlineKeyboard([navRow(lang)]));
    }

    if (state.id === LANG) {
      const rows = [
        LANGS.map((code) => Markup.button.callback(LANG_LABELS[code] || code, `lang:${code}`)),
        navRow(lang)
      ];
      return renderScreen(ctx, session, t(lang, 'lang_prompt'), Markup.inlineKeyboard(rows));
    }

    if (state.id === SEARCH_PROMPT) {
      return renderScreen(ctx, session, t(lang, 'prompt_search'), Markup.inlineKeyboard([navRow(lang)]));
    }

    if (state.id === SEARCH_RESULTS) {
      const results = session.search?.results || [];
      const text = formatSearchResults(results, { empty: labels.search.empty });
      return renderScreen(
        ctx,
        session,
        `${t(lang, 'pick_result')}\n\n${text}`,
        pickKeyboard(lang, Math.min(Array.isArray(results) ? results.length : 0, 10))
      );
    }

    if (state.id === ANIME_ACTIONS) {
      const uid = String(state.uid || '').trim();
      const anime = uid ? await repository.getCatalogItemLocalized(uid, lang) : null;
      if (!anime) {
        session.current = { id: HOME };
        return renderScreen(ctx, session, t(lang, 'unknown_id'), mainMenuKeyboard(ctx, lang));
      }

      return renderScreen(
        ctx,
        session,
        `${anime.title}\nID: ${anime.uid}\n\n${t(lang, 'pick_action')}`,
        actionKeyboard(lang, anime.uid)
      );
    }

    if (state.id === LIST) {
      const kind = String(state.kind || '');

      if (kind === 'watched') {
        const items = await repository.getWatchedWithFriendStats(String(ctx.from.id));
        const text = formatTrackedList(labels.watchedTitle, items, { showWatchCounters: true, emptyWord: labels.emptyWord });
        return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
      }

      if (kind === 'planned') {
        const items = await repository.getTrackedList(String(ctx.from.id), 'planned');
        const text = formatTrackedList(labels.plannedTitle, items, { emptyWord: labels.emptyWord });
        return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
      }

      if (kind === 'favorites') {
        const items = await repository.getTrackedList(String(ctx.from.id), 'favorite');
        const text = formatTrackedList(labels.favoritesTitle, items, { emptyWord: labels.emptyWord });
        return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
      }

      if (kind === 'feed') {
        const items = await repository.getRecommendationsFromFriends(String(ctx.from.id));
        const text = formatRecommendationsFromFriends(items, labels.recsFromFriends);
        return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
      }

      if (kind === 'continue') {
        try {
          const out = await listRecentProgress({
            telegramUserId: String(ctx.from.id),
            limit: 5,
            lang
          });
          const items = Array.isArray(out?.items) ? out.items : [];
          session.continueItems = items;

          if (!items.length) {
            return renderScreen(ctx, session, t(lang, 'continue_empty'), Markup.inlineKeyboard([navRow(lang)]));
          }

          const lines = [t(lang, 'continue_title'), ''];
          const rows = [];
          items.forEach((item, idx) => {
            const title = String(item?.title || item?.uid || 'unknown');
            const episode = String(item?.lastEpisode || '?');
            const source = String(item?.lastSource || '').trim();
            lines.push(`${idx + 1}. ${title} · EP ${episode}${source ? ` · ${source}` : ''}`);
            rows.push([Markup.button.callback(String(idx + 1), `continue:${idx}`)]);
          });
          rows.push(navRow(lang));
          return renderScreen(ctx, session, lines.join('\n'), Markup.inlineKeyboard(rows));
        } catch {
          return renderScreen(ctx, session, t(lang, 'continue_failed'), Markup.inlineKeyboard([navRow(lang)]));
        }
      }

      if (kind === 'friends') {
        const friends = await repository.getFriends(String(ctx.from.id));
        const text = formatFriends(friends, labels.friends);
        return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
      }

      if (kind === 'recommendations') {
        const items = await repository.getOwnRecommendations(String(ctx.from.id));
        const text = formatTrackedList(labels.ownRecommendationsTitle, items, { emptyWord: labels.emptyWord });
        return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
      }

      session.current = { id: HOME };
      return renderScreen(ctx, session, t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
    }

    if (state.id === INVITE) {
      const token = await repository.createInviteToken(ctx.from);
      const link = buildInviteLink(token);
      const lines = [t(lang, 'invite_token', { token }), t(lang, 'invite_howto')];
      if (link) lines.push(t(lang, 'invite_link', { link }));
      return renderScreen(ctx, session, lines.join('\n'), Markup.inlineKeyboard([navRow(lang)]));
    }

    if (state.id === APP) {
      const url = buildMiniAppUrl(ctx.from.id);
      const rows = [];
      let text = t(lang, 'open_miniapp');

      if (isHttpsUrl(url)) {
        rows.push([Markup.button.webApp(t(lang, 'btn_open_miniapp'), url)]);
      } else {
        text = `${t(lang, 'webapp_https_required')}\n\n${t(lang, 'webapp_open_link', { url })}`;
      }

      rows.push(navRow(lang));
      return renderScreen(ctx, session, text, Markup.inlineKeyboard(rows));
    }

    if (state.id === NOTICE) {
      const text = String(state.text || '').trim() || t(lang, 'menu_title');
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

	    if (state.id === WATCH_TITLES) {
	      const titles = session.watch?.titles || [];
	      if (!Array.isArray(titles) || titles.length === 0) {
	        return renderScreen(ctx, session, t(lang, 'watch_failed'), Markup.inlineKeyboard([navRow(lang)]));
	      }

	      const buttons = titles.slice(0, 10).map((it, idx) => ([
	        Markup.button.callback(`${idx + 1}`, `watch:title:${idx}`)
	      ]));

	      const page = Number(session.watch?.titlePage) || 1;
	      const pages = Number(session.watch?.titlePages) || 1;
	      const pager = [];
	      if (pages > 1) {
	        const prev = page > 1 ? Markup.button.callback('<', `watch:titles:page:${page - 1}`) : Markup.button.callback('-', 'noop');
	        const next = page < pages ? Markup.button.callback('>', `watch:titles:page:${page + 1}`) : Markup.button.callback('-', 'noop');
	        pager.push(prev, Markup.button.callback(`${page}/${pages}`, 'noop'), next);
	      }

	      const lines = [
	        t(lang, 'watch_pick_title'),
	        '',
	        ...titles.slice(0, 10).map((it, idx) => `${idx + 1}. ${it.title || it.source || 'unknown'}`)
	      ];

	      const rows = [...buttons];
	      if (pager.length) rows.push(pager);
	      rows.push(watchRebindRow(lang), navRow(lang));
	      return renderScreen(ctx, session, lines.join('\n'), Markup.inlineKeyboard(rows));
	    }

    if (state.id === WATCH_EPISODES) {
      const episodes = session.watch?.episodes || [];
      if (!Array.isArray(episodes) || episodes.length === 0) {
        return renderScreen(ctx, session, t(lang, 'watch_failed'), Markup.inlineKeyboard([navRow(lang)]));
      }

      const slice = episodes.slice(0, 30);
      const rows = slice.map((ep) => ([
        Markup.button.callback(String(ep.num), `watch:ep:${String(ep.num)}`)
      ]));

      const lines = [
        t(lang, 'watch_pick_episode'),
        '',
        ...slice.map((ep) => ep.title ? `${ep.num}. ${ep.title}` : String(ep.num))
      ];

      return renderScreen(ctx, session, lines.join('\n'), Markup.inlineKeyboard([...rows, watchRebindRow(lang), navRow(lang)]));
    }

    if (state.id === WATCH_SOURCES) {
      const sources = session.watch?.sources || [];
      if (!Array.isArray(sources) || sources.length === 0) {
        return renderScreen(ctx, session, t(lang, 'watch_failed'), Markup.inlineKeyboard([navRow(lang)]));
      }

      const slice = sources.slice(0, 10);
      const rows = slice.map((s, idx) => ([
        Markup.button.callback(String(s.title || `#${idx + 1}`), `watch:src:${idx}`)
      ]));

      return renderScreen(ctx, session, t(lang, 'watch_pick_source'), Markup.inlineKeyboard([...rows, watchRebindRow(lang), navRow(lang)]));
    }

    if (state.id === WATCH_VIDEOS) {
      const videos = session.watch?.videos || [];
      if (!Array.isArray(videos) || videos.length === 0) {
        return renderScreen(ctx, session, t(lang, 'watch_failed'), Markup.inlineKeyboard([navRow(lang)]));
      }

      const rows = videos.slice(0, 10).map((v, idx) => {
        const quality = v.quality ? `${v.quality}p` : 'link';
        const label = `${idx + 1}. ${quality}${v.type ? ` ${v.type}` : ''}`;
        // url button opens the link directly (best effort).
        return [Markup.button.url(label, String(v.url))];
      });

      return renderScreen(ctx, session, t(lang, 'watch_pick_quality'), Markup.inlineKeyboard([...rows, watchRebindRow(lang), navRow(lang)]));
    }

    session.current = { id: HOME };
    return renderScreen(ctx, session, t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
  }

  async function goHome(ctx, lang, note = '') {
    const session = getSession(ctx.from.id);
    session.awaiting = null;
    session.search = null;
    session.stack = [];
    session.current = { id: HOME, note };
    return renderState(ctx, lang, session.current);
  }

  async function pushAndGo(ctx, lang, nextState) {
    const session = getSession(ctx.from.id);
    if (session.current) {
      session.stack.push(session.current);
    }
    session.current = nextState;
    return renderState(ctx, lang, session.current);
  }

  async function performSearch(ctx, lang, queryRaw) {
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

      await repository.upsertCatalog(localized);
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

	  async function startWatchFlow(ctx, lang, uid) {
	    const session = getSession(ctx.from.id);
	    const anime = await repository.getCatalogItemLocalized(String(uid || '').trim(), lang);
	    if (!anime) {
	      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
	      return;
	    }

	    await renderScreen(ctx, session, t(lang, 'watch_loading'), Markup.inlineKeyboard([navRow(lang)]));
	    try {
	      const q = String(anime.titleEn || anime.title || '').trim();
	      const map = await repository.getWatchMap(anime.uid);

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

  bot.start(async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const session = getSession(ctx.from.id);

    // Reset navigation but keep the current screen message id (so we can edit it).
    session.awaiting = null;
    session.search = null;
    session.stack = [];
    session.current = { id: HOME, note: t(lang, 'start_intro') };

    const payload = ctx.startPayload || extractArgs(ctx.message?.text || '', 'start');
    if (payload) {
      const result = await repository.addFriendByToken(ctx.from, payload);
      const note = result.ok
        ? t(lang, 'friend_added', { label: result.inviter.label })
        : (result.reason === 'self_friend' ? t(lang, 'cannot_add_self') : t(lang, 'invalid_invite'));
      session.current.note = `${t(lang, 'start_intro')}\n\n${note}`;
    }

    await renderState(ctx, lang, session.current);
  });

  bot.help(async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: HELP });
  });

  bot.command('lang', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LANG });
  });

  bot.command('search', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const query = extractArgs(ctx.message?.text || '', 'search');
    await performSearch(ctx, lang, query);
  });

  bot.command('app', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: APP });
  });

  async function resolveAnimeFromUid(uidRaw, lang) {
    const uid = String(uidRaw || '').trim();
    if (!uid) return null;
    return repository.getCatalogItemLocalized(uid, lang);
  }

  bot.command('watched', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'watched' });
  });

  bot.command('planned', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'planned' });
  });

  bot.command('favorites', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'favorites' });
  });

  bot.command('feed', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'feed' });
  });

  bot.command('continue', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'continue' });
  });

  bot.command('friends', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'friends' });
  });

  bot.command('invite', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: INVITE });
  });

  bot.command('join', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const token = extractArgs(ctx.message?.text || '', 'join');
    if (!token) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_join') });
      return;
    }

    const result = await repository.addFriendByToken(ctx.from, token);
    const text = result.ok
      ? t(lang, 'friend_added', { label: result.inviter.label })
      : (result.reason === 'self_friend' ? t(lang, 'cannot_add_self') : t(lang, 'invalid_invite'));
    await pushAndGo(ctx, lang, { id: NOTICE, text });
  });

  bot.command('watch', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'watch');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await repository.addToTrackedList(ctx.from, 'watched', anime);
    const stats = await repository.getWatchStats(String(ctx.from.id), anime.uid);
    await pushAndGo(ctx, lang, {
      id: NOTICE,
      text: t(lang, 'saved_watched', { title: anime.title, you: stats.userWatchCount, friends: stats.friendsWatchCount })
    });
  });

  bot.command('unwatch', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'unwatch');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unwatch') });
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'watched', uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_watched', { uid }) : t(lang, 'not_in_watched') });
  });

  bot.command('plan', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'plan');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await repository.addToTrackedList(ctx.from, 'planned', anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_planned', { title: anime.title }) });
  });

  bot.command('unplan', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'unplan');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unplan') });
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'planned', uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_planned', { uid }) : t(lang, 'not_in_planned') });
  });

  bot.command('favorite', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'favorite');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await repository.addToTrackedList(ctx.from, 'favorite', anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_favorite', { title: anime.title }) });
  });

  bot.command('unfavorite', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'unfavorite');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unfavorite') });
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'favorite', uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_favorite', { uid }) : t(lang, 'not_in_favorites') });
  });

  bot.command('recommend', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'recommend');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await repository.addRecommendation(ctx.from, anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'recommended_saved', { title: anime.title }) });
  });

  bot.command('recommendations', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'recommendations' });
  });

  bot.command('unrecommend', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'unrecommend');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unrecommend') });
      return;
    }

    const removed = await repository.removeRecommendation(String(ctx.from.id), uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_recommendation', { uid }) : t(lang, 'not_in_recommendations') });
  });

  bot.command('stats', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message?.text || '', 'stats');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_stats') });
      return;
    }

    const anime = await resolveAnimeFromUid(uid, lang);
    const stats = await repository.getWatchStats(String(ctx.from.id), uid);
    const label = anime?.title || uid;

    await pushAndGo(ctx, lang, {
      id: NOTICE,
      text: t(lang, 'stats_line', { label, you: stats.userWatchCount, friends: stats.friendsWatchCount })
    });
  });

  bot.command('dashboard', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx, repository);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'dashboard_api', { url: `${config.apiBaseUrl}/api/dashboard/${ctx.from.id}` }) });
  });

  bot.action('nav:home', async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);
    await goHome(ctx, lang);
  });

  bot.action('nav:back', async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);

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
    const lang = await ensureUserAndLang(ctx, repository);
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
    const out = await repository.setUserLang(String(ctx.from.id), selected);
    const lang = out.ok ? out.lang : guessLangFromTelegram(ctx.from);
    await goHome(ctx, lang, t(lang, 'lang_updated', { lang: (LANG_LABELS[lang] || lang) }));
  });

  bot.action(/^pick:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);
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
    const lang = await ensureUserAndLang(ctx, repository);
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
    const lang = await ensureUserAndLang(ctx, repository);
    if (session.search?.results?.length) {
      await pushAndGo(ctx, lang, { id: SEARCH_RESULTS });
      return;
    }
    await goHome(ctx, lang);
  });

  bot.action(/^act:(watch|plan|favorite|recommend):(.+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);
    const kind = String(ctx.match?.[1] || '');
    const uid = String(ctx.match?.[2] || '').trim();

    const anime = await repository.getCatalogItemLocalized(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    if (kind === 'watch') {
      await repository.addToTrackedList(ctx.from, 'watched', anime);
      const stats = await repository.getWatchStats(String(ctx.from.id), uid);
      await pushAndGo(ctx, lang, {
        id: NOTICE,
        text: t(lang, 'saved_watched', { title: anime.title, you: stats.userWatchCount, friends: stats.friendsWatchCount })
      });
      return;
    }

    if (kind === 'plan') {
      await repository.addToTrackedList(ctx.from, 'planned', anime);
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_planned', { title: anime.title }) });
      return;
    }

    if (kind === 'favorite') {
      await repository.addToTrackedList(ctx.from, 'favorite', anime);
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_favorite', { title: anime.title }) });
      return;
    }

    await repository.addRecommendation(ctx.from, anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'recommended_saved', { title: anime.title }) });
  });

  bot.action(/^watch:start:(.+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = String(ctx.match?.[1] || '').trim();
    await startWatchFlow(ctx, lang, uid);
  });

  bot.action(/^watch:rebind$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = String(session.watch?.uid || '').trim();
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'watch_failed') });
      return;
    }

    try {
      await repository.clearWatchMap(uid);
    } catch {
      // ignore
    }

    // Restart watch flow without a stored binding.
    await startWatchFlow(ctx, lang, uid);
  });

  bot.action(/^watch:title:(\d+)$/, async (ctx) => {
    const session = getSession(ctx.from.id);
    await ackCbQuery(ctx, session);
    const lang = await ensureUserAndLang(ctx, repository);

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
        await repository.setWatchMap(uid, watchSource, watchUrl, String(picked?.title || '').trim() || null);
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
    const lang = await ensureUserAndLang(ctx, repository);

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
    const lang = await ensureUserAndLang(ctx, repository);

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
    const lang = await ensureUserAndLang(ctx, repository);

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
        await listProgressStart({
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

  bot.on('text', async (ctx) => {
    if (ctx.message?.text?.startsWith('/')) return;

    const lang = await ensureUserAndLang(ctx, repository);
    const session = getSession(ctx.from.id);
    const text = String(ctx.message?.text || '');

    // Keep the chat clean: remove the user's query message best-effort.
    await tryDeleteUserMessage(ctx);

    if (session.awaiting === 'search_query') {
      await performSearch(ctx, lang, text);
      return;
    }

    // Treat any free-form text as a search query.
    await performSearch(ctx, lang, text);
  });

  bot.on('message', async (ctx) => {
    if (typeof ctx.message?.text === 'string') {
      // Text is handled by bot.on('text') and bot.command handlers.
      return;
    }

    // Fallback for non-text updates: keep a consistent single-screen menu.
    const lang = await ensureUserAndLang(ctx, repository);
    await goHome(ctx, lang);
  });

  bot.catch(async (error, ctx) => {
    logger.error('bot error', error);
    const lang = ctx?.from ? await ensureUserAndLang(ctx, repository) : 'en';
    try {
      await ctx.reply(t(lang, 'unexpected_error'));
    } catch (replyError) {
      logger.warn('failed to send error message to telegram', {
        error: replyError?.message || String(replyError)
      });
    }
  });
}

const httpServer = Fastify({ logger: { level: 'info' } });

httpServer.get('/healthz', async () => {
  const dbHealth = await repository.checkHealth();
  if (!dbHealth.ok) return { ok: false, database: dbHealth };
  return { ok: true, database: dbHealth, uptimeSec: Math.floor(process.uptime()) };
});

// Telegram webhook endpoint. Must respond 200 quickly.
httpServer.post(config.telegramWebhookPath || '/webhook', async (request, reply) => {
  const expectedSecret = config.telegramWebhookSecret || '';
  if (expectedSecret) {
    const headerSecret = request.headers['x-telegram-bot-api-secret-token'];
    if (headerSecret !== expectedSecret) {
      httpServer.log.warn({ hasHeader: Boolean(headerSecret) }, 'telegram webhook secret mismatch');
      return reply.code(401).send({ ok: false });
    }
  }

  const update = request.body;
  reply.code(200).send({ ok: true });

  if (!bot) {
    httpServer.log.warn('telegram webhook received but bot is disabled');
    return;
  }

  if (!update || typeof update !== 'object') {
    httpServer.log.warn({ bodyType: typeof update }, 'telegram webhook body is not an object');
    return;
  }

  setImmediate(async () => {
    try {
      await bot.handleUpdate(update);
    } catch (error) {
      httpServer.log.error({ err: error }, 'failed to handle telegram update');
    }
  });
});

await httpServer.listen({ port: config.port, host: '0.0.0.0' });

logger.info('bot http server started', {
  port: config.port,
  webhookMode: Boolean(config.telegramWebhookUrl),
  webhookPath: config.telegramWebhookPath
});

if (bot) {
  if (config.telegramWebhookUrl) {
    // In webhook mode we don't need to call Telegram API on startup.
    // Network policies/DNS issues can block api.telegram.org and should not crash the bot-service.
    try {
      const me = await bot.telegram.getMe();
      bot.botInfo = me;
    } catch (error) {
      logger.warn('telegram getMe failed; continuing without botInfo', {
        error: error?.message || String(error)
      });
    }

    logger.info('bot ready in webhook mode (no polling)', {
      webhookUrl: config.telegramWebhookUrl,
      webhookPath: config.telegramWebhookPath,
      secretEnabled: Boolean(config.telegramWebhookSecret)
    });
  } else {
    try {
      await bot.launch();
      logger.info('telegram bot started (long polling)');
    } catch (error) {
      logger.error('failed to launch telegram bot; bot-service will keep running', error);
    }
  }
}

async function shutdown(signal) {
  logger.info('stopping services', { signal });
  try {
    if (bot) {
      bot.stop(signal);
    }
    await httpServer.close();
    await repository.destroy();
    process.exit(0);
  } catch (error) {
    logger.error('shutdown failed', error);
    process.exit(1);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

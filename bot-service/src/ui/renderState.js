import telegrafPkg from 'telegraf';
import { t, helpText } from '../i18n.js';
import { tryDeleteMessage } from '../utils/helpers.js';
import { buildInviteLink, buildMiniAppUrl, isHttpsUrl } from '../utils/urls.js';
import {
  formatFriends,
  formatRecommendationsFromFriends,
  formatSearchResults,
  formatTrackedList
} from '../utils/formatters.js';
import * as listClient from '../services/listClient.js';
import { getSession } from '../session.js';
import { uiLabels } from './labels.js';
import {
  LANGS,
  LANG_LABELS,
  mainMenuKeyboard,
  navRow,
  watchRebindRow,
  pickKeyboard,
  actionKeyboard
} from './keyboards.js';

const { Markup } = telegrafPkg;

export const HOME = 'home';
export const HELP = 'help';
export const LANG = 'lang';
export const SEARCH_PROMPT = 'search_prompt';
export const SEARCH_RESULTS = 'search_results';
export const ANIME_ACTIONS = 'anime_actions';
export const LIST = 'list';
export const INVITE = 'invite';
export const APP = 'app';
export const NOTICE = 'notice';
export const WATCH_TITLES = 'watch_titles';
export const WATCH_EPISODES = 'watch_episodes';
export const WATCH_SOURCES = 'watch_sources';
export const WATCH_VIDEOS = 'watch_videos';

export async function renderScreen(ctx, session, text, keyboard) {
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

export async function renderState(ctx, lang, state) {
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
    const anime = uid ? await listClient.getCatalogItemLocalized(uid, lang) : null;
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
      const items = await listClient.getWatchedWithFriendStats(String(ctx.from.id));
      const text = formatTrackedList(labels.watchedTitle, items, { showWatchCounters: true, emptyWord: labels.emptyWord });
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

    if (kind === 'planned') {
      const items = await listClient.getTrackedList(String(ctx.from.id), 'planned');
      const text = formatTrackedList(labels.plannedTitle, items, { emptyWord: labels.emptyWord });
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

    if (kind === 'favorites') {
      const items = await listClient.getTrackedList(String(ctx.from.id), 'favorite');
      const text = formatTrackedList(labels.favoritesTitle, items, { emptyWord: labels.emptyWord });
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

    if (kind === 'feed') {
      const items = await listClient.getRecommendationsFromFriends(String(ctx.from.id));
      const text = formatRecommendationsFromFriends(items, labels.recsFromFriends);
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

    if (kind === 'continue') {
      try {
        const out = await listClient.listRecentProgress({
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
      const friends = await listClient.getFriends(String(ctx.from.id));
      const text = formatFriends(friends, labels.friends);
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

    if (kind === 'recommendations') {
      const items = await listClient.getOwnRecommendations(String(ctx.from.id));
      const text = formatTrackedList(labels.ownRecommendationsTitle, items, { emptyWord: labels.emptyWord });
      return renderScreen(ctx, session, text, Markup.inlineKeyboard([navRow(lang)]));
    }

    session.current = { id: HOME };
    return renderScreen(ctx, session, t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
  }

  if (state.id === INVITE) {
    const token = await listClient.createInviteToken(ctx.from);
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

import { t } from '../i18n.js';
import { config } from '../config.js';
import { getSession } from '../session.js';
import { tryDeleteUserMessage, extractArgs, ensureUserAndLang } from '../utils/helpers.js';
import * as listClient from '../services/listClient.js';
import { HOME, HELP, LANG, INVITE, APP, LIST, NOTICE } from '../ui/renderState.js';
import { renderState } from '../ui/renderState.js';
import { goHome, pushAndGo } from './navigation.js';
import { performSearch } from './search.js';
import { startWatchFlow } from './watch.js';

async function resolveAnimeFromUid(uidRaw, lang) {
  const uid = String(uidRaw || '').trim();
  if (!uid) return null;
  return listClient.getCatalogItemLocalized(uid, lang);
}

export function registerCommands(bot) {
  bot.start(async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const session = getSession(ctx.from.id);

    // Reset navigation but keep the current screen message id (so we can edit it).
    session.awaiting = null;
    session.search = null;
    session.stack = [];
    session.current = { id: HOME, note: t(lang, 'start_intro') };

    const payload = ctx.startPayload || extractArgs(ctx.message?.text || '', 'start');
    if (payload) {
      const result = await listClient.addFriendByToken(ctx.from, payload);
      const note = result.ok
        ? t(lang, 'friend_added', { label: result.inviter.label })
        : (result.reason === 'self_friend' ? t(lang, 'cannot_add_self') : t(lang, 'invalid_invite'));
      session.current.note = `${t(lang, 'start_intro')}\n\n${note}`;
    }

    await renderState(ctx, lang, session.current);
  });

  bot.help(async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: HELP });
  });

  bot.command('lang', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LANG });
  });

  bot.command('search', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const query = extractArgs(ctx.message?.text || '', 'search');
    await performSearch(ctx, lang, query);
  });

  bot.command('app', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: APP });
  });

  bot.command('watched', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'watched' });
  });

  bot.command('planned', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'planned' });
  });

  bot.command('favorites', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'favorites' });
  });

  bot.command('feed', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'feed' });
  });

  bot.command('continue', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'continue' });
  });

  bot.command('friends', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'friends' });
  });

  bot.command('invite', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: INVITE });
  });

  bot.command('join', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const token = extractArgs(ctx.message?.text || '', 'join');
    if (!token) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_join') });
      return;
    }

    const result = await listClient.addFriendByToken(ctx.from, token);
    const text = result.ok
      ? t(lang, 'friend_added', { label: result.inviter.label })
      : (result.reason === 'self_friend' ? t(lang, 'cannot_add_self') : t(lang, 'invalid_invite'));
    await pushAndGo(ctx, lang, { id: NOTICE, text });
  });

  bot.command('watch', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'watch');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await listClient.addToTrackedList(String(ctx.from.id), 'watched', anime);
    const stats = await listClient.getWatchStats(String(ctx.from.id), anime.uid);
    await pushAndGo(ctx, lang, {
      id: NOTICE,
      text: t(lang, 'saved_watched', { title: anime.title, you: stats.userWatchCount, friends: stats.friendsWatchCount })
    });
  });

  bot.command('unwatch', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'unwatch');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unwatch') });
      return;
    }

    const removed = await listClient.removeFromTrackedList(String(ctx.from.id), 'watched', uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_watched', { uid }) : t(lang, 'not_in_watched') });
  });

  bot.command('plan', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'plan');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await listClient.addToTrackedList(String(ctx.from.id), 'planned', anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_planned', { title: anime.title }) });
  });

  bot.command('unplan', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'unplan');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unplan') });
      return;
    }

    const removed = await listClient.removeFromTrackedList(String(ctx.from.id), 'planned', uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_planned', { uid }) : t(lang, 'not_in_planned') });
  });

  bot.command('favorite', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'favorite');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await listClient.addToTrackedList(String(ctx.from.id), 'favorite', anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'added_favorite', { title: anime.title }) });
  });

  bot.command('unfavorite', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'unfavorite');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unfavorite') });
      return;
    }

    const removed = await listClient.removeFromTrackedList(String(ctx.from.id), 'favorite', uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_favorite', { uid }) : t(lang, 'not_in_favorites') });
  });

  bot.command('recommend', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'recommend');
    const anime = await resolveAnimeFromUid(uid, lang);
    if (!anime) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'unknown_id') });
      return;
    }

    await listClient.addRecommendation(String(ctx.from.id), anime);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'recommended_saved', { title: anime.title }) });
  });

  bot.command('recommendations', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: LIST, kind: 'recommendations' });
  });

  bot.command('unrecommend', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'unrecommend');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_unrecommend') });
      return;
    }

    const removed = await listClient.removeRecommendation(String(ctx.from.id), uid);
    await pushAndGo(ctx, lang, { id: NOTICE, text: removed ? t(lang, 'removed_recommendation', { uid }) : t(lang, 'not_in_recommendations') });
  });

  bot.command('stats', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    const uid = extractArgs(ctx.message?.text || '', 'stats');
    if (!uid) {
      await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'usage_stats') });
      return;
    }

    const anime = await resolveAnimeFromUid(uid, lang);
    const stats = await listClient.getWatchStats(String(ctx.from.id), uid);
    const label = anime?.title || uid;

    await pushAndGo(ctx, lang, {
      id: NOTICE,
      text: t(lang, 'stats_line', { label, you: stats.userWatchCount, friends: stats.friendsWatchCount })
    });
  });

  bot.command('dashboard', async (ctx) => {
    await tryDeleteUserMessage(ctx);
    const lang = await ensureUserAndLang(ctx);
    await pushAndGo(ctx, lang, { id: NOTICE, text: t(lang, 'dashboard_api', { url: `${config.apiBaseUrl}/api/dashboard/${ctx.from.id}` }) });
  });
}

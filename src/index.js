import telegrafPkg from 'telegraf';
import { config } from './config.js';
import { AnimeRepository } from './db.js';
import { createLogger } from './logger.js';
import { startApiServer } from './server.js';
import { guessLangFromTelegram, helpText, t } from './i18n.js';
import { searchAnime } from './services/animeSources.js';
import {
  formatFriends,
  formatRecommendationsFromFriends,
  formatSearchResults,
  formatTrackedList
} from './utils/formatters.js';

const { Markup, Telegraf } = telegrafPkg;

const logger = createLogger('backend');

const LANGS = ['en', 'ru', 'uk'];
const LANG_LABELS = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська'
};

const userState = new Map();

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
  url.searchParams.set('uid', String(telegramUserId));
  return url.toString();
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

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'menu_search'), 'menu:search'),
      Markup.button.callback(t(lang, 'menu_watched'), 'menu:watched'),
      Markup.button.callback(t(lang, 'menu_planned'), 'menu:planned')
    ],
    [
      Markup.button.callback(t(lang, 'menu_favorites'), 'menu:favorites'),
      Markup.button.callback(t(lang, 'menu_feed'), 'menu:feed'),
      Markup.button.callback(t(lang, 'menu_friends'), 'menu:friends')
    ],
    [
      Markup.button.callback(t(lang, 'menu_invite'), 'menu:invite'),
      Markup.button.webApp(t(lang, 'menu_app'), webAppUrl)
    ],
    [
      Markup.button.callback(t(lang, 'menu_language'), 'menu:lang'),
      Markup.button.callback(t(lang, 'menu_help'), 'menu:help')
    ]
  ]);
}

function cancelKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t(lang, 'menu_cancel'), 'menu:cancel')]
  ]);
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
    Markup.button.callback(t(lang, 'menu_new_search'), 'menu:search'),
    Markup.button.callback(t(lang, 'menu_cancel'), 'menu:cancel')
  ]);

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
    [
      Markup.button.callback(t(lang, 'menu_back'), 'pick:back'),
      Markup.button.callback(t(lang, 'menu_cancel'), 'menu:cancel')
    ]
  ]);
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
  bot.start(async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);

    // First message: short description + language picker.
    await ctx.reply(
      `${t(lang, 'start_intro')}\n\n${t(lang, 'lang_prompt')}`,
      Markup.inlineKeyboard([
        LANGS.map((code) => Markup.button.callback(LANG_LABELS[code] || code, `lang:${code}`))
      ])
    );

    await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));

    const payload = ctx.startPayload || extractArgs(ctx.message?.text || '', 'start');
    if (payload) {
      const result = await repository.addFriendByToken(ctx.from, payload);
      if (result.ok) {
        await ctx.reply(t(lang, 'friend_added', { label: result.inviter.label }));
      } else if (result.reason === 'self_friend') {
        await ctx.reply(t(lang, 'cannot_add_self'));
      } else {
        await ctx.reply(t(lang, 'invalid_invite'));
      }
    }

    await ctx.reply(t(lang, 'start_ready'));
  });

  bot.help(async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    await ctx.reply(helpText(lang));
    await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
  });

  bot.command('lang', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    await ctx.reply(
      t(lang, 'lang_prompt'),
      Markup.inlineKeyboard([
        LANGS.map((code) => Markup.button.callback(LANG_LABELS[code] || code, `lang:${code}`))
      ])
    );
  });

  bot.action(/^menu:(search|watched|planned|favorites|feed|friends|invite|lang|help|cancel)$/, async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const action = String(ctx.match?.[1] || '');

    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore
    }

    if (action === 'cancel') {
      userState.delete(String(ctx.from.id));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'help') {
      await ctx.reply(helpText(lang));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'lang') {
      await ctx.reply(
        t(lang, 'lang_prompt'),
        Markup.inlineKeyboard([
          LANGS.map((code) => Markup.button.callback(LANG_LABELS[code] || code, `lang:${code}`))
        ])
      );
      return;
    }

    if (action === 'search') {
      userState.set(String(ctx.from.id), { awaiting: 'search_query', search: null });
      await ctx.reply(t(lang, 'prompt_search'), cancelKeyboard(lang));
      return;
    }

    const labels = uiLabels(lang);

    if (action === 'watched') {
      const items = await repository.getWatchedWithFriendStats(String(ctx.from.id));
      await ctx.reply(formatTrackedList(labels.watchedTitle, items, { showWatchCounters: true, emptyWord: labels.emptyWord }));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'planned') {
      const items = await repository.getTrackedList(String(ctx.from.id), 'planned');
      await ctx.reply(formatTrackedList(labels.plannedTitle, items, { emptyWord: labels.emptyWord }));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'favorites') {
      const items = await repository.getTrackedList(String(ctx.from.id), 'favorite');
      await ctx.reply(formatTrackedList(labels.favoritesTitle, items, { emptyWord: labels.emptyWord }));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'feed') {
      const items = await repository.getRecommendationsFromFriends(String(ctx.from.id));
      await ctx.reply(formatRecommendationsFromFriends(items, labels.recsFromFriends));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'friends') {
      const friends = await repository.getFriends(String(ctx.from.id));
      await ctx.reply(formatFriends(friends, labels.friends));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (action === 'invite') {
      const token = await repository.createInviteToken(ctx.from);
      const link = buildInviteLink(token);
      const lines = [t(lang, 'invite_token', { token }), t(lang, 'invite_howto')];
      if (link) lines.push(t(lang, 'invite_link', { link }));
      await ctx.reply(lines.join('\n'));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }
  });

  bot.action(/^lang:(en|ru|uk)$/, async (ctx) => {
    const selected = String(ctx.match?.[1] || 'en');
    const out = await repository.setUserLang(String(ctx.from.id), selected);
    const lang = out.ok ? out.lang : guessLangFromTelegram(ctx.from);

    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore
    }

    const message = `${t(lang, 'lang_updated', { lang: (LANG_LABELS[lang] || lang) })}\n\n${t(lang, 'start_ready')}`;
    try {
      await ctx.editMessageText(message);
    } catch {
      await ctx.reply(message);
    }

    await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
  });

  bot.command('search', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const query = extractArgs(ctx.message.text, 'search');
    if (!query) {
      await ctx.reply(t(lang, 'usage_search'));
      return;
    }

    await ctx.reply(t(lang, 'searching', { query }));

    try {
      const results = await searchAnime(query, 5);
      await repository.upsertCatalog(results);
      await ctx.reply(formatSearchResults(results.slice(0, 10), { empty: labels.search.empty }));
    } catch (error) {
      await ctx.reply(t(lang, 'search_failed', { error: error.message }));
    }
  });

  async function resolveAnimeFromUid(uid) {
    if (!uid) {
      return null;
    }
    return repository.getCatalogItem(uid);
  }

  bot.command('watch', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'watch');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply(t(lang, 'unknown_id'));
      return;
    }

    await repository.addToTrackedList(ctx.from, 'watched', anime);
    const stats = await repository.getWatchStats(String(ctx.from.id), uid);
    await ctx.reply(t(lang, 'saved_watched', {
      title: anime.title,
      you: stats.userWatchCount,
      friends: stats.friendsWatchCount
    }));
  });

  bot.command('watched', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const items = await repository.getWatchedWithFriendStats(String(ctx.from.id));
    await ctx.reply(formatTrackedList(labels.watchedTitle, items, { showWatchCounters: true, emptyWord: labels.emptyWord }));
  });

  bot.command('unwatch', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'unwatch');
    if (!uid) {
      await ctx.reply(t(lang, 'usage_unwatch'));
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'watched', uid);
    await ctx.reply(removed ? t(lang, 'removed_watched', { uid }) : t(lang, 'not_in_watched'));
  });

  bot.command('plan', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'plan');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply(t(lang, 'unknown_id'));
      return;
    }

    await repository.addToTrackedList(ctx.from, 'planned', anime);
    await ctx.reply(t(lang, 'added_planned', { title: anime.title }));
  });

  bot.command('planned', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const items = await repository.getTrackedList(String(ctx.from.id), 'planned');
    await ctx.reply(formatTrackedList(labels.plannedTitle, items, { emptyWord: labels.emptyWord }));
  });

  bot.command('unplan', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'unplan');
    if (!uid) {
      await ctx.reply(t(lang, 'usage_unplan'));
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'planned', uid);
    await ctx.reply(removed ? t(lang, 'removed_planned', { uid }) : t(lang, 'not_in_planned'));
  });

  bot.command('favorite', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'favorite');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply(t(lang, 'unknown_id'));
      return;
    }

    await repository.addToTrackedList(ctx.from, 'favorite', anime);
    await ctx.reply(t(lang, 'added_favorite', { title: anime.title }));
  });

  bot.command('favorites', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const items = await repository.getTrackedList(String(ctx.from.id), 'favorite');
    await ctx.reply(formatTrackedList(labels.favoritesTitle, items, { emptyWord: labels.emptyWord }));
  });

  bot.command('unfavorite', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'unfavorite');
    if (!uid) {
      await ctx.reply(t(lang, 'usage_unfavorite'));
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'favorite', uid);
    await ctx.reply(removed ? t(lang, 'removed_favorite', { uid }) : t(lang, 'not_in_favorites'));
  });

  bot.command('recommend', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'recommend');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply(t(lang, 'unknown_id'));
      return;
    }

    await repository.addRecommendation(ctx.from, anime);
    await ctx.reply(t(lang, 'recommended_saved', { title: anime.title }));
  });

  bot.command('recommendations', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const items = await repository.getOwnRecommendations(String(ctx.from.id));
    await ctx.reply(formatTrackedList(labels.ownRecommendationsTitle, items, { emptyWord: labels.emptyWord }));
  });

  bot.command('unrecommend', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'unrecommend');
    if (!uid) {
      await ctx.reply(t(lang, 'usage_unrecommend'));
      return;
    }

    const removed = await repository.removeRecommendation(String(ctx.from.id), uid);
    await ctx.reply(removed ? t(lang, 'removed_recommendation', { uid }) : t(lang, 'not_in_recommendations'));
  });

  bot.command('feed', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const items = await repository.getRecommendationsFromFriends(String(ctx.from.id));
    await ctx.reply(formatRecommendationsFromFriends(items, labels.recsFromFriends));
  });

  bot.command('invite', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const token = await repository.createInviteToken(ctx.from);
    const link = buildInviteLink(token);

    const lines = [t(lang, 'invite_token', { token }), t(lang, 'invite_howto')];
    if (link) {
      lines.push(t(lang, 'invite_link', { link }));
    }

    await ctx.reply(lines.join('\n'));
  });

  bot.command('join', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const token = extractArgs(ctx.message.text, 'join');
    if (!token) {
      await ctx.reply(t(lang, 'usage_join'));
      return;
    }

    const result = await repository.addFriendByToken(ctx.from, token);
    if (result.ok) {
      await ctx.reply(t(lang, 'friend_added', { label: result.inviter.label }));
      return;
    }

    if (result.reason === 'self_friend') {
      await ctx.reply(t(lang, 'cannot_add_self'));
      return;
    }

    await ctx.reply(t(lang, 'invalid_invite'));
  });

  bot.command('friends', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const labels = uiLabels(lang);
    const friends = await repository.getFriends(String(ctx.from.id));
    await ctx.reply(formatFriends(friends, labels.friends));
  });

  bot.command('stats', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const uid = extractArgs(ctx.message.text, 'stats');
    if (!uid) {
      await ctx.reply(t(lang, 'usage_stats'));
      return;
    }

    const anime = await resolveAnimeFromUid(uid);
    const stats = await repository.getWatchStats(String(ctx.from.id), uid);
    const label = anime?.title || uid;

    await ctx.reply(t(lang, 'stats_line', {
      label,
      you: stats.userWatchCount,
      friends: stats.friendsWatchCount
    }));
  });

  bot.command('dashboard', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    await ctx.reply(t(lang, 'dashboard_api', { url: `${config.apiBaseUrl}/api/dashboard/${ctx.from.id}` }));
  });

  bot.command('app', async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const webAppUrl = buildMiniAppUrl(ctx.from.id);
    await ctx.reply(
      t(lang, 'open_miniapp'),
      Markup.inlineKeyboard([
        Markup.button.webApp(t(lang, 'btn_open_miniapp'), webAppUrl)
      ])
    );
  });

  bot.action(/^pick:(\d+)$/, async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const idx = Number(ctx.match?.[1] || -1);
    const state = userState.get(String(ctx.from.id));
    const results = state?.search?.results;

    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore
    }

    if (!Array.isArray(results) || idx < 0 || idx >= results.length) {
      await ctx.reply(t(lang, 'pick_result'), cancelKeyboard(lang));
      return;
    }

    const picked = results[idx];
    await ctx.reply(
      `${picked.title}\nID: ${picked.uid}\n\n${t(lang, 'pick_action')}`,
      actionKeyboard(lang, picked.uid)
    );
  });

  bot.action(/^pick:back$/, async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const state = userState.get(String(ctx.from.id));
    const results = state?.search?.results;

    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore
    }

    if (!Array.isArray(results) || results.length === 0) {
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    const labels = uiLabels(lang);
    const text = formatSearchResults(results, { empty: labels.search.empty });
    await ctx.reply(`${t(lang, 'pick_result')}\n\n${text}`, pickKeyboard(lang, Math.min(results.length, 10)));
  });

  bot.action(/^act:(watch|plan|favorite|recommend):(.+)$/, async (ctx) => {
    const lang = await ensureUserAndLang(ctx, repository);
    const kind = String(ctx.match?.[1] || '');
    const uid = String(ctx.match?.[2] || '').trim();

    try {
      await ctx.answerCbQuery();
    } catch {
      // ignore
    }

    const anime = await repository.getCatalogItem(uid);
    if (!anime) {
      await ctx.reply(t(lang, 'unknown_id'));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (kind === 'watch') {
      await repository.addToTrackedList(ctx.from, 'watched', anime);
      const stats = await repository.getWatchStats(String(ctx.from.id), uid);
      await ctx.reply(t(lang, 'saved_watched', { title: anime.title, you: stats.userWatchCount, friends: stats.friendsWatchCount }));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (kind === 'plan') {
      await repository.addToTrackedList(ctx.from, 'planned', anime);
      await ctx.reply(t(lang, 'added_planned', { title: anime.title }));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    if (kind === 'favorite') {
      await repository.addToTrackedList(ctx.from, 'favorite', anime);
      await ctx.reply(t(lang, 'added_favorite', { title: anime.title }));
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      return;
    }

    await repository.addRecommendation(ctx.from, anime);
    await ctx.reply(t(lang, 'recommended_saved', { title: anime.title }));
    await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
  });

  bot.on('text', async (ctx) => {
    if (ctx.message.text?.startsWith('/')) {
      return;
    }

    const lang = await ensureUserAndLang(ctx, repository);
    const state = userState.get(String(ctx.from.id));

    if (state?.awaiting === 'search_query') {
      const query = String(ctx.message.text || '').trim();
      if (!query) {
        await ctx.reply(t(lang, 'prompt_search'), cancelKeyboard(lang));
        return;
      }

      const labels = uiLabels(lang);
      await ctx.reply(t(lang, 'searching', { query }));

      try {
        const results = await searchAnime(query, 5);
        await repository.upsertCatalog(results);
        const compact = results.slice(0, 10).map((r) => ({ uid: r.uid, title: r.title, source: r.source, url: r.url, score: r.score, episodes: r.episodes, status: r.status }));

        userState.set(String(ctx.from.id), { awaiting: null, search: { query, results: compact } });

        const text = formatSearchResults(compact, { empty: labels.search.empty });
        await ctx.reply(`${t(lang, 'pick_result')}\n\n${text}`, pickKeyboard(lang, Math.min(compact.length, 10)));
      } catch (error) {
        await ctx.reply(t(lang, 'search_failed', { error: error.message }));
        await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
      }

      return;
    }

    await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
  });

  bot.on('message', async (ctx) => {
    if (!ctx.message.text?.startsWith('/')) {
      // text handler above shows the menu; keep this as a fallback for non-text messages.
      const lang = await ensureUserAndLang(ctx, repository);
      await ctx.reply(t(lang, 'menu_title'), mainMenuKeyboard(ctx, lang));
    }
  });

  bot.catch(async (error, ctx) => {
    logger.error('bot error', error);
    const lang = ctx?.from ? await ensureUserAndLang(ctx, repository) : 'en';
    await ctx.reply(t(lang, 'unexpected_error'));
  });
}

const apiServer = await startApiServer({
  repository,
  port: config.apiPort,
  telegramToken: config.telegramToken,
  webAppAuthMaxAgeSec: config.webAppAuthMaxAgeSec,
  bot,
  telegramWebhookPath: config.telegramWebhookPath,
  telegramWebhookSecret: config.telegramWebhookSecret
});

logger.info('api server started', {
  port: config.apiPort,
  webhookMode: Boolean(config.telegramWebhookUrl),
  webhookPath: config.telegramWebhookPath
});

if (bot) {
  if (config.telegramWebhookUrl) {
    const me = await bot.telegram.getMe();
    bot.botInfo = me;
    logger.info('bot ready in webhook mode (no polling)', {
      webhookUrl: config.telegramWebhookUrl,
      webhookPath: config.telegramWebhookPath,
      secretEnabled: Boolean(config.telegramWebhookSecret)
    });
  } else {
    await bot.launch();
    logger.info('telegram bot started (long polling)');
  }
}

async function shutdown(signal) {
  logger.info('stopping services', { signal });
  try {
    if (bot) {
      bot.stop(signal);
    }
    await apiServer.close();
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

import telegrafPkg from 'telegraf';
import { config } from './config.js';
import { AnimeRepository } from './db.js';
import { createLogger } from './logger.js';
import { startApiServer } from './server.js';
import { searchAnime } from './services/animeSources.js';
import {
  formatFriends,
  formatRecommendationsFromFriends,
  formatSearchResults,
  formatTrackedList
} from './utils/formatters.js';

const { Markup, Telegraf } = telegrafPkg;

const logger = createLogger('backend');

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
  logger.warn('telegram bot token is empty, bot disabled');
} else {
  const helpText = [
    'Commands:',
    '/search <title> - search anime in Jikan + AniList',
    '/watch <uid> - add anime to watched (+1 view count)',
    '/watched - show watched list with your/friends counters',
    '/unwatch <uid> - remove anime from watched',
    '/plan <uid> - add anime to planned',
    '/planned - show planned list',
    '/unplan <uid> - remove anime from planned',
    '/favorite <uid> - add anime to favorites',
    '/favorites - show favorites list',
    '/unfavorite <uid> - remove from favorites',
    '/recommend <uid> - recommend anime to friends',
    '/recommendations - your own recommendations',
    '/feed - recommendations from friends',
    '/invite - generate friend invite token/link',
    '/join <token> - add friend by token',
    '/friends - show friend list',
    '/stats <uid> - views counter for you and friends',
    '/dashboard - your dashboard API URL',
    '/app - open Telegram Mini App dashboard',
    '/help - show this help'
  ].join('\n');

  bot.start(async (ctx) => {
    await repository.ensureUser(ctx.from);

    const payload = ctx.startPayload || extractArgs(ctx.message?.text || '', 'start');
    if (payload) {
      const result = await repository.addFriendByToken(ctx.from, payload);
      if (result.ok) {
        await ctx.reply(`Friend added: ${result.inviter.label}`);
      } else if (result.reason === 'self_friend') {
        await ctx.reply('You cannot add yourself as a friend.');
      } else {
        await ctx.reply('Invite token is invalid.');
      }
    }

    await ctx.reply('Anime tracker bot is ready.\nUse /help to see commands.');
  });

  bot.help(async (ctx) => {
    await repository.ensureUser(ctx.from);
    await ctx.reply(helpText);
  });

  bot.command('search', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const query = extractArgs(ctx.message.text, 'search');
    if (!query) {
      await ctx.reply('Usage: /search <title>');
      return;
    }

    await ctx.reply(`Searching for: ${query}`);

    try {
      const results = await searchAnime(query, 5);
      await repository.upsertCatalog(results);
      await ctx.reply(formatSearchResults(results.slice(0, 10)));
    } catch (error) {
      await ctx.reply(`Search failed: ${error.message}`);
    }
  });

  async function resolveAnimeFromUid(uid) {
    if (!uid) {
      return null;
    }
    return repository.getCatalogItem(uid);
  }

  bot.command('watch', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'watch');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply('Unknown ID. First run /search and use an ID from search results.');
      return;
    }

    await repository.addToTrackedList(ctx.from, 'watched', anime);
    const stats = await repository.getWatchStats(String(ctx.from.id), uid);
    await ctx.reply(`Saved as watched: ${anime.title}\nYour views: ${stats.userWatchCount}\nFriends views: ${stats.friendsWatchCount}`);
  });

  bot.command('watched', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const items = await repository.getWatchedWithFriendStats(String(ctx.from.id));
    await ctx.reply(formatTrackedList('Watched', items, { showWatchCounters: true }));
  });

  bot.command('unwatch', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'unwatch');
    if (!uid) {
      await ctx.reply('Usage: /unwatch <uid>');
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'watched', uid);
    await ctx.reply(removed ? `Removed from watched: ${uid}` : 'ID not found in watched list.');
  });

  bot.command('plan', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'plan');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply('Unknown ID. First run /search and use an ID from search results.');
      return;
    }

    await repository.addToTrackedList(ctx.from, 'planned', anime);
    await ctx.reply(`Added to planned: ${anime.title}`);
  });

  bot.command('planned', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const items = await repository.getTrackedList(String(ctx.from.id), 'planned');
    await ctx.reply(formatTrackedList('Planned', items));
  });

  bot.command('unplan', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'unplan');
    if (!uid) {
      await ctx.reply('Usage: /unplan <uid>');
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'planned', uid);
    await ctx.reply(removed ? `Removed from planned: ${uid}` : 'ID not found in planned list.');
  });

  bot.command('favorite', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'favorite');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply('Unknown ID. First run /search and use an ID from search results.');
      return;
    }

    await repository.addToTrackedList(ctx.from, 'favorite', anime);
    await ctx.reply(`Added to favorites: ${anime.title}`);
  });

  bot.command('favorites', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const items = await repository.getTrackedList(String(ctx.from.id), 'favorite');
    await ctx.reply(formatTrackedList('Favorites', items));
  });

  bot.command('unfavorite', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'unfavorite');
    if (!uid) {
      await ctx.reply('Usage: /unfavorite <uid>');
      return;
    }

    const removed = await repository.removeFromTrackedList(String(ctx.from.id), 'favorite', uid);
    await ctx.reply(removed ? `Removed from favorites: ${uid}` : 'ID not found in favorites list.');
  });

  bot.command('recommend', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'recommend');
    const anime = await resolveAnimeFromUid(uid);

    if (!anime) {
      await ctx.reply('Unknown ID. First run /search and use an ID from search results.');
      return;
    }

    await repository.addRecommendation(ctx.from, anime);
    await ctx.reply(`Recommended for friends: ${anime.title}`);
  });

  bot.command('recommendations', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const items = await repository.getOwnRecommendations(String(ctx.from.id));
    await ctx.reply(formatTrackedList('Your recommendations', items));
  });

  bot.command('unrecommend', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'unrecommend');
    if (!uid) {
      await ctx.reply('Usage: /unrecommend <uid>');
      return;
    }

    const removed = await repository.removeRecommendation(String(ctx.from.id), uid);
    await ctx.reply(removed ? `Removed recommendation: ${uid}` : 'ID not found in your recommendations.');
  });

  bot.command('feed', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const items = await repository.getRecommendationsFromFriends(String(ctx.from.id));
    await ctx.reply(formatRecommendationsFromFriends(items));
  });

  bot.command('invite', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const token = await repository.createInviteToken(ctx.from);
    const link = buildInviteLink(token);

    const lines = [`Invite token: ${token}`, 'Send token via /join <token>.'];
    if (link) {
      lines.push(`Invite link: ${link}`);
    }

    await ctx.reply(lines.join('\n'));
  });

  bot.command('join', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const token = extractArgs(ctx.message.text, 'join');
    if (!token) {
      await ctx.reply('Usage: /join <token>');
      return;
    }

    const result = await repository.addFriendByToken(ctx.from, token);
    if (result.ok) {
      await ctx.reply(`Friend added: ${result.inviter.label}`);
      return;
    }

    if (result.reason === 'self_friend') {
      await ctx.reply('You cannot add yourself as a friend.');
      return;
    }

    await ctx.reply('Invite token is invalid.');
  });

  bot.command('friends', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const friends = await repository.getFriends(String(ctx.from.id));
    await ctx.reply(formatFriends(friends));
  });

  bot.command('stats', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const uid = extractArgs(ctx.message.text, 'stats');
    if (!uid) {
      await ctx.reply('Usage: /stats <uid>');
      return;
    }

    const anime = await resolveAnimeFromUid(uid);
    const stats = await repository.getWatchStats(String(ctx.from.id), uid);
    const label = anime?.title || uid;

    await ctx.reply(`${label}\nYour views: ${stats.userWatchCount}\nFriends views: ${stats.friendsWatchCount}`);
  });

  bot.command('dashboard', async (ctx) => {
    await repository.ensureUser(ctx.from);
    await ctx.reply(`Dashboard API: ${config.apiBaseUrl}/api/dashboard/${ctx.from.id}`);
  });

  bot.command('app', async (ctx) => {
    await repository.ensureUser(ctx.from);
    const webAppUrl = buildMiniAppUrl(ctx.from.id);
    await ctx.reply(
      'Open your dashboard in Telegram Mini App:',
      Markup.inlineKeyboard([
        Markup.button.webApp('Open Mini App', webAppUrl)
      ])
    );
  });

  bot.on('message', async (ctx) => {
    if (!ctx.message.text?.startsWith('/')) {
      await ctx.reply('Use /help to see available commands.');
    }
  });

  bot.catch(async (error, ctx) => {
    logger.error('bot error', error);
    await ctx.reply('Unexpected error. Try again later.');
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

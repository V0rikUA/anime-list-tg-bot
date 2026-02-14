import { guessLangFromTelegram, t } from '../i18n.js';
import { getSession } from '../session.js';
import { tryDeleteUserMessage, ensureUserAndLang } from '../utils/helpers.js';
import { createLogger } from '../logger.js';
import { goHome } from './navigation.js';
import { performSearch } from './search.js';

const logger = createLogger('bot-service');

export function registerMessages(bot) {
  bot.on('text', async (ctx) => {
    if (ctx.message?.text?.startsWith('/')) return;

    const lang = await ensureUserAndLang(ctx);
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
    const lang = await ensureUserAndLang(ctx);
    await goHome(ctx, lang);
  });

  bot.catch(async (error, ctx) => {
    logger.error('bot error', error);
    let lang = 'en';
    try {
      if (ctx?.from) lang = await ensureUserAndLang(ctx);
    } catch {
      lang = guessLangFromTelegram(ctx?.from);
    }
    try {
      await ctx.reply(t(lang, 'unexpected_error'));
    } catch (replyError) {
      logger.warn('failed to send error message to telegram', {
        error: replyError?.message || String(replyError)
      });
    }
  });
}

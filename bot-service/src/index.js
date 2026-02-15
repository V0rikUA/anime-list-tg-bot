import telegrafPkg from 'telegraf';
import Fastify from 'fastify';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { t } from './i18n.js';
import * as listClient from './services/listClient.js';
import { sleep } from './utils/helpers.js';
import { registerCommands } from './handlers/commands.js';
import { registerCallbacks } from './handlers/callbacks.js';
import { registerMessages } from './handlers/messages.js';

const { Telegraf } = telegrafPkg;

const logger = createLogger('bot-service');

// ---------------------------------------------------------------------------
// Wait for list-service to be ready before accepting traffic
// ---------------------------------------------------------------------------

async function waitForListServiceReady() {
  for (let attempt = 1; attempt <= config.startupMaxRetries; attempt += 1) {
    try {
      const health = await listClient.checkHealth();
      if (!health.ok) {
        throw new Error(health.error || 'unknown list-service health error');
      }

      logger.info('list-service is healthy', { attempt });
      return;
    } catch (error) {
      logger.warn('list-service is not ready yet', {
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

await waitForListServiceReady();

const ADMIN_TELEGRAM_ID = '181502277';

const bot = config.telegramToken ? new Telegraf(config.telegramToken) : null;

if (!bot) {
  logger.warn(t('en', 'bot_disabled'));
} else {
  registerCommands(bot);
  registerCallbacks(bot);
  registerMessages(bot);

  bot.catch(async (error, ctx) => {
    const userId = String(ctx?.from?.id || '');
    const lang = ctx?.from?.language_code || 'en';
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack || '';

    logger.error('bot handler error', {
      userId,
      updateType: ctx?.updateType,
      error: errorMessage,
      stack: errorStack
    });

    try {
      if (userId === ADMIN_TELEGRAM_ID) {
        const debugText = `Error: ${errorMessage}\n\nStack: ${errorStack}`.slice(0, 4000);
        await ctx.reply(debugText);
      } else {
        await ctx.reply(t(lang, 'unexpected_error'));
      }
    } catch (replyError) {
      logger.error('failed to send error reply', {
        userId,
        originalError: errorMessage,
        replyError: replyError?.message || String(replyError)
      });
    }
  });
}

const httpServer = Fastify({ logger: { level: 'info' } });

httpServer.get('/healthz', async () => {
  const health = await listClient.checkHealth();
  if (!health.ok) return { ok: false, listService: health };
  return { ok: true, listService: health, uptimeSec: Math.floor(process.uptime()) };
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

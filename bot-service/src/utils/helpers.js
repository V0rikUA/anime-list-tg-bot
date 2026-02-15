import { guessLangFromTelegram } from '../i18n.js';
import * as listClient from '../services/listClient.js';
import { createLogger } from '../logger.js';

const logger = createLogger('helpers');

export function parseEpisodeNumber(labelRaw) {
  const label = String(labelRaw || '').trim();
  const direct = Number(label);
  if (Number.isFinite(direct)) return direct;
  const m = label.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export async function tryDeleteMessage(telegram, chatId, messageId) {
  if (!chatId || !messageId) return;
  try {
    await telegram.deleteMessage(chatId, messageId);
  } catch {
    // ignore
  }
}

export async function tryDeleteUserMessage(ctx) {
  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (!chatId || !messageId) return;
  await tryDeleteMessage(ctx.telegram, chatId, messageId);
}

export async function ackCbQuery(ctx, session) {
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractArgs(text, command) {
  if (!text) {
    return '';
  }

  const pattern = new RegExp(`^/${command}(?:@\\w+)?\\s*`, 'i');
  return text.replace(pattern, '').trim();
}

export async function ensureUserAndLang(ctx) {
  try {
    const user = await listClient.ensureUser(ctx.from);
    return user?.lang || guessLangFromTelegram(ctx.from);
  } catch (err) {
    logger.warn('ensureUser failed, falling back to telegram language', {
      userId: String(ctx.from?.id || ''),
      error: err.message
    });
    return guessLangFromTelegram(ctx.from);
  }
}

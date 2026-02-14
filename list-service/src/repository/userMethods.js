import { normalizeLang, safeLang } from './normalizers.js';

export function applyUserMethods(proto) {
  proto.ensureUserByTelegramId = async function(telegramIdRaw) {
    return this._ensureUserByTelegramId(this.db, telegramIdRaw);
  };

  proto.getUserByTelegramId = async function(telegramIdRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    if (!telegramId) return null;
    return this.db('users').where({ telegram_id: telegramId }).first();
  };

  proto.ensureUser = async function(telegramUser) {
    const guessedLang = normalizeLang(telegramUser?.languageCode || telegramUser?.language_code);
    const telegramId = String(telegramUser?.telegramId || telegramUser?.id || '').trim();
    if (!telegramId) throw new Error('telegramId is required');

    const payload = {
      telegram_id: telegramId,
      username: telegramUser.username ?? null,
      first_name: telegramUser.firstName ?? telegramUser.first_name ?? null,
      last_name: telegramUser.lastName ?? telegramUser.last_name ?? null,
      lang: guessedLang,
      updated_at: this.db.fn.now()
    };

    const mergePayload = {
      username: payload.username,
      first_name: payload.first_name,
      last_name: payload.last_name,
      updated_at: payload.updated_at
    };

    await this.db('users').insert(payload).onConflict('telegram_id').merge(mergePayload);
    const user = await this.db('users').where({ telegram_id: telegramId }).first();

    if (user && !user.lang && guessedLang) {
      await this.db('users')
        .where({ telegram_id: telegramId })
        .update({ lang: guessedLang, updated_at: this.db.fn.now() });
      return this.db('users').where({ telegram_id: telegramId }).first();
    }

    return user;
  };

  proto.setUserLang = async function(telegramIdRaw, langRaw) {
    const telegramId = String(telegramIdRaw || '').trim();
    const lang = safeLang(langRaw);
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return { ok: false, reason: 'user_not_found' };
    }

    await this.db('users')
      .where({ telegram_id: telegramId })
      .update({ lang, updated_at: this.db.fn.now() });

    return { ok: true, lang };
  };
}

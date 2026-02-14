import crypto from 'node:crypto';
import { normalizeLang } from '../services/translate.js';
import { normalizeStoredLang, safeFriendName } from './normalizers.js';

export function applyUserMethods(proto) {
  proto.ensureUser = async function(telegramUser) {
    const guessedLang = normalizeLang(telegramUser?.language_code);
    const payload = {
      telegram_id: String(telegramUser.id),
      username: telegramUser.username ?? null,
      first_name: telegramUser.first_name ?? null,
      last_name: telegramUser.last_name ?? null,
      lang: guessedLang,
      updated_at: this.db.fn.now()
    };

    // Do not override lang on existing user; only fill it on first insert.
    // Do not overwrite username/first_name/last_name with null when called with just { id }.
    const mergePayload = { updated_at: payload.updated_at };
    if (payload.username != null) mergePayload.username = payload.username;
    if (payload.first_name != null) mergePayload.first_name = payload.first_name;
    if (payload.last_name != null) mergePayload.last_name = payload.last_name;

    await this.db('users').insert(payload).onConflict('telegram_id').merge(mergePayload);
    const user = await this.db('users').where({ telegram_id: payload.telegram_id }).first();

    if (user && !user.lang && guessedLang) {
      await this.db('users')
        .where({ telegram_id: payload.telegram_id })
        .update({ lang: guessedLang, updated_at: this.db.fn.now() });
      return this.db('users').where({ telegram_id: payload.telegram_id }).first();
    }

    return user;
  };

  proto.getUserByTelegramId = async function(telegramId) {
    return this.db('users').where({ telegram_id: String(telegramId) }).first();
  };

  proto.setUserLang = async function(telegramId, langRaw) {
    const lang = normalizeStoredLang(langRaw);
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return { ok: false, reason: 'user_not_found' };
    }

    await this.db('users')
      .where({ telegram_id: String(telegramId) })
      .update({ lang, updated_at: this.db.fn.now() });

    return { ok: true, lang };
  };

  proto.getFriends = async function(telegramId) {
    const user = await this.getUserByTelegramId(telegramId);
    if (!user) {
      return [];
    }

    const rows = await this.db('friendships as f')
      .join('users as u', 'u.id', 'f.friend_user_id')
      .where('f.user_id', user.id)
      .orderBy('u.username', 'asc')
      .select('u.telegram_id', 'u.username', 'u.first_name', 'u.last_name');

    return rows.map((row) => ({
      telegramId: row.telegram_id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      label: safeFriendName(row)
    }));
  };

  proto.createInviteToken = async function(telegramUser) {
    const user = await this.ensureUser(telegramUser);
    const existing = await this.db('friend_invites')
      .where({ inviter_user_id: user.id })
      .first();

    // Stable per-user token (unique per inviter, not per request).
    if (existing?.token) {
      return existing.token;
    }

    // Extremely unlikely to hit token collisions, but keep it safe.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = crypto.randomBytes(16).toString('hex');
      try {
        await this.db('friend_invites').insert({
          inviter_user_id: user.id,
          token
        });
        return token;
      } catch (error) {
        // If inviter row was created concurrently, reuse it.
        const invite = await this.db('friend_invites')
          .where({ inviter_user_id: user.id })
          .first();
        if (invite?.token) {
          return invite.token;
        }
        // Otherwise retry token generation (e.g. rare token unique violation).
      }
    }

    throw new Error('Failed to generate invite token');
  };

  proto.addFriendByToken = async function(telegramUser, tokenRaw) {
    const token = String(tokenRaw || '').trim();
    if (!token) {
      return { ok: false, reason: 'invalid_token' };
    }

    return this.db.transaction(async (trx) => {
      const joinerPayload = {
        telegram_id: String(telegramUser.id),
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        updated_at: this.db.fn.now()
      };

      await trx('users').insert(joinerPayload).onConflict('telegram_id').merge(joinerPayload);
      const joiner = await trx('users').where({ telegram_id: joinerPayload.telegram_id }).first();

      const invite = await trx('friend_invites as i')
        .join('users as u', 'u.id', 'i.inviter_user_id')
        .where('i.token', token)
        .select('i.inviter_user_id', 'u.telegram_id', 'u.username', 'u.first_name', 'u.last_name')
        .first();

      if (!invite) {
        return { ok: false, reason: 'invalid_token' };
      }

      if (invite.inviter_user_id === joiner.id) {
        return { ok: false, reason: 'self_friend' };
      }

      await trx('friendships').insert({ user_id: joiner.id, friend_user_id: invite.inviter_user_id })
        .onConflict(['user_id', 'friend_user_id']).ignore();
      await trx('friendships').insert({ user_id: invite.inviter_user_id, friend_user_id: joiner.id })
        .onConflict(['user_id', 'friend_user_id']).ignore();

      return {
        ok: true,
        inviter: {
          telegramId: invite.telegram_id,
          username: invite.username,
          firstName: invite.first_name,
          lastName: invite.last_name,
          label: safeFriendName(invite)
        }
      };
    });
  };

  proto.ensureUserInTransaction = async function(trx, telegramUser) {
    const guessedLang = normalizeLang(telegramUser?.language_code);
    const payload = {
      telegram_id: String(telegramUser.id),
      username: telegramUser.username ?? null,
      first_name: telegramUser.first_name ?? null,
      last_name: telegramUser.last_name ?? null,
      lang: guessedLang,
      updated_at: this.db.fn.now()
    };

    const mergePayload = {
      username: payload.username,
      first_name: payload.first_name,
      last_name: payload.last_name,
      updated_at: payload.updated_at
    };

    await trx('users').insert(payload).onConflict('telegram_id').merge(mergePayload);
    return trx('users').where({ telegram_id: payload.telegram_id }).first();
  };
}

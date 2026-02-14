import crypto from 'node:crypto';
import { safeFriendName } from './normalizers.js';

export function applyFriendMethods(proto) {
  proto.getFriends = async function(telegramIdRaw) {
    const user = await this.getUserByTelegramId(telegramIdRaw);
    if (!user) return [];

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

    if (existing?.token) return existing.token;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = crypto.randomBytes(16).toString('hex');
      try {
        await this.db('friend_invites').insert({
          inviter_user_id: user.id,
          token
        });
        return token;
      } catch {
        const invite = await this.db('friend_invites')
          .where({ inviter_user_id: user.id })
          .first();
        if (invite?.token) return invite.token;
      }
    }

    throw new Error('Failed to generate invite token');
  };

  proto.addFriendByToken = async function(joinerData, tokenRaw) {
    const token = String(tokenRaw || '').trim();
    if (!token) return { ok: false, reason: 'invalid_token' };

    const telegramId = String(joinerData?.telegramId || joinerData?.id || '').trim();
    if (!telegramId) return { ok: false, reason: 'invalid_user' };

    return this.db.transaction(async (trx) => {
      const joinerPayload = {
        telegram_id: telegramId,
        username: joinerData.username ?? null,
        first_name: joinerData.firstName ?? joinerData.first_name ?? null,
        last_name: joinerData.lastName ?? joinerData.last_name ?? null,
        updated_at: this.db.fn.now()
      };

      await trx('users').insert(joinerPayload).onConflict('telegram_id').merge(joinerPayload);
      const joiner = await trx('users').where({ telegram_id: telegramId }).first();

      const invite = await trx('friend_invites as i')
        .join('users as u', 'u.id', 'i.inviter_user_id')
        .where('i.token', token)
        .select('i.inviter_user_id', 'u.telegram_id', 'u.username', 'u.first_name', 'u.last_name')
        .first();

      if (!invite) return { ok: false, reason: 'invalid_token' };
      if (invite.inviter_user_id === joiner.id) return { ok: false, reason: 'self_friend' };

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
}

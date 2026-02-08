import crypto from 'node:crypto';

function parseInitData(initDataRaw) {
  const initData = String(initDataRaw || '').trim();
  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'missing_hash' };
  }

  const dataPairs = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') {
      continue;
    }
    dataPairs.push(`${key}=${value}`);
  }

  dataPairs.sort();

  return {
    ok: true,
    hash,
    dataCheckString: dataPairs.join('\n'),
    params
  };
}

export function validateTelegramWebAppInitData({ initData, botToken, maxAgeSec = 86400 }) {
  if (!botToken) {
    return { ok: false, error: 'bot_token_not_configured' };
  }

  const parsed = parseInitData(initData);
  if (!parsed.ok) {
    return parsed;
  }

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(parsed.dataCheckString).digest('hex');

  const hashBuffer = Buffer.from(parsed.hash, 'hex');
  const calcBuffer = Buffer.from(calculatedHash, 'hex');

  if (hashBuffer.length !== calcBuffer.length || !crypto.timingSafeEqual(hashBuffer, calcBuffer)) {
    return { ok: false, error: 'invalid_hash' };
  }

  const authDateRaw = parsed.params.get('auth_date');
  const authDate = Number(authDateRaw || 0);
  if (!Number.isInteger(authDate) || authDate <= 0) {
    return { ok: false, error: 'invalid_auth_date' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSec) {
    return { ok: false, error: 'expired_auth_date' };
  }

  const userRaw = parsed.params.get('user');
  let user = null;

  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      return { ok: false, error: 'invalid_user_payload' };
    }
  }

  const telegramUserId = user?.id ? String(user.id) : null;
  if (!telegramUserId) {
    return { ok: false, error: 'missing_user_id' };
  }

  return {
    ok: true,
    telegramUserId,
    user,
    authDate
  };
}

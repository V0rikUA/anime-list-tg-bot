import { config } from '../config.js';

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function callTelegram(method, params) {
  const token = requireEnv('TELEGRAM_BOT_TOKEN', config.telegramToken);
  const url = `https://api.telegram.org/bot${token}/${method}`;

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') {
      continue;
    }
    body.set(k, String(v));
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Telegram API ${method} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

const action = process.argv[2];

if (!action || !['set', 'info', 'delete'].includes(action)) {
  console.error('Usage: node src/scripts/webhook.js <set|info|delete>');
  process.exit(1);
}

if (action === 'info') {
  const out = await callTelegram('getWebhookInfo', {});
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (action === 'delete') {
  const out = await callTelegram('deleteWebhook', { drop_pending_updates: 'true' });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const webhookUrl = requireEnv('TELEGRAM_WEBHOOK_URL', config.telegramWebhookUrl);
const params = { url: webhookUrl };

if (config.telegramWebhookSecret) {
  params.secret_token = config.telegramWebhookSecret;
}

const out = await callTelegram('setWebhook', params);
console.log(JSON.stringify(out, null, 2));

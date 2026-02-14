export const userState = new Map();

export function getSession(userId) {
  const key = String(userId || '');
  let session = userState.get(key);
  if (!session || typeof session !== 'object') {
    session = {};
    userState.set(key, session);
  }

  if (!('screenMessageId' in session)) session.screenMessageId = null;
  if (!('current' in session)) session.current = null;
  if (!Array.isArray(session.stack)) session.stack = [];
  if (!('awaiting' in session)) session.awaiting = null;
  if (!('search' in session)) session.search = null;
  if (!Array.isArray(session.continueItems)) session.continueItems = [];

  return session;
}

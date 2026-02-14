import { getSession } from '../session.js';
import { renderState, HOME } from '../ui/renderState.js';

export async function goHome(ctx, lang, note = '') {
  const session = getSession(ctx.from.id);
  session.awaiting = null;
  session.search = null;
  session.stack = [];
  session.current = { id: HOME, note };
  return renderState(ctx, lang, session.current);
}

export async function pushAndGo(ctx, lang, nextState) {
  const session = getSession(ctx.from.id);
  if (session.current) {
    session.stack.push(session.current);
  }
  session.current = nextState;
  return renderState(ctx, lang, session.current);
}

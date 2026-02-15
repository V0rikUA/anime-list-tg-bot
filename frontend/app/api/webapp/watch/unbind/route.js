import { proxyPost } from '../../../_lib/proxyFetch.js';

export async function POST(request) {
  return proxyPost('/api/webapp/watch/unbind', request);
}

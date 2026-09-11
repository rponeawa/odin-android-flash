const UPSTREAM = 'https://file.xkji.com/xiaomi/api/issue';
const ORIGIN = 'https://odin.androidflash.xyz';
export default {
  async fetch(request) {
    const headers = new Headers({ 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });
    const upstream = await fetch(UPSTREAM, { method: 'POST', body: request.body, headers: { 'Content-Type': request.headers.get('Content-Type') || '' } });
    const out = new Response(upstream.body, { status: upstream.status, headers });
    out.headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return out;
  }
};

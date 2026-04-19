function getCookieValue(cookieHeader, name) {
  const cookies = (cookieHeader || '').split(';').map((v) => v.trim());
  for (const cookie of cookies) {
    const [k, ...rest] = cookie.split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

export async function onRequestGet(context) {
  const token = getCookieValue(context.request.headers.get('Cookie'), 'hh_auth');

  return new Response(JSON.stringify({ ok: token === '1' }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestPost(context) {
  try {
    const secretKeyword = context.env.APP_KEYWORD;
    const body = await context.request.json();
    const inputKeyword = String(body.keyword || '').trim();

    if (!secretKeyword) {
      return new Response(JSON.stringify({ ok: false, error: 'APP_KEYWORD が未設定です。' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (inputKeyword !== secretKeyword) {
      return new Response(JSON.stringify({ ok: false, error: 'キーワードが違います。' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'hh_auth=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000',
        'Cache-Control': 'no-store',
      },
    });
  } catch (_error) {
    return new Response(JSON.stringify({ ok: false, error: 'リクエストを処理できませんでした。' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

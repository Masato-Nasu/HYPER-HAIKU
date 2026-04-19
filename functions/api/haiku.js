function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function extractTextFromResponse(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data.output || []) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
      if (content?.type === 'text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function buildSeasonRules() {
  return [
    'まず写真だけを見て、季節の手掛かりを心の中で判定してください。',
    '季節判断に使ってよいのは、写真に写る情報のみです。',
    'たとえば雪・氷・霜、桜や新緑、強い夏光と濃い影、紅葉、枯れ枝、服装、空気感、植物の状態、地面の様子などの視覚情報です。',
    '写真から季節が強く読める場合だけ、季語や春夏秋冬を使ってください。',
    '季節が弱い、または曖昧なら、季節語は使わず、光・色・距離・配置・気配だけで書いてください。',
    '根拠が弱いのに冬・春・夏・秋を決め打ちしないでください。',
    '補助キーワードがあっても、季節については写真の視覚情報を優先してください。',
  ].join(' ');
}

function buildInstructions(mode) {
  if (mode === 'free') {
    return [
      'あなたは写真から短い日本語詩を作る詩人です。',
      '出力は日本語のみ。説明文、タイトル、前置き、引用符は禁止。',
      '自由律で、2行から5行。',
      '静かで余韻のある文体にしてください。',
      '写真に写っているものをそのまま説明しすぎず、しかし写真にない季節や事実を足さないでください。',
      buildSeasonRules(),
    ].join(' ');
  }

  return [
    'あなたは写真から短い日本語俳句を作る詩人です。',
    '出力は日本語のみ。説明文、タイトル、前置き、引用符は禁止。',
    '3行で出力してください。',
    'できるだけ俳句らしい凝縮感を保ち、自然な日本語にしてください。',
    '写真に写っているものをそのまま説明しすぎず、しかし写真にない季節や事実を足さないでください。',
    buildSeasonRules(),
  ].join(' ');
}

function buildUserPrompt(note, mode) {
  const parts = [
    mode === 'free'
      ? 'この写真から、視覚的な気配を拾って自由律の短い詩を作ってください。'
      : 'この写真から、視覚的な気配を拾って日本語の俳句を作ってください。',
    '季節は、写真の視覚情報から確信できる場合だけ使ってください。確信できないなら季節語を避けてください。',
  ];
  if (note) {
    parts.push(`補助キーワード: ${note}`);
    parts.push('ただし、季節については補助キーワードより写真を優先してください。');
  }
  return parts.join('\n');
}

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'OPENAI_API_KEY が未設定です。' }, 500);
    }

    const { imageDataUrl, note, mode } = await context.request.json();
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return jsonResponse({ ok: false, error: '画像データがありません。' }, 400);
    }

    const selectedMode = mode === 'free' ? 'free' : 'haiku';

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        instructions: buildInstructions(selectedMode),
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: buildUserPrompt(note, selectedMode) },
              { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
            ],
          },
        ],
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return jsonResponse({ ok: false, error: data?.error?.message || 'OpenAI API エラーです。' }, upstream.status);
    }

    const poem = extractTextFromResponse(data);
    if (!poem) {
      return jsonResponse({ ok: false, error: 'テキストを取得できませんでした。' }, 500);
    }

    return jsonResponse({ ok: true, mode: selectedMode, poem });
  } catch (_error) {
    return jsonResponse({ ok: false, error: '生成に失敗しました。' }, 500);
  }
}

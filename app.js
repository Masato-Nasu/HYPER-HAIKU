const state = {
  imageDataUrl: '',
  fileName: '',
  poem: '',
  mode: 'haiku',
  cameraStream: null,
  seasonHint: '',
  metadataDateIso: '',
};

const els = {
  lockScreen: document.getElementById('lockScreen'),
  appScreen: document.getElementById('appScreen'),
  keywordInput: document.getElementById('keywordInput'),
  unlockBtn: document.getElementById('unlockBtn'),
  lockError: document.getElementById('lockError'),
  logoutBtn: document.getElementById('logoutBtn'),
  photoInput: document.getElementById('photoInput'),
  pickPhotoBtn: document.getElementById('pickPhotoBtn'),
  openCameraBtn: document.getElementById('openCameraBtn'),
  captureBtn: document.getElementById('captureBtn'),
  stopCameraBtn: document.getElementById('stopCameraBtn'),
  modeHaikuBtn: document.getElementById('modeHaikuBtn'),
  modeFreeBtn: document.getElementById('modeFreeBtn'),
  generateBtn: document.getElementById('generateBtn'),
  saveBtn: document.getElementById('saveBtn'),
  noteInput: document.getElementById('noteInput'),
  statusText: document.getElementById('statusText'),
  photoStage: document.getElementById('photoStage'),
  photoPreview: document.getElementById('photoPreview'),
  cameraPreview: document.getElementById('cameraPreview'),
  poemOverlay: document.getElementById('poemOverlay'),
  modeBadge: document.getElementById('modeBadge'),
  emptyState: document.getElementById('emptyState'),
};

function currentModeLabel() {
  return state.mode === 'free' ? '自由律' : '俳句';
}

function showLock() {
  els.lockScreen.classList.add('show');
  els.appScreen.hidden = true;
  els.keywordInput.value = '';
}

function showApp() {
  els.lockScreen.classList.remove('show');
  els.appScreen.hidden = false;
  els.lockError.textContent = '';
}

function setStatus(text, isError = false) {
  els.statusText.textContent = text || '';
  els.statusText.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function updateModeUi() {
  els.modeHaikuBtn.classList.toggle('active', state.mode === 'haiku');
  els.modeFreeBtn.classList.toggle('active', state.mode === 'free');
  els.modeBadge.textContent = currentModeLabel();
}

function updatePreview() {
  els.photoPreview.src = state.imageDataUrl || '';
  els.poemOverlay.textContent = state.poem || '';
  const hasImage = Boolean(state.imageDataUrl);
  const cameraLive = Boolean(state.cameraStream);
  els.emptyState.style.display = hasImage || cameraLive ? 'none' : 'grid';
}

function setMode(mode) {
  state.mode = mode === 'free' ? 'free' : 'haiku';
  updateModeUi();
}

function normalizePoem(text, mode) {
  const cleaned = String(text || '')
    .replace(/^「|」$/g, '')
    .replace(/^『|』$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/\r/g, '')
    .trim();

  if (!cleaned) return '';

  let lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    lines = cleaned
      .split(/[ 　]+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (mode === 'haiku') {
    return lines.slice(0, 3).join('\n') || cleaned;
  }

  return lines.slice(0, 5).join('\n') || cleaned;
}



function parseExifDateString(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, se] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  return Number.isNaN(date.getTime()) ? null : date;
}

function readAscii(view, start, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(start + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function getExifDateFromIfd(view, tiffStart, ifdOffset, littleEndian) {
  if (!ifdOffset || tiffStart + ifdOffset + 2 > view.byteLength) return null;
  const entryCount = view.getUint16(tiffStart + ifdOffset, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = entryOffset + 8;
    if (![0x9003, 0x9004, 0x0132].includes(tag) || type !== 2 || count < 19) continue;
    const dataOffset = count <= 4
      ? valueOffset
      : tiffStart + view.getUint32(valueOffset, littleEndian);
    if (dataOffset + count > view.byteLength) continue;
    const parsed = parseExifDateString(readAscii(view, dataOffset, count));
    if (parsed) return parsed;
  }
  return null;
}

async function extractMetadataDate(file) {
  if (!file) return null;
  if (/jpe?g$/i.test(file.type) || /\.(jpe?g)$/i.test(file.name || '')) {
    try {
      const buffer = await file.arrayBuffer();
      const view = new DataView(buffer);
      if (view.byteLength > 4 && view.getUint16(0) === 0xffd8) {
        let offset = 2;
        while (offset + 4 <= view.byteLength) {
          const marker = view.getUint16(offset);
          offset += 2;
          if ((marker & 0xff00) !== 0xff00 || marker === 0xffda || marker === 0xffd9) break;
          const size = view.getUint16(offset);
          if (size < 2 || offset + size > view.byteLength) break;
          if (marker === 0xffe1 && readAscii(view, offset + 2, 4) === 'Exif') {
            const tiffStart = offset + 8;
            const littleEndian = view.getUint16(tiffStart) === 0x4949;
            const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
            const primaryDate = getExifDateFromIfd(view, tiffStart, firstIfdOffset, littleEndian);
            if (primaryDate) return primaryDate;
            if (firstIfdOffset) {
              const entryCount = view.getUint16(tiffStart + firstIfdOffset, littleEndian);
              for (let i = 0; i < entryCount; i += 1) {
                const entryOffset = tiffStart + firstIfdOffset + 2 + i * 12;
                if (entryOffset + 12 > view.byteLength) break;
                const tag = view.getUint16(entryOffset, littleEndian);
                if (tag !== 0x8769) continue;
                const exifIfdOffset = view.getUint32(entryOffset + 8, littleEndian);
                const exifDate = getExifDateFromIfd(view, tiffStart, exifIfdOffset, littleEndian);
                if (exifDate) return exifDate;
              }
            }
          }
          offset += size;
        }
      }
    } catch (_error) {
      // ignore and fall back to file metadata
    }
  }

  if (file.lastModified) {
    const fallbackDate = new Date(file.lastModified);
    if (!Number.isNaN(fallbackDate.getTime())) return fallbackDate;
  }
  return null;
}

function getSeasonFromDate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

function shuffleArray(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const KIGO_MEMORY_KEY = 'hyperHaikuKigoHistoryV2';

const KIGO_TABLE = {
  1: ['寒空', '寒月', '霜夜', '霜柱', '氷', '冬晴', '冬日', '寒椿', '枯木', '雪催', '小寒', '大寒', '水仙', '炭火', '炭', '雪見', '枯野', '冬木立', '小春日和', '霜'],
  2: ['梅', '梅一輪', '余寒', '春寒', '薄氷', '雪解け', '猫柳', '水温む', '東風', '春めく', '冴返る', '若布', '椿', '残雪', '雪残る', '春泥', '春愁'],
  3: ['霞', '朧', '啓蟄', '春の水', '柳', '雛', '彼岸', '菜の花', '若草', '木の芽', '山笑う', '淡雪', 'うぐいす', 'すみれ草', 'たんぽぽ', '田打ち', '畑打ち', '土筆', '春の海', '春一番', '春雨', '雀の子', '桜草', '雲雀'],
  4: ['桜', '花冷え', '春雨', '風光る', '春風', '卯月', '木の芽風', '山吹', '藤の花', '燕', '陽炎', '花見', '八十八夜', '茶つみ', '若鮎', '桜貝', '雪解け', '雲雀', '花曇'],
  5: ['若葉', '青葉', '新樹', '薫風', '立夏', '夏めく', '麦秋', '薄暑', '田植え', '青嵐', '苺', '菖蒲', 'あやめ', 'こいのぼり', '衣がえ', '牡丹', 'ほととぎす', '万緑', '紫陽花', '五月雨', '躑躅', '早苗'],
  6: ['梅雨', '青梅雨', '青梅', '夏草', '短夜', '麦の秋', '紫陽花', '五月雨', '蛍', '薄暑', '夏木立', '走り梅雨', '早苗', '菖蒲', '初鰹', '行水', '金魚', '夕焼け', '雷', '梅雨寒'],
  7: ['夕立', '蝉時雨', '青田', '夏雲', '風鈴', '土用', '炎天', '盛夏', '向日葵', '滴り', '雲の峰', '金魚', '蝉', '甲虫', '浴衣', '花火', '青蛙', '大蛍', '片陰'],
  8: ['入道雲', '残暑', '秋近し', '晩夏', '朝顔', '月見草', '夕焼け', '盆', '雷', '稲妻', '流星', '蜩', '青葉', '梅雨明け', '浴衣', '白南風'],
  9: ['新涼', '虫の声', '月', '野分', '秋桜', '鰯雲', '秋灯', '名月', '露', '稲', '夜長', '爽やか', 'いわし雲', '月見', 'きりぎりす', '朝顔', 'こおろぎ', 'すすき', '桐', 'ぶどう', '栗', '残暑', '一葉', '盆踊り', '七夕', '秋の暮', '身に入む', '露寒'],
  10: ['秋晴', '木の実', '鰯雲', '秋桜', '紅葉', '菊', '秋雨', '秋風', '稲刈り', '雁', '実り', '霧', '三日月', '十五夜', '名月', '啄木鳥', '萩', '夜長', '赤とんぼ', '天の川', '鈴虫', '彼岸花', '星月夜', '虫時雨'],
  11: ['落葉', '初霜', '冬近し', '小春', '木枯', '山茶花', '時雨', '枯葉', '冬桜', '冬めく', '酉の市', '焚火', '枯れ木', '枯野', '小春日和', '鴨', '鶴', '白菜', '大根'],
  12: ['枯野', '冬空', '霜', '冬日', '寒椿', '師走', '冬木', '雪吊', '煤払', '年の暮', '寒波', '冬晴', 'つらら', '枯れ尾花', '冬木立', '初雪', '落葉', '除夜の鐘', '冬灯', '寒昴'],
};

const KIGO_FEEL_TABLE = {
  light: ['春の海', '春光', '風光る', '薫風', '若葉', '新樹', '白南風', '秋晴', '名月', '星月夜', '冬日', '冬灯', '寒月'],
  wet: ['春雨', '春泥', '雪解け', '水温む', '梅雨', '青梅雨', '五月雨', '夕立', '時雨', '露', '露寒', '霜', '雪催'],
  life: ['田打ち', '畑打ち', '茶つみ', 'こいのぼり', '衣がえ', '田植え', '行水', '浴衣', '花火', '月見', '運動会', '稲刈り', '焚火', 'みかん', '白菜', '大根'],
  shadow: ['朧', '花冷え', '片陰', '夏木立', '短夜', '夜長', '秋の暮', '霧', '冬木立', '枯野', '霜夜'],
  uncanny: ['余寒', '冴返る', '彼岸', '陽炎', '青嵐', '梅雨寒', '遠雷', '蜩', '野分', '身に入む', '木枯', '寒昴', '隙間風'],
};

const SEASON_KIGO_EXTRAS = {
  春: ['朧', '春灯', '春泥', '山笑う', '鳥雲に', '花冷え', '春宵', '春愁', '水温む', '霞'],
  夏: ['短夜', '青嵐', '白南風', '片陰', '夏座敷', '薄暑', '夕立', '梅雨寒', '青梅雨', '風鈴'],
  秋: ['夜長', '虫時雨', '秋澄む', '身に入む', '露寒', '草の花', '秋思', '水澄む', '月', '野分'],
  冬: ['冬ざれ', '息白し', '寒昴', '霜夜', '冬灯', '寒月', '枯野', '隙間風', '冴ゆ', '雪催'],
};

const ALL_KIGO_TERMS = Array.from(new Set([
  ...Object.values(KIGO_TABLE).flat(),
  ...Object.values(KIGO_FEEL_TABLE).flat(),
  ...Object.values(SEASON_KIGO_EXTRAS).flat(),
])).sort((a, b) => b.length - a.length);

function uniqueTerms(items) {
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
}

function getKigoHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KIGO_MEMORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch (_error) {
    return [];
  }
}

function saveKigoHistory(history) {
  try {
    localStorage.setItem(KIGO_MEMORY_KEY, JSON.stringify(history.slice(-24)));
  } catch (_error) {
    // localStorage can be unavailable in private mode.
  }
}

function weightedShuffleKigo(items) {
  const history = getKigoHistory();
  return uniqueTerms(items)
    .map((term, index) => {
      const lastIndex = history.lastIndexOf(term);
      const age = lastIndex >= 0 ? history.length - lastIndex : Infinity;
      let weight = 1;
      if (age <= 3) weight *= 0.08;
      else if (age <= 8) weight *= 0.22;
      else if (age <= 16) weight *= 0.48;
      if (/花曇/.test(term)) weight *= 0.18;
      return { term, score: Math.random() * weight - index * 0.00001 };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.term);
}

function getKigoCandidateGroupsFromDate(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const month = date.getMonth() + 1;
  const season = getSeasonFromDate(date);
  const prev = month === 1 ? 12 : month - 1;
  const next = month === 12 ? 1 : month + 1;
  const corePool = [
    ...(KIGO_TABLE[month] || []),
    ...(KIGO_TABLE[prev] || []).slice(0, 6),
    ...(KIGO_TABLE[next] || []).slice(0, 6),
    ...(SEASON_KIGO_EXTRAS[season] || []),
  ];

  return {
    season,
    core: weightedShuffleKigo(corePool).slice(0, 10),
    light: weightedShuffleKigo([...(KIGO_FEEL_TABLE.light || []), ...corePool]).slice(0, 5),
    wet: weightedShuffleKigo([...(KIGO_FEEL_TABLE.wet || []), ...corePool]).slice(0, 5),
    life: weightedShuffleKigo([...(KIGO_FEEL_TABLE.life || []), ...corePool]).slice(0, 5),
    shadow: weightedShuffleKigo([...(KIGO_FEEL_TABLE.shadow || []), ...corePool]).slice(0, 5),
    uncanny: weightedShuffleKigo([...(KIGO_FEEL_TABLE.uncanny || []), ...corePool]).slice(0, 4),
  };
}

function rememberKigoFromPoem(poem) {
  const text = String(poem || '').replace(/[\s　]/g, '');
  if (!text) return;
  const hit = ALL_KIGO_TERMS.find((term) => term.length >= 2 && text.includes(term.replace(/[\s　]/g, '')));
  if (!hit) return;
  const history = getKigoHistory().filter((term) => term !== hit);
  history.push(hit);
  saveKigoHistory(history);
}

function getKigoCandidatesFromDate(date) {
  const groups = getKigoCandidateGroupsFromDate(date);
  if (!groups) return [];
  return uniqueTerms([
    ...groups.core,
    ...groups.light,
    ...groups.wet,
    ...groups.life,
    ...groups.shadow,
    ...groups.uncanny,
  ]);
}


function formatMetadataHint() {
  const groups = getKigoCandidateGroupsFromDate(state.metadataDateIso ? new Date(state.metadataDateIso) : null);
  if (!groups) return '';

  const labels = [
    ['季節', groups.core.slice(0, 8)],
    ['光', groups.light.slice(0, 4)],
    ['湿度', groups.wet.slice(0, 4)],
    ['生活', groups.life.slice(0, 4)],
    ['影', groups.shadow.slice(0, 4)],
    ['違和感', groups.uncanny.slice(0, 3)],
  ];
  const parts = labels
    .filter(([, items]) => items.length)
    .map(([label, items]) => `${label}: ${items.join('、')}`);
  const recent = getKigoHistory().slice(-8).reverse();
  const recentHint = recent.length ? `直近で使った季語（${recent.join('、')}）はなるべく避けてください。` : '';

  return `撮影メタ情報からの季語候補（${groups.season}）: ${parts.join(' / ')}。写真の視覚情報を最優先し、光・湿度・生活感・影・少しの違和感に合う季語を一つだけ選ぶか、近い季語へ言い換えてください。${recentHint}「花曇」「花曇り」は本当に必要な場合以外は使わないでください。季節名は直接書かないこと。`;
}

async function readFileAsDataUrl(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });
  return shrinkImage(dataUrl, 1800, 1800, 0.92);
}

async function shrinkImage(dataUrl, maxW, maxH, quality) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('画像を開けませんでした。'));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

async function checkSession() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json();
    if (data.ok) {
      showApp();
    } else {
      showLock();
    }
  } catch (_error) {
    showLock();
  }
}

async function unlock() {
  els.lockError.textContent = '';
  const keyword = els.keywordInput.value.trim();
  if (!keyword) {
    els.lockError.textContent = '起動キーワードを入力してください。';
    return;
  }

  els.unlockBtn.disabled = true;
  els.unlockBtn.textContent = '確認中...';
  try {
    const res = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ keyword }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      els.lockError.textContent = data.error || '起動キーワードが違います。';
      return;
    }
    showApp();
  } catch (_error) {
    els.lockError.textContent = '通信に失敗しました。';
  } finally {
    els.unlockBtn.disabled = false;
    els.unlockBtn.textContent = '起動する';
  }
}

async function logout() {
  await stopCamera();
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  showLock();
}

function choosePhoto() {
  els.photoInput.click();
}

async function onPhotoChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    await stopCamera();
    setStatus('画像を読み込んでいます。');
    const metadataDate = await extractMetadataDate(file);
    state.metadataDateIso = metadataDate ? metadataDate.toISOString() : '';
    state.seasonHint = getSeasonFromDate(metadataDate);
    state.imageDataUrl = await readFileAsDataUrl(file);
    state.fileName = file.name;
    state.poem = '';
    updatePreview();
    setStatus(`${currentModeLabel()}を生成できます。`);
  } catch (error) {
    setStatus(error.message || '画像の読み込みに失敗しました。', true);
  }
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('この端末ではカメラ起動に対応していません。', true);
    return;
  }

  try {
    await stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });

    state.cameraStream = stream;
    els.cameraPreview.srcObject = stream;
    els.photoStage.classList.add('camera-live');
    els.captureBtn.disabled = false;
    els.stopCameraBtn.disabled = false;
    state.poem = '';
    updatePreview();
    setStatus('カメラ起動中です。撮影してください。');
  } catch (error) {
    setStatus('カメラを起動できませんでした。ブラウザ権限を確認してください。', true);
  }
}

async function stopCamera() {
  if (state.cameraStream) {
    for (const track of state.cameraStream.getTracks()) {
      track.stop();
    }
    state.cameraStream = null;
  }
  els.cameraPreview.srcObject = null;
  els.photoStage.classList.remove('camera-live');
  els.captureBtn.disabled = true;
  els.stopCameraBtn.disabled = true;
  updatePreview();
}

async function capturePhoto() {
  if (!state.cameraStream) return;

  try {
    const video = els.cameraPreview;
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('カメラ映像がまだ準備できていません。');
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    state.imageDataUrl = await shrinkImage(canvas.toDataURL('image/jpeg', 0.95), 1800, 1800, 0.92);
    const captureDate = new Date();
    state.metadataDateIso = captureDate.toISOString();
    state.seasonHint = getSeasonFromDate(captureDate);
    state.fileName = `camera-${Date.now()}.jpg`;
    state.poem = '';
    await stopCamera();
    updatePreview();
    setStatus('撮影しました。生成できます。');
  } catch (error) {
    setStatus(error.message || '撮影に失敗しました。', true);
  }
}

async function generatePoem() {
  if (!state.imageDataUrl) {
    setStatus('先に写真を選択するか、カメラで撮影してください。', true);
    return;
  }

  els.generateBtn.disabled = true;
  setStatus(`${currentModeLabel()}を生成しています。少しお待ちください。`);

  try {
    const res = await fetch('/api/haiku', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        imageDataUrl: state.imageDataUrl,
        note: [els.noteInput.value.trim(), formatMetadataHint()].filter(Boolean).join(' '),
        mode: state.mode,
        metadataDateIso: state.metadataDateIso,
        metadataSeason: state.seasonHint,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || '生成に失敗しました。');
    }

    state.poem = normalizePoem(data.poem || data.haiku, state.mode);
    rememberKigoFromPoem(state.poem);
    updatePreview();
    setStatus(`${currentModeLabel()}を生成しました。JPEG保存できます。`);
  } catch (error) {
    setStatus(error.message || '生成に失敗しました。', true);
  } finally {
    els.generateBtn.disabled = false;
  }
}

async function waitForImageLoad(img) {
  if (img.complete && img.naturalWidth > 0) return;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('画像の描画に失敗しました。'));
  });
}

async function saveJpeg() {
  if (!state.imageDataUrl) {
    setStatus('写真がありません。', true);
    return;
  }

  try {
    await waitForImageLoad(els.photoPreview);
    const img = els.photoPreview;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, 0, 0, w, h);

    const brandFontSize = Math.max(22, Math.round(w * 0.024));
    const brandX = Math.round(w * 0.03);
    const brandY = Math.round(w * 0.03);

    ctx.save();
    ctx.font = `600 ${brandFontSize}px "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = Math.round(brandFontSize * 0.5);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(brandFontSize * 0.08);
    ctx.fillText('HYPER-HAIKU', brandX, brandY);
    ctx.restore();

    if (state.poem) {
      const lines = state.poem.split('\n').filter(Boolean);
      const fontSize = Math.max(34, Math.round(w * 0.045));
      const paddingX = Math.round(w * 0.04);
      const paddingY = Math.round(w * 0.035);
      const lineHeight = Math.round(fontSize * 1.55);
      const blockHeight = lineHeight * lines.length;
      const startY = h - blockHeight - paddingY - Math.round(h * 0.03);

      ctx.save();
      ctx.font = `${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.08));
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.03));

      let y = startY;
      for (const line of lines) {
        ctx.fillText(line, paddingX, y);
        y += lineHeight;
      }
      ctx.restore();
    }

    const url = canvas.toDataURL('image/jpeg', 0.92);
    const a = document.createElement('a');
    a.href = url;
    const base = (state.fileName || 'hyper-haiku').replace(/\.[^.]+$/, '');
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    a.download = `${base}-${state.mode === 'free' ? 'freeverse' : 'haiku'}-${stamp}.jpg`;
    a.click();
    setStatus('JPEGを書き出しました。');
  } catch (error) {
    setStatus(error.message || 'JPEG保存に失敗しました。', true);
  }
}

els.unlockBtn.addEventListener('click', unlock);
els.keywordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') unlock();
});
els.logoutBtn.addEventListener('click', logout);
els.pickPhotoBtn.addEventListener('click', choosePhoto);
els.photoInput.addEventListener('change', onPhotoChange);
els.openCameraBtn.addEventListener('click', openCamera);
els.captureBtn.addEventListener('click', capturePhoto);
els.stopCameraBtn.addEventListener('click', stopCamera);
els.modeHaikuBtn.addEventListener('click', () => setMode('haiku'));
els.modeFreeBtn.addEventListener('click', () => setMode('free'));
els.generateBtn.addEventListener('click', generatePoem);
els.saveBtn.addEventListener('click', saveJpeg);

window.addEventListener('beforeunload', () => {
  if (state.cameraStream) {
    for (const track of state.cameraStream.getTracks()) {
      track.stop();
    }
  }
});

checkSession();
updateModeUi();
updatePreview();

const state = {
  imageDataUrl: '',
  fileName: '',
  poem: '',
  mode: 'haiku',
  cameraStream: null,
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
        note: els.noteInput.value.trim(),
        mode: state.mode,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || '生成に失敗しました。');
    }

    state.poem = normalizePoem(data.poem || data.haiku, state.mode);
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
      const boxHeight = paddingY * 2 + lineHeight * lines.length;
      const boxY = h - boxHeight - Math.round(h * 0.03);

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, boxY, w, boxHeight);
      ctx.restore();

      ctx.save();
      ctx.font = `${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.88)';
      ctx.shadowBlur = Math.round(fontSize * 0.35);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(fontSize * 0.08);

      let y = boxY + paddingY;
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
    a.download = `${base}-${state.mode === 'free' ? 'freeverse' : 'haiku'}.jpg`;
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

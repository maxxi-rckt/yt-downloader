const $ = (s) => document.querySelector(s);

const VIDEO_Q = [
  { q: '2160', label: '4K', sub: '2160p' },
  { q: '1440', label: '2K', sub: '1440p' },
  { q: '1080', label: 'Full HD', sub: '1080p' },
  { q: '720', label: 'HD', sub: '720p' },
  { q: '480', label: 'SD', sub: '480p' },
  { q: '360', label: 'Ligero', sub: '360p' },
];
const AUDIO_Q = [
  { q: 'mp3-320', label: 'MP3', sub: '320 kbps' },
  { q: 'mp3-128', label: 'MP3', sub: '128 kbps' },
  { q: 'm4a', label: 'M4A', sub: 'Original' },
];

const state = {
  settings: null,
  video: null,      // {url, id, title, channel, thumbnail, duration, heights}
  kind: 'video',
  quality: null,
  defaultDir: '',
};

// ---------- utils ----------
function send(cmd, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ cmd, ...extra }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      res?.ok ? resolve(res.data) : reject(new Error(res?.error || 'Error desconocido'));
    });
  });
}

function parseYouTube(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host === 'youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else id = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/)?.[2];
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return { id, url: `https://www.youtube.com/watch?v=${id}` };
  } catch { return null; }
}

function fmtTime(s) {
  if (s == null || !isFinite(s)) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : m;
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

function fmtBytes(b) {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`;
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"/></svg>',
};

// ---------- navigation ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab.dataset.view));
  });
});

// ---------- picker ----------
function showVideo(v) {
  state.video = v;
  $('#empty').hidden = true;
  $('#picker').hidden = false;
  const img = $('#thumb');
  img.classList.remove('loaded');
  img.onload = () => img.classList.add('loaded');
  img.src = v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  $('#title').textContent = v.title || '';
  $('#title').classList.toggle('skeleton', !v.title);
  $('#channel').textContent = v.channel || 'Cargando información…';
  $('#channel').classList.toggle('skeleton', !v.channel);
  $('#duration').hidden = !v.duration;
  $('#duration').textContent = fmtTime(v.duration);
  renderChips();
}

function availableVideo() {
  const hs = state.video?.heights;
  if (!hs) return null; // still loading
  if (!hs.length) return VIDEO_Q.filter((o) => +o.q <= 1080);
  const max = Math.max(...hs);
  // keep a tier when the video actually reaches it (with some slack for odd sizes like 1072p)
  const list = VIDEO_Q.filter((o) => +o.q <= max * 1.05 && hs.some((h) => h >= +o.q * 0.85 && h <= +o.q));
  return list.length ? list : [VIDEO_Q[VIDEO_Q.length - 1]];
}

function renderChips() {
  const box = $('#chips');
  const isVideo = state.kind === 'video';
  $('#kind').classList.toggle('audio', !isVideo);
  document.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', s.dataset.kind === state.kind));

  const opts = isVideo ? availableVideo() : AUDIO_Q;
  if (!opts) {
    box.innerHTML = '<div class="chip skeleton"></div>'.repeat(3);
    $('#download').disabled = true;
    return;
  }
  const def = isVideo ? state.settings.defQuality : state.settings.defAudio;
  if (!opts.some((o) => o.q === state.quality)) {
    // default, or the best option below the default
    state.quality = (opts.find((o) => o.q === def) || (isVideo ? opts.find((o) => +o.q <= +def) : null) || opts[0]).q;
  }
  box.innerHTML = '';
  opts.forEach((o, i) => {
    const chip = el(`<button class="chip${o.q === state.quality ? ' active' : ''}">
      ${isVideo && i === 0 ? '<span class="tag">MÁX</span>' : ''}
      <b>${o.label}</b><small>${o.sub}</small></button>`);
    chip.onclick = () => { state.quality = o.q; renderChips(); };
    box.append(chip);
  });
  $('#download').disabled = !!state.helperDown;
}

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', () => {
    if (state.kind === seg.dataset.kind) return;
    state.kind = seg.dataset.kind;
    state.quality = null;
    renderChips();
  });
});

function currentRequest() {
  const v = state.video;
  const base = { url: v.url, title: v.title, thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` };
  if (state.kind === 'video') {
    return { ...base, kind: 'video', quality: state.quality, label: `MP4 ${state.quality}p` };
  }
  const [format, kbps] = state.quality.split('-');
  return { ...base, kind: 'audio', format, quality: kbps, label: format === 'm4a' ? 'M4A' : `MP3 ${kbps}` };
}

$('#download').addEventListener('click', async () => {
  const btn = $('#download');
  btn.disabled = true;
  try {
    await send('download', { req: currentRequest() });
    $('#download-label').textContent = '¡Añadido!';
  } catch (e) {
    showPickerError(e.message);
  }
  setTimeout(() => { $('#download-label').textContent = 'Descargar'; btn.disabled = false; }, 1200);
});

function showPickerError(msg) {
  const p = $('#picker-error');
  p.textContent = msg;
  p.hidden = !msg;
}

async function loadInfo(v) {
  showVideo(v);
  try {
    const { info } = await send('info', { url: v.url });
    if (state.video?.url !== v.url) return;
    if (info.isLive) showPickerError('Los directos en curso no se pueden descargar todavía.');
    showVideo({ ...v, ...info, url: v.url });
  } catch (e) {
    if (state.video?.url !== v.url) return;
    showVideo({ ...v, channel: v.channel || ' ', heights: v.heights || [] });
    if (!state.helperDown) showPickerError(e.message);
  }
}

$('#url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const parsed = parseYouTube($('#url-input').value.trim());
  if (!parsed) return toast('Ese enlace no parece de YouTube');
  loadInfo(parsed);
});

// ---------- jobs ----------
const jobs = new Map();

function stageText(j) {
  if (j.status === 'queued') return 'En cola';
  if (j.status === 'starting') return 'Preparando…';
  if (j.status === 'done') return '<span class="ok">✓ Completado</span>';
  if (j.status === 'cancelled') return 'Cancelado';
  if (j.status === 'error') return `<span class="bad" title="${esc(j.error)}">${esc(j.error)}</span>`;
  if (j.processing) return 'Procesando…';
  const parts = [];
  if (j.kind === 'video' && j.stage > 1) parts.push('Audio');
  if (j.pct != null) parts.push(`${Math.floor(j.pct)}%`);
  if (j.speed) parts.push(`${fmtBytes(j.speed)}/s`);
  if (j.eta) parts.push(fmtTime(j.eta));
  return parts.join(' · ');
}

function jobItem(j, history = false) {
  const active = ['queued', 'starting', 'downloading'].includes(j.status);
  const indet = j.status === 'starting' || j.processing || (j.status === 'downloading' && j.pct == null);
  const li = el(`<li class="job">
    <img src="${esc(j.thumbnail)}" alt="">
    <div class="job-body">
      <div class="job-title" title="${esc(j.title)}">${esc(j.title)}</div>
      <div class="job-meta"><span class="pill">${esc(j.label)}</span>${history ? (j.status === 'done' ? new Date(j.at).toLocaleDateString() : stageText(j)) : stageText(j)}</div>
      ${active ? `<div class="bar${indet ? ' indeterminate' : ''}"><i style="width:${indet ? '' : (j.pct || 0) + '%'}"></i></div>` : ''}
    </div>
    <div class="job-actions"></div>
  </li>`);
  const actions = li.querySelector('.job-actions');
  if (active) {
    const b = el(`<button class="icon-btn" title="Cancelar">${ICON.x}</button>`);
    b.onclick = () => send('cancel', { id: j.id });
    actions.append(b);
  } else if (j.status === 'done' && j.path) {
    const b = el(`<button class="icon-btn" title="Mostrar en carpeta">${ICON.folder}</button>`);
    b.onclick = () => send('open', { path: j.path });
    actions.append(b);
  } else if (j.status === 'error' && history) {
    const b = el(`<button class="icon-btn" title="Reintentar">${ICON.retry}</button>`);
    b.onclick = () => {
      const [kind, rest] = j.label.startsWith('MP4') ? ['video', j.label.slice(4, -1)] : ['audio', j.label];
      const req = { url: j.url, title: j.title, thumbnail: j.thumbnail, label: j.label, kind };
      if (kind === 'video') req.quality = rest;
      else if (rest === 'M4A') req.format = 'm4a';
      else Object.assign(req, { format: 'mp3', quality: rest.split(' ')[1] });
      send('download', { req }).then(() => toast('Reintentando…'));
    };
    actions.append(b);
  }
  return li;
}

function renderJobs() {
  const list = [...jobs.values()].sort((a, b) => b.created - a.created);
  $('#jobs-section').hidden = !list.length;
  $('#jobs').replaceChildren(...list.map((j) => jobItem(j)));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.event === 'job') jobs.set(msg.job.id, msg.job);
  else if (msg.event === 'jobs') { jobs.clear(); msg.jobs.forEach((j) => jobs.set(j.id, j)); }
  else return;
  renderJobs();
});

// ---------- history ----------
async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('#history').replaceChildren(...history.map((h) => jobItem(h, true)));
  $('#history-empty').hidden = history.length > 0;
  $('#clear-history').hidden = !history.length;
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.history) renderHistory(); });
$('#clear-history').onclick = () => chrome.storage.local.set({ history: [] });
$('#open-folder').onclick = () => send('open', { dir: state.settings.outDir || state.defaultDir }).catch((e) => toast(e.message));

// ---------- settings ----------
function saveSetting(key, value) {
  state.settings[key] = value;
  chrome.storage.sync.set({ [key]: value });
  toast('Guardado');
}

function renderSettings() {
  const s = state.settings;
  const dir = $('#out-dir');
  if (document.activeElement !== dir) dir.value = s.outDir || '';
  dir.placeholder = state.defaultDir || 'Descargas/YouTube';
  dir.title = s.outDir || state.defaultDir || '';
  $('#def-kind').value = s.defKind;
  $('#def-quality').value = s.defQuality;
  $('#def-audio').value = s.defAudio;
  $('#show-button').checked = s.showButton;
  $('#notify').checked = s.notify;
}

// Typed path: also the fallback when the system folder picker isn't available (e.g. locked-down Windows).
$('#out-dir').onchange = (e) => { saveSetting('outDir', e.target.value.trim()); renderSettings(); };
$('#def-kind').onchange = (e) => saveSetting('defKind', e.target.value);
$('#def-quality').onchange = (e) => saveSetting('defQuality', e.target.value);
$('#def-audio').onchange = (e) => saveSetting('defAudio', e.target.value);
$('#show-button').onchange = (e) => saveSetting('showButton', e.target.checked);
$('#notify').onchange = (e) => saveSetting('notify', e.target.checked);

$('#pick-folder').onclick = async () => {
  toast('Elige la carpeta en la ventana que se abre');
  try {
    const { path } = await send('pickFolder');
    if (path) { saveSetting('outDir', path); renderSettings(); }
  } catch (e) { toast(e.message); }
};

$('#update').onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Actualizando…';
  try {
    const { output } = await send('update');
    toast(output || 'Actualizado');
    checkHelper();
  } catch (err) { toast(err.message); }
  btn.disabled = false;
  btn.textContent = 'Actualizar yt-dlp';
};

// ---------- helper status ----------
async function checkHelper() {
  try {
    const pong = await send('ping');
    state.helperDown = !pong.ytdlp;
    state.defaultDir = pong.defaultDir;
    $('#engine').textContent = pong.ytdlp
      ? `yt-dlp ${pong.ytdlp} · ffmpeg ${pong.ffmpeg ? '✓' : '✗ (falta)'}`
      : 'yt-dlp no encontrado';
    $('#helper-missing').hidden = !!pong.ytdlp;
    $('#helper-error').textContent = pong.ytdlp ? '' : 'El helper funciona, pero no encuentra yt-dlp.';
  } catch (e) {
    state.helperDown = true;
    $('#engine').textContent = 'Helper no conectado';
    $('#helper-missing').hidden = false;
    $('#helper-error').textContent = e.message;
  }
  renderSettings();
  if (state.video) renderChips();
  return !state.helperDown;
}

async function setupInstallHelp() {
  const { os } = await chrome.runtime.getPlatformInfo();
  const win = os === 'win';
  $('#install-win').hidden = !win;
  $('#install-unix').hidden = win;
  $('#install-cmd').hidden = win;
  $('#copy-cmd').hidden = win;
  $('#install-cmd').textContent = CONFIG.INSTALL_CMD;
  $('#install-link').href = CONFIG.SITE_URL + '#descargar';
}

// ---------- Ko-fi ----------
document.querySelectorAll('.kofi-link').forEach((a) => (a.href = CONFIG.KOFI_URL));
$('#site-link').href = CONFIG.SITE_URL;

async function maybeShowKofi() {
  const { doneCount = 0, kofiDismissed = false } = await chrome.storage.local.get(['doneCount', 'kofiDismissed']);
  $('#kofi-card').hidden = kofiDismissed || doneCount < CONFIG.KOFI_AFTER_DOWNLOADS;
}
$('#kofi-dismiss').onclick = () => { chrome.storage.local.set({ kofiDismissed: true }); $('#kofi-card').hidden = true; };
$('#kofi-card .kofi-link').addEventListener('click', () => chrome.storage.local.set({ kofiDismissed: true }));

$('#copy-cmd').onclick = () => navigator.clipboard.writeText($('#install-cmd').textContent).then(() => toast('Copiado'));
$('#retry').onclick = async () => {
  if ((await checkHelper()) && state.video) { showPickerError(''); loadInfo(state.video); }
};

// ---------- boot ----------
(async function init() {
  state.settings = await send('settings');
  state.kind = state.settings.defKind;
  renderSettings();
  renderHistory();
  setupInstallHelp();
  maybeShowKofi();
  (await send('jobs')).forEach((j) => jobs.set(j.id, j));
  renderJobs();

  const helperOk = checkHelper();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = tab?.url && parseYouTube(tab.url);
  if (!parsed) {
    $('#empty').hidden = false;
    $('#url-input').focus();
    return;
  }
  const title = tab.title?.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube( Music)?$/, '');
  if (await helperOk) loadInfo({ ...parsed, title });
  else showVideo({ ...parsed, title, channel: ' ', heights: [] });
})();

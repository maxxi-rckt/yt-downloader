// Service worker: owns the connection to the native helper, the download queue and history.
importScripts('config.js');

const HOST = 'com.mchy.ytdl';
const MAX_PARALLEL = 2;
const HISTORY_MAX = 20;

const DEFAULT_SETTINGS = {
  outDir: '',
  defKind: 'video',
  defQuality: '1080',
  defAudio: 'mp3-320',
  showButton: true,
  notify: true,
};

let port = null;
let ridSeq = 0;
const pending = new Map(); // rid -> {resolve, reject, timer}
const jobs = new Map();    // id -> job
const infoCache = new Map();

// ---------- native port ----------
function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || 'El helper se ha cerrado';
    port = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(err)); }
    pending.clear();
    for (const job of jobs.values()) {
      if (job.status === 'downloading') finish(job, { status: 'error', error: 'Se perdió la conexión con el helper' });
    }
  });
  return port;
}

function request(msg, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const rid = ++ridSeq;
    const timer = setTimeout(() => { pending.delete(rid); reject(new Error('Tiempo de espera agotado')); }, timeoutMs);
    pending.set(rid, { resolve, reject, timer });
    try { connect().postMessage({ ...msg, rid }); }
    catch (e) { clearTimeout(timer); pending.delete(rid); reject(e); }
  });
}

function onHostMessage(msg) {
  if (msg.rid && pending.has(msg.rid)) {
    const p = pending.get(msg.rid);
    pending.delete(msg.rid);
    clearTimeout(p.timer);
    return msg.type === 'error' ? p.reject(new Error(msg.msg)) : p.resolve(msg);
  }
  const job = jobs.get(msg.id);
  if (!job) return;
  switch (msg.type) {
    case 'started': job.status = 'downloading'; break;
    case 'progress':
      Object.assign(job, {
        stage: msg.stage ?? job.stage,
        pct: msg.pct ?? job.pct,
        speed: msg.speed ?? null,
        eta: msg.eta ?? null,
        processing: !!msg.processing,
      });
      break;
    case 'done': return finish(job, { status: 'done', path: msg.path, pct: 100 });
    case 'cancelled': return finish(job, { status: 'cancelled' });
    case 'error': return finish(job, { status: 'error', error: msg.msg });
  }
  broadcast(job);
}

// ---------- jobs ----------
async function settings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
}

async function enqueue(req, tabId) {
  const id = crypto.randomUUID();
  const job = {
    id, tabId,
    url: req.url, title: req.title || 'Vídeo de YouTube', thumbnail: req.thumbnail || '',
    kind: req.kind, quality: req.quality, format: req.format, label: req.label,
    status: 'queued', pct: 0, stage: 0, created: Date.now(),
  };
  jobs.set(id, job);
  broadcast(job);
  pump();
  return job;
}

async function pump() {
  const running = [...jobs.values()].filter((j) => j.status === 'downloading' || j.status === 'starting').length;
  const next = [...jobs.values()].find((j) => j.status === 'queued');
  if (!next || running >= MAX_PARALLEL) return;
  next.status = 'starting';
  broadcast(next);
  const { outDir } = await settings();
  try {
    connect().postMessage({
      type: 'download', id: next.id, url: next.url,
      kind: next.kind, quality: next.quality, format: next.format, outDir: outDir || undefined,
    });
  } catch (e) {
    finish(next, { status: 'error', error: e.message });
  }
  pump();
}

async function finish(job, patch) {
  Object.assign(job, patch, { speed: null, eta: null, processing: false });
  broadcast(job);
  if (job.status === 'done' || job.status === 'error') {
    const { history = [], doneCount = 0 } = await chrome.storage.local.get(['history', 'doneCount']);
    if (job.status === 'done') chrome.storage.local.set({ doneCount: doneCount + 1 });
    const entry ={ id: job.id, url: job.url, title: job.title, thumbnail: job.thumbnail, label: job.label, status: job.status, path: job.path || null, error: job.error || null, at: Date.now() };
    await chrome.storage.local.set({ history: [entry, ...history].slice(0, HISTORY_MAX) });
    if ((await settings()).notify) {
      chrome.notifications.create(job.id, {
        type: 'basic', iconUrl: 'icons/128.png',
        title: job.status === 'done' ? 'Descarga completada' : 'Error en la descarga',
        message: job.status === 'done' ? job.title : `${job.title}\n${job.error}`,
      });
    }
  }
  // Finished jobs linger briefly so the UI can show the result, then leave the active list.
  setTimeout(() => { jobs.delete(job.id); broadcastAll(); }, job.status === 'done' ? 8000 : 15000);
  pump();
}

function badge() {
  const active = [...jobs.values()].filter((j) => ['queued', 'starting', 'downloading'].includes(j.status)).length;
  chrome.action.setBadgeBackgroundColor({ color: '#ff3b4e' });
  chrome.action.setBadgeText({ text: active ? String(active) : '' });
}

function broadcast(job) {
  badge();
  chrome.runtime.sendMessage({ event: 'job', job }).catch(() => {});
  if (job.tabId) chrome.tabs.sendMessage(job.tabId, { event: 'job', job }).catch(() => {});
}

function broadcastAll() {
  badge();
  chrome.runtime.sendMessage({ event: 'jobs', jobs: [...jobs.values()] }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.storage.local.get('history').then(({ history = [] }) => {
    const h = history.find((e) => e.id === id);
    if (h?.path) request({ type: 'open', path: h.path }, 2000).catch(() => {});
  });
});

// ---------- API for popup / content script ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  const handlers = {
    ping: () => request({ type: 'ping' }, 8000),
    info: async () => {
      if (infoCache.has(msg.url)) return { info: infoCache.get(msg.url) };
      const res = await request({ type: 'info', url: msg.url });
      infoCache.set(msg.url, res.info);
      return res;
    },
    download: () => enqueue(msg.req, tabId),
    cancel: () => {
      const job = jobs.get(msg.id);
      if (job?.status === 'queued') return finish(job, { status: 'cancelled' });
      port?.postMessage({ type: 'cancel', id: msg.id });
    },
    open: () => { connect().postMessage({ type: 'open', path: msg.path, dir: msg.dir }); },
    pickFolder: () => request({ type: 'pickFolder' }, 10 * 60000),
    update: () => request({ type: 'update' }, 120000),
    jobs: () => [...jobs.values()],
    settings: () => settings(),
  };
  const fn = handlers[msg.cmd];
  if (!fn) return false;
  Promise.resolve()
    .then(fn)
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message }));
  return true;
});

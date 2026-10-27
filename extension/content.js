// Adds a "Descargar" pill next to YouTube's Like/Share buttons (or a floating one on Shorts).
(() => {
  const ID = 'ytdl-pill';
  let settings = null;
  let currentJob = null; // last job started from this page for the current video

  const ICON_DL = '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>';
  const ICON_CARET = '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>';
  const ICON_OK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';

  function send(cmd, extra = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ cmd, ...extra }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        res?.ok ? resolve(res.data) : reject(new Error(res?.error));
      });
    });
  }

  function videoId() {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    return u.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1] || null;
  }

  function videoTitle() {
    const h = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata');
    return (h?.textContent || document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '')).trim();
  }

  function presets() {
    const q = settings.defQuality;
    const [af, ak] = settings.defAudio.split('-');
    return {
      video: { kind: 'video', quality: q, label: `MP4 ${q}p` },
      audio: af === 'm4a'
        ? { kind: 'audio', format: 'm4a', label: 'M4A' }
        : { kind: 'audio', format: 'mp3', quality: ak, label: `MP3 ${ak}` },
    };
  }

  const MENU = [
    { label: 'Vídeo · mejor calidad', req: { kind: 'video', quality: '2160', label: 'MP4 2160p' } },
    { label: 'Vídeo · 1080p', req: { kind: 'video', quality: '1080', label: 'MP4 1080p' } },
    { label: 'Vídeo · 720p', req: { kind: 'video', quality: '720', label: 'MP4 720p' } },
    { sep: true },
    { label: 'Audio · MP3 320 kbps', req: { kind: 'audio', format: 'mp3', quality: '320', label: 'MP3 320' } },
    { label: 'Audio · MP3 128 kbps', req: { kind: 'audio', format: 'mp3', quality: '128', label: 'MP3 128' } },
    { label: 'Audio · M4A original', req: { kind: 'audio', format: 'm4a', label: 'M4A' } },
  ];

  async function start(req) {
    const id = videoId();
    if (!id) return;
    const pill = document.getElementById(ID);
    pill?.classList.add('ytdl-busy');
    setLabel('Preparando…');
    try {
      currentJob = await send('download', {
        req: {
          ...req, url: `https://www.youtube.com/watch?v=${id}`,
          title: videoTitle(), thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        },
      });
      currentJob.videoId = id;
    } catch (e) {
      showError(e.message.includes('native') || e.message.includes('helper') ? 'Instala el helper' : 'Error');
    }
  }

  function setLabel(text, pct) {
    const pill = document.getElementById(ID);
    if (!pill) return;
    pill.querySelector('.ytdl-label').textContent = text;
    pill.style.setProperty('--ytdl-pct', pct == null ? '0%' : pct + '%');
  }

  function showError(text) {
    const pill = document.getElementById(ID);
    if (!pill) return;
    pill.classList.remove('ytdl-busy', 'ytdl-done');
    pill.classList.add('ytdl-error');
    setLabel(text);
    setTimeout(() => { pill.classList.remove('ytdl-error'); setLabel('Descargar'); }, 3500);
  }

  function resetPill() {
    const pill = document.getElementById(ID);
    if (!pill) return;
    pill.classList.remove('ytdl-busy', 'ytdl-done', 'ytdl-error');
    pill.querySelector('.ytdl-main .ytdl-icon').innerHTML = ICON_DL;
    setLabel('Descargar');
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.event !== 'job' || !currentJob || msg.job.id !== currentJob.id) return;
    const j = msg.job;
    currentJob = { ...j, videoId: currentJob.videoId };
    if (currentJob.videoId !== videoId()) return;
    const pill = document.getElementById(ID);
    if (!pill) return;
    if (j.status === 'done') {
      pill.classList.remove('ytdl-busy');
      pill.classList.add('ytdl-done');
      pill.querySelector('.ytdl-main .ytdl-icon').innerHTML = ICON_OK;
      setLabel('Listo · abrir');
    } else if (j.status === 'error') {
      showError('Error');
      pill.title = j.error || '';
    } else if (j.status === 'cancelled') {
      resetPill();
    } else if (j.status === 'queued') {
      setLabel('En cola');
    } else if (j.processing) {
      setLabel('Procesando…', 100);
    } else if (j.pct != null) {
      const label = j.kind === 'video' && j.stage > 1 ? 'Audio ' : '';
      setLabel(`${label}${Math.floor(j.pct)}%`, j.pct);
    }
  });

  // ---------- DOM ----------
  function build() {
    const pill = document.createElement('div');
    pill.id = ID;
    pill.innerHTML = `
      <button class="ytdl-main" title="Descargar (formato por defecto)">
        <span class="ytdl-icon">${ICON_DL}</span><span class="ytdl-label">Descargar</span>
      </button>
      <button class="ytdl-caret" title="Más formatos">${ICON_CARET}</button>
      <div class="ytdl-menu" hidden></div>`;
    const menu = pill.querySelector('.ytdl-menu');
    MENU.forEach((m) => {
      if (m.sep) return menu.append(Object.assign(document.createElement('hr')));
      const b = document.createElement('button');
      b.textContent = m.label;
      b.onclick = (e) => { e.stopPropagation(); menu.hidden = true; start(m.req); };
      menu.append(b);
    });
    pill.querySelector('.ytdl-main').onclick = (e) => {
      e.stopPropagation();
      if (pill.classList.contains('ytdl-done') && currentJob?.path) return send('open', { path: currentJob.path });
      if (pill.classList.contains('ytdl-busy')) return;
      start(presets()[settings.defKind]);
    };
    pill.querySelector('.ytdl-caret').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', () => (menu.hidden = true));
    return pill;
  }

  function mount() {
    const existing = document.getElementById(ID);
    if (!settings?.showButton || !videoId()) { existing?.remove(); return; }

    const isShorts = location.pathname.startsWith('/shorts/');
    const anchor = !isShorts && document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
    if (existing) {
      // already in the right place?
      if (anchor ? existing.parentElement === anchor.parentElement : existing.classList.contains('ytdl-float')) return;
      existing.remove();
    }
    const pill = build();
    if (anchor) {
      anchor.after(pill);
    } else if (isShorts) {
      pill.classList.add('ytdl-float');
      document.body.append(pill);
    } else {
      return; // watch page not rendered yet; the observer will retry
    }
    if (currentJob && currentJob.videoId === videoId() && currentJob.status === 'done') {
      pill.classList.add('ytdl-done');
      pill.querySelector('.ytdl-main .ytdl-icon').innerHTML = ICON_OK;
      setLabel('Listo · abrir');
    }
  }

  let lastId = null;
  function onNavigate() {
    const id = videoId();
    if (id !== lastId) { lastId = id; resetPill(); }
    mount();
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; mount(); }, 400);
  });

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync' || !settings) return;
    for (const k in c) settings[k] = c[k].newValue;
    mount();
  });

  send('settings').then((s) => {
    settings = s;
    document.addEventListener('yt-navigate-finish', onNavigate);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    onNavigate();
  }).catch(() => {});
})();

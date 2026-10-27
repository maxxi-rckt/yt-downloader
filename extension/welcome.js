const $ = (s) => document.querySelector(s);

document.querySelectorAll('.kofi-link').forEach((a) => (a.href = CONFIG.KOFI_URL));
$('#site-link').href = CONFIG.SITE_URL;
$('#install-link').href = CONFIG.SITE_URL + '#descargar';
$('#install-cmd').textContent = CONFIG.INSTALL_CMD;

function ping() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ cmd: 'ping' }, (res) => {
      resolve(chrome.runtime.lastError ? null : res);
    });
  });
}

async function check() {
  const res = await ping();
  const ok = res?.ok && res.data.ytdlp;
  $('#status').className = 'card status ' + (ok ? 'ok' : 'bad');
  $('#status-dot').textContent = ok ? '✓' : '!';
  $('#install').hidden = !!ok;
  if (ok) {
    $('#status-title').textContent = 'Todo listo';
    $('#status-text').textContent = `Helper conectado · yt-dlp ${res.data.ytdlp}${res.data.ffmpeg ? ' · ffmpeg' : ''}. Ya puedes ir a YouTube y descargar.`;
    return;
  }
  const { os } = await chrome.runtime.getPlatformInfo();
  const win = os === 'win';
  $('#status-title').textContent = 'Falta un paso: instalar el helper';
  $('#status-text').textContent = 'La extensión descarga con yt-dlp en tu propio ordenador. Solo hay que instalarlo una vez.';
  $('#install-win').hidden = !win;
  $('#install-unix').hidden = win;
  $('#install-cmd').hidden = win;
  $('#copy').hidden = win;
  $('#install-link').hidden = !win;
}

$('#copy').onclick = () => navigator.clipboard.writeText(CONFIG.INSTALL_CMD).then(() => ($('#copy').textContent = '¡Copiado!'));
$('#recheck').onclick = check;
check();

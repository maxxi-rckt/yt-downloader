<p align="center"><img src="extension/icons/128.png" width="96" alt=""></p>
<h1 align="center">YT Downloader</h1>
<p align="center">
  Extensión gratuita para Chrome, Edge y Brave que descarga vídeo (MP4 hasta 4K) y audio (MP3/M4A) de YouTube.<br>
  <b>Windows · macOS · Linux</b> — sin servidores, sin cuentas, sin anuncios.
</p>
<p align="center">
  <a href="https://__GH_USER__.github.io/yt-downloader/"><b>🌐 Web e instrucciones</b></a> ·
  <a href="https://github.com/__GH_USER__/yt-downloader/releases/latest"><b>⬇️ Descargar</b></a> ·
  <a href="https://ko-fi.com/__KOFI_USER__"><b>☕ Apoyar en Ko-fi</b></a>
</p>

---

## Instalación

**Windows:**
1. Descarga [`YTDownloader-windows-x64.zip`](https://github.com/__GH_USER__/yt-downloader/releases/latest/download/YTDownloader-windows-x64.zip) y descomprímelo.
2. Abre `YTDownloader.exe`. Si sale «Windows protegió tu PC», pulsa *Más información → Ejecutar de todos modos*.

**macOS / Linux:**
```sh
curl -fsSL https://__GH_USER__.github.io/yt-downloader/install.sh | sh
```

**En todos los sistemas, el último paso:** abre `chrome://extensions`, activa *Modo de desarrollador*, pulsa *Cargar descomprimida* y elige la carpeta `extension`. El instalador te dice cuál es.

> ¿Por qué no está en la Chrome Web Store? Google no admite extensiones que descarguen de YouTube.

## Cómo funciona

```
extension/   Extensión MV3: popup, botón en YouTube, service worker
helper/      Programa en Go (Native Messaging). Instala yt-dlp, ffmpeg y deno y ejecuta las descargas
docs/        Web (GitHub Pages) e install.sh
tools/       build.sh (releases), test-helper.js, make-icons.js, set-links.js
```

La extensión habla con `helper` mediante [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). El helper lanza [yt-dlp](https://github.com/yt-dlp/yt-dlp) en tu ordenador y le envía el progreso. No hay ningún servidor intermedio.

## Desarrollo

```sh
cd helper && go build -o ../ytdownloader .              # compilar el helper
YTDL_DATA_DIR=/tmp/ytdl ./ytdownloader install --no-register
node tools/test-helper.js /tmp/ytdl/ytdownloader '{"type":"ping","rid":1}'
bash tools/build.sh v1.2.0                              # paquetes para las 5 plataformas en dist/
```

Una release se publica sola al subir un tag `v*`, mediante `.github/workflows/release.yml`.

El ID fijo de la extensión (`geplnkbnclcjomicgikpicndapejlgih`) sale de la clave `key` de `extension/manifest.json`.

## Uso responsable

Descarga solo contenido propio, con licencia libre o con permiso del autor. Este proyecto no está afiliado a YouTube ni a Google.

## Licencia

[MIT](LICENSE). Si te resulta útil, [invítame a un café ☕](https://ko-fi.com/__KOFI_USER__).

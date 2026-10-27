#!/bin/sh
# YT Downloader installer for macOS and Linux.
#   curl -fsSL https://maxxi-rckt.github.io/yt-downloader/install.sh | sh
set -eu

REPO="maxxi-rckt/yt-downloader"

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) echo "Sistema no soportado: $(uname -s). En Windows usa YTDownloader.exe." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "Arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
esac

url="https://github.com/$REPO/releases/latest/download/YTDownloader-$os-$arch.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Descargando YT Downloader ($os-$arch)…"
curl -fsSL "$url" | tar -xz -C "$tmp"
"$tmp/ytdownloader" install "$@"

#!/usr/bin/env bash
# Builds the helper for every platform and packages it with the extension into dist/.
# Usage: tools/build.sh [version]   (e.g. v1.1.0)
set -euo pipefail

VERSION="${1:-dev}"
VERSION="${VERSION#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"

for target in windows/amd64/windows-x64 darwin/amd64/macos-x64 darwin/arm64/macos-arm64 linux/amd64/linux-x64 linux/arm64/linux-arm64; do
  IFS=/ read -r goos goarch name <<<"$target"
  stage="$DIST/stage-$name"
  mkdir -p "$stage"
  bin=ytdownloader
  [ "$goos" = windows ] && bin=YTDownloader.exe

  (cd "$ROOT/helper" && CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$stage/$bin" .)

  cp -r "$ROOT/extension" "$stage/extension"
  if [ "$VERSION" != dev ]; then
    sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$stage/extension/manifest.json"
    rm "$stage/extension/manifest.json.bak"
  fi

  if [ "$goos" = windows ]; then
    (cd "$stage" && zip -qr "$DIST/YTDownloader-$name.zip" .)
  else
    tar -czf "$DIST/YTDownloader-$name.tar.gz" -C "$stage" .
  fi
  rm -rf "$stage"
  echo "✓ $name"
done

ls -la "$DIST"

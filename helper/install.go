package main

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const extensionID = "geplnkbnclcjomicgikpicndapejlgih"

// dataDir can be overridden with YTDL_DATA_DIR (used by tests and CI).
func dataDir() string {
	if d := os.Getenv("YTDL_DATA_DIR"); d != "" {
		return d
	}
	return platformDataDir()
}

func binDir() string { return filepath.Join(dataDir(), "bin") }

func helperPath() string { return filepath.Join(dataDir(), exeName("ytdownloader")) }

func manifestPath() string { return filepath.Join(dataDir(), hostName+".json") }

type dep struct {
	name string // binary name without extension
	url  string
	// inside: path of the binary inside an archive ("" = the download is the binary itself)
	inside string
}

func deps() []dep {
	arch := runtime.GOARCH
	gh := "https://github.com/"
	ytdlp := gh + "yt-dlp/yt-dlp/releases/latest/download/"
	ffb := gh + "yt-dlp/FFmpeg-Builds/releases/download/latest/"
	deno := gh + "denoland/deno/releases/latest/download/deno-"
	switch runtime.GOOS {
	case "windows":
		return []dep{
			{"yt-dlp", ytdlp + "yt-dlp.exe", ""},
			{"ffmpeg", ffb + "ffmpeg-master-latest-win64-gpl.zip", "bin/ffmpeg.exe|bin/ffprobe.exe"},
			{"deno", deno + "x86_64-pc-windows-msvc.zip", "deno.exe"},
		}
	case "darwin":
		mac := map[string]string{"arm64": "arm64", "amd64": "amd64"}[arch]
		dt := map[string]string{"arm64": "aarch64-apple-darwin", "amd64": "x86_64-apple-darwin"}[arch]
		mr := "https://ffmpeg.martin-riedl.de/redirect/latest/macos/" + mac + "/release/"
		return []dep{
			{"yt-dlp", ytdlp + "yt-dlp_macos", ""},
			{"ffmpeg", mr + "ffmpeg.zip", "ffmpeg"},
			{"ffprobe", mr + "ffprobe.zip", "ffprobe"},
			{"deno", deno + dt + ".zip", "deno"},
		}
	default: // linux
		if arch == "arm64" {
			return []dep{
				{"yt-dlp", ytdlp + "yt-dlp_linux_aarch64", ""},
				{"ffmpeg", ffb + "ffmpeg-master-latest-linuxarm64-gpl.tar.xz", "bin/ffmpeg|bin/ffprobe"},
				{"deno", deno + "aarch64-unknown-linux-gnu.zip", "deno"},
			}
		}
		return []dep{
			{"yt-dlp", ytdlp + "yt-dlp_linux", ""},
			{"ffmpeg", ffb + "ffmpeg-master-latest-linux64-gpl.tar.xz", "bin/ffmpeg|bin/ffprobe"},
			{"deno", deno + "x86_64-unknown-linux-gnu.zip", "deno"},
		}
	}
}

func step(format string, a ...any) { fmt.Printf("\n> "+format+"\n", a...) }

func runInstall(force, noPause, noRegister bool) {
	fmt.Printf("YT Downloader %s · instalador (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
	err := install(force, noRegister)
	if err != nil {
		fmt.Printf("\n✗ Error: %v\n", err)
	}
	if isWindows && !noPause {
		fmt.Print("\nPulsa Enter para cerrar…")
		bufio.NewReader(os.Stdin).ReadString('\n')
	}
	if err != nil {
		os.Exit(1)
	}
}

func install(force, noRegister bool) error {
	dir := dataDir()
	if err := os.MkdirAll(binDir(), 0o755); err != nil {
		return err
	}

	step("Copiando el helper a %s", dir)
	self, err := os.Executable()
	if err != nil {
		return err
	}
	self, _ = filepath.EvalSymlinks(self)
	if !samePath(self, helperPath()) {
		if err := copyFile(self, helperPath(), 0o755); err != nil {
			return fmt.Errorf("no se pudo copiar el helper: %w", err)
		}
	}

	// The extension folder ships next to the binary in the release zip.
	srcExt := filepath.Join(filepath.Dir(self), "extension")
	dstExt := filepath.Join(dir, "extension")
	if fi, err := os.Stat(filepath.Join(srcExt, "manifest.json")); err == nil && !fi.IsDir() && !samePath(srcExt, dstExt) {
		step("Copiando la extensión")
		os.RemoveAll(dstExt)
		if err := copyDir(srcExt, dstExt); err != nil {
			return fmt.Errorf("no se pudo copiar la extensión: %w", err)
		}
	}

	for _, d := range deps() {
		if !force {
			if p := findBin(d.name); p != "" {
				step("%s: ya disponible (%s)", d.name, p)
				continue
			}
		}
		step("Descargando %s", d.name)
		if err := fetchDep(d); err != nil {
			return fmt.Errorf("descargando %s: %w", d.name, err)
		}
	}

	if err := writeManifest(); err != nil {
		return err
	}
	if noRegister {
		step("Registro en navegadores omitido (--no-register)")
		return nil
	}
	step("Registrando el helper en los navegadores")
	registered, err := registerHost()
	if err != nil {
		return err
	}
	for _, r := range registered {
		fmt.Println("  ✓", r)
	}

	fmt.Println("\n✓ Instalación completada.")
	fmt.Println("\nÚltimo paso, en Chrome (o Edge/Brave):")
	fmt.Println("  1. Abre chrome://extensions")
	fmt.Println("  2. Activa «Modo de desarrollador» (arriba a la derecha)")
	fmt.Println("  3. Pulsa «Cargar descomprimida» y elige esta carpeta:")
	fmt.Println("     " + dstExt)
	if _, err := os.Stat(dstExt); err == nil {
		openDir(dstExt)
	}
	return nil
}

func writeManifest() error {
	m := map[string]any{
		"name":            hostName,
		"description":     "YT Downloader helper",
		"path":            helperPath(),
		"type":            "stdio",
		"allowed_origins": []string{"chrome-extension://" + extensionID + "/"},
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	return os.WriteFile(manifestPath(), b, 0o644)
}

func runUninstall() {
	removed := unregisterHost()
	for _, r := range removed {
		fmt.Println("  - quitado de", r)
	}
	dir := dataDir()
	fmt.Println("Eliminando", dir)
	// On Windows the running exe can't delete itself; remove everything else.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		if self, _ := os.Executable(); samePath(p, self) {
			continue
		}
		os.RemoveAll(p)
	}
	os.Remove(dir)
	fmt.Println("Listo. Quita la extensión desde chrome://extensions.")
}

// ---------------------------------------------------------------- downloads

var client = &http.Client{Timeout: 15 * time.Minute}

func download(url, dest string) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "ytdownloader-installer/"+version)
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("HTTP %d en %s", res.StatusCode, url)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	pw := &progressWriter{total: res.ContentLength}
	_, err = io.Copy(f, io.TeeReader(res.Body, pw))
	fmt.Println()
	return err
}

type progressWriter struct {
	total, done int64
	last        time.Time
}

func (p *progressWriter) Write(b []byte) (int, error) {
	p.done += int64(len(b))
	if time.Since(p.last) > 200*time.Millisecond || p.done == p.total {
		p.last = time.Now()
		if p.total > 0 {
			fmt.Printf("\r  %5.1f%%  %.1f / %.1f MB", float64(p.done)*100/float64(p.total), float64(p.done)/1e6, float64(p.total)/1e6)
		} else {
			fmt.Printf("\r  %.1f MB", float64(p.done)/1e6)
		}
	}
	return len(b), nil
}

func fetchDep(d dep) error {
	tmp, err := os.MkdirTemp("", "ytdl-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	archive := filepath.Join(tmp, filepath.Base(d.url))
	if err := download(d.url, archive); err != nil {
		return err
	}
	if d.inside == "" {
		return copyFile(archive, filepath.Join(binDir(), exeName(d.name)), 0o755)
	}
	ex := filepath.Join(tmp, "x")
	os.MkdirAll(ex, 0o755)
	if strings.HasSuffix(archive, ".zip") {
		err = unzip(archive, ex)
	} else {
		// .tar.xz: Go has no xz decoder in the standard library, but every Linux has tar+xz.
		err = exec.Command("tar", "-xJf", archive, "-C", ex).Run()
	}
	if err != nil {
		return fmt.Errorf("no se pudo descomprimir: %w", err)
	}
	for _, want := range strings.Split(d.inside, "|") {
		src, err := findInTree(ex, want)
		if err != nil {
			return err
		}
		if err := copyFile(src, filepath.Join(binDir(), filepath.Base(want)), 0o755); err != nil {
			return err
		}
	}
	return nil
}

// findInTree finds a file whose path ends with suffix (archives often wrap content in a versioned folder).
func findInTree(root, suffix string) (string, error) {
	suffix = filepath.FromSlash(suffix)
	var found string
	filepath.Walk(root, func(p string, fi os.FileInfo, err error) error {
		if err == nil && !fi.IsDir() && found == "" && strings.HasSuffix(p, string(filepath.Separator)+suffix) {
			found = p
		}
		return nil
	})
	if found == "" {
		return "", fmt.Errorf("no se encontró %s en el archivo descargado", suffix)
	}
	return found, nil
}

func unzip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		p := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(p, filepath.Clean(dest)+string(filepath.Separator)) {
			continue // zip-slip guard
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(p, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(p), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	os.MkdirAll(filepath.Dir(dst), 0o755)
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	out.Close()
	os.Chmod(tmp, mode)
	os.Remove(dst)
	return os.Rename(tmp, dst)
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if fi.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(p, target, 0o644)
	})
}

func samePath(a, b string) bool {
	a, _ = filepath.Abs(a)
	b, _ = filepath.Abs(b)
	if isWindows {
		return strings.EqualFold(a, b)
	}
	return a == b
}

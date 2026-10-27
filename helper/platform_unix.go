//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

const isWindows = false

var osName = runtime.GOOS

func home() string {
	h, _ := os.UserHomeDir()
	return h
}

func platformDataDir() string {
	if runtime.GOOS == "darwin" {
		return filepath.Join(home(), "Library", "Application Support", "YTDownloader")
	}
	if x := os.Getenv("XDG_DATA_HOME"); x != "" {
		return filepath.Join(x, "ytdownloader")
	}
	return filepath.Join(home(), ".local", "share", "ytdownloader")
}

// Browsers launch hosts with a minimal PATH, so Homebrew/Linuxbrew/user locations are listed explicitly.
func extraBinDirs(exe string) []string {
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", filepath.Join(home(), ".local", "bin"),
		filepath.Join(home(), ".deno", "bin"), "/home/linuxbrew/.linuxbrew/bin"}
	out := make([]string, len(dirs))
	for i, d := range dirs {
		out[i] = filepath.Join(d, exe)
	}
	return out
}

func hideWindow(c *exec.Cmd) {}

// prepareKill puts yt-dlp in its own process group so cancelling also stops its ffmpeg children.
func prepareKill(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func killTree(c *exec.Cmd) {
	if c.Process == nil {
		return
	}
	if err := syscall.Kill(-c.Process.Pid, syscall.SIGTERM); err != nil {
		c.Process.Kill()
	}
}

func revealFile(p string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-R", p).Start()
	}
	return openDir(filepath.Dir(p))
}

func openDir(p string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", p).Start()
	}
	return exec.Command("xdg-open", p).Start()
}

func pickFolder() (string, error) {
	var c *exec.Cmd
	if runtime.GOOS == "darwin" {
		c = exec.Command("osascript", "-e", `POSIX path of (choose folder with prompt "Carpeta de descargas")`)
	} else if p, err := exec.LookPath("zenity"); err == nil {
		c = exec.Command(p, "--file-selection", "--directory", "--title=Carpeta de descargas")
	} else if p, err := exec.LookPath("kdialog"); err == nil {
		c = exec.Command(p, "--getexistingdirectory", home())
	} else {
		return "", errors.New("no folder picker available")
	}
	out, err := c.Output()
	if err != nil {
		// cancelling the dialog exits non-zero: treat as "no selection"
		if _, ok := err.(*exec.ExitError); ok {
			return "", nil
		}
		return "", err
	}
	return strings.TrimRight(strings.TrimSpace(string(out)), "/"), nil
}

func hostDirs() map[string]string {
	if runtime.GOOS == "darwin" {
		as := filepath.Join(home(), "Library", "Application Support")
		return map[string]string{
			"Google Chrome":  filepath.Join(as, "Google", "Chrome"),
			"Chromium":       filepath.Join(as, "Chromium"),
			"Microsoft Edge": filepath.Join(as, "Microsoft Edge"),
			"Brave":          filepath.Join(as, "BraveSoftware", "Brave-Browser"),
			"Vivaldi":        filepath.Join(as, "Vivaldi"),
		}
	}
	cfg := os.Getenv("XDG_CONFIG_HOME")
	if cfg == "" {
		cfg = filepath.Join(home(), ".config")
	}
	return map[string]string{
		"Google Chrome":  filepath.Join(cfg, "google-chrome"),
		"Chromium":       filepath.Join(cfg, "chromium"),
		"Microsoft Edge": filepath.Join(cfg, "microsoft-edge"),
		"Brave":          filepath.Join(cfg, "BraveSoftware", "Brave-Browser"),
		"Vivaldi":        filepath.Join(cfg, "vivaldi"),
	}
}

// registerHost copies the manifest into each installed browser's NativeMessagingHosts folder.
// Chrome's folder is always created so installing the browser later still works.
func registerHost() ([]string, error) {
	b, err := os.ReadFile(manifestPath())
	if err != nil {
		return nil, err
	}
	var ok []string
	for label, dir := range hostDirs() {
		if _, err := os.Stat(dir); err != nil && label != "Google Chrome" {
			continue
		}
		nm := filepath.Join(dir, "NativeMessagingHosts")
		if err := os.MkdirAll(nm, 0o755); err != nil {
			return ok, err
		}
		if err := os.WriteFile(filepath.Join(nm, hostName+".json"), b, 0o644); err != nil {
			return ok, err
		}
		ok = append(ok, label)
	}
	return ok, nil
}

func unregisterHost() []string {
	var ok []string
	for label, dir := range hostDirs() {
		if os.Remove(filepath.Join(dir, "NativeMessagingHosts", hostName+".json")) == nil {
			ok = append(ok, label)
		}
	}
	return ok
}

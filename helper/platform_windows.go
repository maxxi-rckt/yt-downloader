package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const (
	isWindows      = true
	osName         = "windows"
	createNoWindow = 0x08000000
)

func platformDataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "YTDownloader")
}

func extraBinDirs(exe string) []string {
	return []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "WinGet", "Links", exe)}
}

func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

func prepareKill(c *exec.Cmd) {}

// killTree also stops the ffmpeg children that yt-dlp spawns.
func killTree(c *exec.Cmd) {
	if c.Process == nil {
		return
	}
	k := exec.Command("taskkill", "/pid", strconv.Itoa(c.Process.Pid), "/T", "/F")
	hideWindow(k)
	k.Run()
}

func revealFile(p string) error {
	c := exec.Command("explorer.exe")
	c.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + p + `"`}
	return c.Start()
}

func openDir(p string) error {
	c := exec.Command("explorer.exe")
	c.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe "` + p + `"`}
	return c.Start()
}

func pickFolder() (string, error) {
	ps := `Add-Type -AssemblyName System.Windows.Forms;` +
		`$f=New-Object System.Windows.Forms.Form -Property @{TopMost=$true};` +
		`$d=New-Object System.Windows.Forms.FolderBrowserDialog;` +
		`$d.Description='Carpeta de descargas';` +
		`if($d.ShowDialog($f) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8;$d.SelectedPath}`
	c := exec.Command("powershell.exe", "-NoProfile", "-STA", "-Command", ps)
	c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow}
	var out, errb strings.Builder
	c.Stdout, c.Stderr = &out, &errb
	if err := c.Run(); err != nil || strings.TrimSpace(errb.String()) != "" {
		return "", os.ErrInvalid
	}
	return strings.TrimSpace(out.String()), nil
}

var regKeys = []struct{ key, label string }{
	{`HKCU\Software\Google\Chrome\NativeMessagingHosts\`, "Google Chrome"},
	{`HKCU\Software\Chromium\NativeMessagingHosts\`, "Chromium"},
	{`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\`, "Microsoft Edge"},
	{`HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\`, "Brave"},
	{`HKCU\Software\Vivaldi\NativeMessagingHosts\`, "Vivaldi"},
}

// reg.exe works even where PowerShell runs in Constrained Language Mode.
func registerHost() ([]string, error) {
	var ok []string
	for _, r := range regKeys {
		c := exec.Command("reg", "add", r.key+hostName, "/ve", "/t", "REG_SZ", "/d", manifestPath(), "/f")
		hideWindow(c)
		if err := c.Run(); err != nil {
			return ok, err
		}
		ok = append(ok, r.label)
	}
	return ok, nil
}

func unregisterHost() []string {
	var ok []string
	for _, r := range regKeys {
		c := exec.Command("reg", "delete", r.key+hostName, "/f")
		hideWindow(c)
		if c.Run() == nil {
			ok = append(ok, r.label)
		}
	}
	return ok
}

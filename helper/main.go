// YT Downloader helper: a Native Messaging host for the extension and its own installer.
//
//	ytdownloader                     -> install (also what a double-click does)
//	ytdownloader install [--force]   -> download yt-dlp/ffmpeg/deno and register with browsers
//	ytdownloader uninstall
//	ytdownloader chrome-extension://… -> Native Messaging mode (launched by the browser)
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var version = "dev"

const hostName = "com.mchy.ytdl"

func main() {
	args := os.Args[1:]
	if len(args) > 0 && (strings.HasPrefix(args[0], "chrome-extension://") || strings.HasSuffix(args[0], ".json")) {
		runHost()
		return
	}
	cmd := "install"
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "install":
		runInstall(hasFlag(args, "--force"), hasFlag(args, "--no-pause"), hasFlag(args, "--no-register"))
	case "uninstall":
		runUninstall()
	case "version", "--version", "-v":
		fmt.Println(version)
	default:
		fmt.Println("Uso: ytdownloader [install [--force] [--no-register] [--no-pause] | uninstall | version]")
		os.Exit(2)
	}
}

func hasFlag(args []string, f string) bool {
	for _, a := range args {
		if a == f {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- messaging

var outMu sync.Mutex

type msg = map[string]any

func send(m msg) {
	body, _ := json.Marshal(m)
	outMu.Lock()
	defer outMu.Unlock()
	binary.Write(os.Stdout, binary.LittleEndian, uint32(len(body)))
	os.Stdout.Write(body)
}

var (
	jobsMu sync.Mutex
	jobs   = map[string]*exec.Cmd{}
	cancel = map[string]bool{}
)

func runHost() {
	r := bufio.NewReader(os.Stdin)
	for {
		var n uint32
		if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
			break
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(r, buf); err != nil {
			break
		}
		var m msg
		if json.Unmarshal(buf, &m) != nil {
			continue
		}
		go func(m msg) {
			if err := handle(m); err != nil {
				send(msg{"type": "error", "rid": m["rid"], "id": m["id"], "msg": err.Error()})
			}
		}(m)
	}
	// browser closed the port: stop everything we started
	jobsMu.Lock()
	for _, c := range jobs {
		killTree(c)
	}
	jobsMu.Unlock()
}

func str(m msg, k string) string {
	switch v := m[k].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

// ---------------------------------------------------------------- binaries

func exeName(name string) string {
	if isWindows {
		return name + ".exe"
	}
	return name
}

// findBin looks in our own bin dir first, then in the usual system places. Browsers start
// hosts with a minimal PATH (notably on macOS), so the common locations are listed explicitly.
func findBin(name string) string {
	exe := exeName(name)
	var cands []string
	cands = append(cands, filepath.Join(binDir(), exe))
	if self, err := os.Executable(); err == nil {
		cands = append(cands, filepath.Join(filepath.Dir(self), "bin", exe))
	}
	cands = append(cands, extraBinDirs(exe)...)
	for _, c := range cands {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c
		}
	}
	if p, err := exec.LookPath(exe); err == nil {
		return p
	}
	return ""
}

func ytdlpBaseArgs() []string {
	a := []string{"--no-playlist", "--no-warnings", "--encoding", "utf-8"}
	if ff := findBin("ffmpeg"); ff != "" {
		a = append(a, "--ffmpeg-location", filepath.Dir(ff))
	}
	if deno := findBin("deno"); deno != "" {
		a = append(a, "--js-runtimes", "deno:"+deno)
	}
	return a
}

func command(bin string, args ...string) *exec.Cmd {
	c := exec.Command(bin, args...)
	c.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8", "PYTHONUTF8=1")
	hideWindow(c)
	return c
}

var errLine = regexp.MustCompile(`^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?`)

func cleanError(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.Contains(lines[i], "ERROR") {
			return strings.TrimSpace(errLine.ReplaceAllString(lines[i], ""))
		}
	}
	return strings.TrimSpace(lines[len(lines)-1])
}

func run(bin string, args ...string) (string, error) {
	c := command(bin, args...)
	var out, errb strings.Builder
	c.Stdout, c.Stderr = &out, &errb
	if err := c.Run(); err != nil {
		if e := cleanError(errb.String()); e != "" {
			return out.String(), errors.New(e)
		}
		return out.String(), err
	}
	return out.String(), nil
}

func defaultOutDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads", "YouTube")
}

// ---------------------------------------------------------------- commands

func handle(m msg) error {
	rid := m["rid"]
	switch str(m, "type") {
	case "ping":
		ver := ""
		if y := findBin("yt-dlp"); y != "" {
			out, _ := run(y, "--version")
			ver = strings.TrimSpace(out)
			if ver == "" {
				ver = "?"
			}
		}
		send(msg{"type": "pong", "rid": rid, "version": version, "ytdlp": nilIfEmpty(ver),
			"ffmpeg": findBin("ffmpeg") != "", "deno": findBin("deno") != "", "defaultDir": defaultOutDir(), "os": osName})

	case "info":
		y, err := requireYtdlp()
		if err != nil {
			return err
		}
		out, err := run(y, append(ytdlpBaseArgs(), "-J", str(m, "url"))...)
		if err != nil {
			return err
		}
		var j struct {
			ID, Title, Channel, Uploader, Thumbnail, WebpageURL string
			Duration                                          float64
			IsLive                                            bool `json:"is_live"`
			Formats                                           []struct {
				Vcodec        string
				Width, Height float64
			}
		}
		if err := json.Unmarshal([]byte(out), &j); err != nil {
			return fmt.Errorf("respuesta inesperada de yt-dlp")
		}
		var raw struct {
			WebpageURL string `json:"webpage_url"`
		}
		json.Unmarshal([]byte(out), &raw)
		// Express each format as a "p" tier: vertical Shorts (1080x1920) and wide films (1920x800) both count as 1080p.
		seen := map[int]bool{}
		heights := []int{}
		for _, f := range j.Formats {
			if f.Vcodec == "" || f.Vcodec == "none" || f.Height == 0 {
				continue
			}
			w, h := f.Width, f.Height
			if w == 0 {
				w = h
			}
			t := int(max(min(w, h), float64(int(max(w, h)*9/16+0.5))))
			if !seen[t] {
				seen[t] = true
				heights = append(heights, t)
			}
		}
		sortDesc(heights)
		channel := j.Channel
		if channel == "" {
			channel = j.Uploader
		}
		url := raw.WebpageURL
		if url == "" {
			url = str(m, "url")
		}
		send(msg{"type": "info", "rid": rid, "info": msg{
			"id": j.ID, "url": url, "title": j.Title, "channel": channel, "duration": j.Duration,
			"thumbnail": j.Thumbnail, "heights": heights, "isLive": j.IsLive,
		}})

	case "download":
		return startDownload(m)

	case "cancel":
		id := str(m, "id")
		jobsMu.Lock()
		c := jobs[id]
		if c != nil {
			cancel[id] = true
		}
		jobsMu.Unlock()
		if c != nil {
			killTree(c)
		}

	case "open":
		p := str(m, "path")
		if p != "" {
			if _, err := os.Stat(p); err == nil {
				return revealFile(p)
			}
		}
		dir := str(m, "dir")
		if dir == "" {
			dir = defaultOutDir()
		}
		os.MkdirAll(dir, 0o755)
		return openDir(dir)

	case "pickFolder":
		p, err := pickFolder()
		if err != nil {
			return fmt.Errorf("no se pudo abrir el selector de carpetas; escribe la ruta a mano")
		}
		send(msg{"type": "folder", "rid": rid, "path": nilIfEmpty(p)})

	case "update":
		y, err := requireYtdlp()
		if err != nil {
			return err
		}
		out, err := run(y, "-U")
		if err != nil {
			return err
		}
		lines := strings.Split(strings.TrimSpace(out), "\n")
		send(msg{"type": "updated", "rid": rid, "output": strings.TrimSpace(lines[len(lines)-1])})
	}
	return nil
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func sortDesc(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] > a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func requireYtdlp() (string, error) {
	if y := findBin("yt-dlp"); y != "" {
		return y, nil
	}
	return "", errors.New("No se encontró yt-dlp. Vuelve a ejecutar el instalador.")
}

func formatArgs(m msg) []string {
	if str(m, "kind") == "audio" {
		if str(m, "format") == "m4a" {
			return []string{"-f", "ba[ext=m4a]/ba", "-x", "--audio-format", "m4a", "--embed-thumbnail"}
		}
		q := str(m, "quality")
		if q == "" {
			q = "320"
		}
		return []string{"-f", "ba", "-x", "--audio-format", "mp3", "--audio-quality", q + "K", "--embed-thumbnail"}
	}
	q, err := strconv.Atoi(str(m, "quality"))
	if err != nil || q <= 0 {
		q = 1080
	}
	// Prefer H.264 when it exists at that resolution (plays everywhere); 1440p/4K fall back to VP9/AV1.
	return []string{"-f", "bv*+ba/b", "-S", fmt.Sprintf("res:%d,vcodec:h264,ext:mp4:m4a", q), "--merge-output-format", "mp4"}
}

var postRe = regexp.MustCompile(`^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|FixupM)`)

func startDownload(m msg) error {
	y, err := requireYtdlp()
	if err != nil {
		return err
	}
	id := str(m, "id")
	outDir := str(m, "outDir")
	if outDir == "" {
		outDir = defaultOutDir()
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("no se puede crear la carpeta %s", outDir)
	}
	args := append(ytdlpBaseArgs(), formatArgs(m)...)
	args = append(args, "--embed-metadata",
		"-P", outDir, "-o", "%(title)s [%(id)s].%(ext)s",
		"--newline", "--progress", "--no-simulate",
		"--progress-template", "download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
		"--print", "after_move:FILE|%(filepath)s",
		str(m, "url"))

	c := command(y, args...)
	stdout, _ := c.StdoutPipe()
	var errb strings.Builder
	c.Stderr = &errb
	prepareKill(c)
	if err := c.Start(); err != nil {
		return err
	}
	jobsMu.Lock()
	jobs[id] = c
	jobsMu.Unlock()
	send(msg{"type": "started", "id": id})

	go func() {
		stage, finalPath, lastSent := 0, "", time.Time{}
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimRight(sc.Text(), "\r")
			switch {
			case strings.HasPrefix(line, "PROG|"):
				if time.Since(lastSent) < 250*time.Millisecond {
					continue
				}
				lastSent = time.Now()
				p := strings.Split(line, "|")
				num := func(i int) any {
					if i < len(p) {
						if f, err := strconv.ParseFloat(p[i], 64); err == nil {
							return f
						}
					}
					return nil
				}
				done, size := num(1), num(2)
				if size == nil {
					size = num(3)
				}
				var pct any
				if d, ok := done.(float64); ok {
					if s, ok := size.(float64); ok && s > 0 {
						pct = min(100, d/s*100)
					}
				}
				send(msg{"type": "progress", "id": id, "stage": stage, "pct": pct, "speed": num(4), "eta": num(5), "size": size})
			case strings.HasPrefix(line, "FILE|"):
				finalPath = strings.TrimSpace(line[5:])
			case strings.HasPrefix(line, "[download] Destination:"):
				stage++
				send(msg{"type": "progress", "id": id, "stage": stage, "pct": 0})
			case postRe.MatchString(line):
				send(msg{"type": "progress", "id": id, "stage": stage, "pct": 100, "processing": true})
			}
		}
		err := c.Wait()
		jobsMu.Lock()
		cancelled := cancel[id]
		delete(jobs, id)
		delete(cancel, id)
		jobsMu.Unlock()
		switch {
		case cancelled:
			send(msg{"type": "cancelled", "id": id})
		case err == nil:
			send(msg{"type": "done", "id": id, "path": finalPath})
		default:
			e := cleanError(errb.String())
			if e == "" {
				e = "yt-dlp terminó con error: " + err.Error()
			}
			send(msg{"type": "error", "id": id, "msg": e})
		}
	}()
	return nil
}

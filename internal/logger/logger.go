package logger

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// ANSI color codes
const (
	reset = "\033[0m"
	bold  = "\033[1m"
	dim   = "\033[2m"

	red     = "\033[31m"
	green   = "\033[32m"
	yellow  = "\033[33m"
	blue    = "\033[34m"
	magenta = "\033[35m"
	cyan    = "\033[36m"
	white   = "\033[37m"

	levelWidth     = 7
	tagWidth       = 16
	minBannerWidth = 62
)

var useColors = false
var outputMu sync.Mutex
var prodLogFile *os.File
var debugLogFile *os.File
var prodLogPath string
var debugLogPath string

var ansiColorRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func init() {
	// Check if colors are supported
	// Windows Terminal, PowerShell 7+, VS Code terminal support colors
	// Classic cmd.exe does NOT support ANSI by default

	if runtime.GOOS != "windows" {
		// Unix-like systems generally support colors
		useColors = true
		return
	}

	// On Windows, check for modern terminal indicators
	// WT_SESSION = Windows Terminal
	// TERM_PROGRAM = VS Code, etc.
	// ANSICON = ANSICON installed
	if os.Getenv("WT_SESSION") != "" ||
		os.Getenv("TERM_PROGRAM") != "" ||
		os.Getenv("ANSICON") != "" ||
		os.Getenv("ConEmuANSI") == "ON" {
		useColors = true
		return
	}

	// Try to enable VT mode on Windows 10+
	useColors = enableWindowsVT()
}

func colorize(color, text string) string {
	if !useColors {
		return text
	}
	return color + text + reset
}

func stripANSI(text string) string {
	return ansiColorRe.ReplaceAllString(text, "")
}

// InitFileLogging enables writing terminal logger output to files in baseDir.
// - eve-flipper-prod.log: mirrors terminal-style logs
// - eve-flipper-debug.log: full debug sink (also receives standard log.Printf output)
func InitFileLogging(baseDir string) error {
	baseDir = strings.TrimSpace(baseDir)
	if baseDir == "" {
		baseDir = "."
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return err
	}

	newProdPath := filepath.Join(baseDir, "eve-flipper-prod.log")
	newDebugPath := filepath.Join(baseDir, "eve-flipper-debug.log")

	newProdFile, err := os.OpenFile(newProdPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	newDebugFile, err := os.OpenFile(newDebugPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		_ = newProdFile.Close()
		return err
	}

	outputMu.Lock()
	oldProdFile := prodLogFile
	oldDebugFile := debugLogFile
	prodLogFile = newProdFile
	debugLogFile = newDebugFile
	prodLogPath = newProdPath
	debugLogPath = newDebugPath
	outputMu.Unlock()

	if oldProdFile != nil {
		_ = oldProdFile.Close()
	}
	if oldDebugFile != nil {
		_ = oldDebugFile.Close()
	}

	log.SetOutput(io.MultiWriter(os.Stderr, newProdFile, newDebugFile))
	return nil
}

// CloseFileLogging flushes/closes file sinks and restores std logger output to stderr.
func CloseFileLogging() {
	outputMu.Lock()
	prod := prodLogFile
	debug := debugLogFile
	prodLogFile = nil
	debugLogFile = nil
	prodLogPath = ""
	debugLogPath = ""
	outputMu.Unlock()

	if prod != nil {
		_ = prod.Close()
	}
	if debug != nil {
		_ = debug.Close()
	}
	log.SetOutput(os.Stderr)
}

// LogFiles returns absolute paths to active prod/debug log files.
func LogFiles() (string, string) {
	outputMu.Lock()
	defer outputMu.Unlock()
	return prodLogPath, debugLogPath
}

func emit(line string) {
	outputMu.Lock()
	defer outputMu.Unlock()

	fmt.Print(line)
	if prodLogFile == nil && debugLogFile == nil {
		return
	}

	plain := stripANSI(line)
	if prodLogFile != nil {
		_, _ = prodLogFile.WriteString(plain)
	}
	if debugLogFile != nil {
		_, _ = debugLogFile.WriteString(plain)
	}
}

func icon(color, symbol, ascii string) string {
	if useColors {
		return colorize(color, symbol)
	}
	return ascii
}

func separator() string {
	if useColors {
		return colorize(dim, strings.Repeat("─", 12))
	}
	return strings.Repeat("-", 12)
}

func timestamp() string {
	t := "[" + time.Now().Format("15:04:05") + "]"
	return colorize(dim, t)
}

func columnSeparator() string {
	if useColors {
		return colorize(dim, "│")
	}
	return "|"
}

func messageSeparator() string {
	if useColors {
		return colorize(dim, "›")
	}
	return ">"
}

func fitText(text string, width int) string {
	if width <= 0 {
		return ""
	}
	r := []rune(text)
	if len(r) > width {
		if width == 1 {
			return string(r[:1])
		}
		return string(r[:width-1]) + "…"
	}
	return string(r) + strings.Repeat(" ", width-len(r))
}

func visualWidth(text string) int {
	return utf8.RuneCountInString(text)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func sanitizeLevel(level string) string {
	level = strings.TrimSpace(level)
	if level == "" {
		return "INFO"
	}
	return strings.ToUpper(level)
}

func sanitizeTag(tag string) string {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return "CORE"
	}
	tag = strings.Join(strings.Fields(tag), "_")
	return strings.ToUpper(tag)
}

func logPrefix(level, tag, levelColor, symbol, ascii string) string {
	levelBadge := "[" + fitText(sanitizeLevel(level), levelWidth) + "]"
	tagCol := fitText(sanitizeTag(tag), tagWidth)
	if useColors {
		levelBadge = colorize(levelColor+bold, levelBadge)
		tagCol = colorize(cyan, tagCol)
	}
	marker := icon(levelColor, symbol, ascii)
	return fmt.Sprintf("%s %s %s %s %s", timestamp(), columnSeparator(), marker+" "+levelBadge, columnSeparator(), tagCol)
}

func printLog(level, tag, msg, levelColor, symbol, ascii string) {
	msgLines := strings.Split(msg, "\n")
	if len(msgLines) == 0 {
		msgLines = []string{""}
	}
	prefix := logPrefix(level, tag, levelColor, symbol, ascii)
	emit(fmt.Sprintf("%s %s %s\n", prefix, messageSeparator(), msgLines[0]))
	if len(msgLines) == 1 {
		return
	}

	contPrefix := fmt.Sprintf(
		"%s %s %s %s %s",
		strings.Repeat(" ", len("[15:04:05]")),
		columnSeparator(),
		strings.Repeat(" ", levelWidth+4),
		columnSeparator(),
		fitText("", tagWidth),
	)
	for _, line := range msgLines[1:] {
		emit(fmt.Sprintf("%s %s %s\n", contPrefix, messageSeparator(), line))
	}
}

// Banner prints the startup banner
func Banner(version string) {
	if version == "" {
		version = "dev"
	}
	lines := []string{
		"EVE FLIPPER TERMINAL",
		"Market analysis stack for EVE Online operators",
		"Build " + version + "   |   Local-first runtime",
	}
	width := minBannerWidth
	for _, line := range lines {
		width = maxInt(width, visualWidth(line))
	}

	emit("\n")
	if !useColors {
		horizontal := strings.Repeat("-", width+2)
		emit(fmt.Sprintf("  +%s+\n", horizontal))
		for _, line := range lines {
			emit(fmt.Sprintf("  | %s |\n", fitText(line, width)))
		}
		emit(fmt.Sprintf("  | %s |\n", fitText("Status: ready", width)))
		emit(fmt.Sprintf("  +%s+\n", horizontal))
		emit("\n")
		return
	}

	emit(colorize(cyan+bold, "  ╭"+strings.Repeat("─", width+2)+"╮") + "\n")
	for i, line := range lines {
		padded := " " + fitText(line, width) + " "
		lineColor := dim
		switch i {
		case 0:
			lineColor = yellow + bold
		case 1:
			lineColor = white
		default:
			lineColor = dim
		}
		emit(colorize(cyan+bold, "  │") + colorize(lineColor, padded) + colorize(cyan+bold, "│") + "\n")
	}

	statusText := "● core online   ● scanners ready   ● cache warm"
	statusLine := " " + colorize(dim, fitText(statusText, width)) + " "
	emit(colorize(cyan+bold, "  ├"+strings.Repeat("─", width+2)+"┤") + "\n")
	emit(colorize(cyan+bold, "  │") + statusLine + colorize(cyan+bold, "│") + "\n")
	emit(colorize(cyan+bold, "  ╰"+strings.Repeat("─", width+2)+"╯") + "\n")
	emit("\n")
}

// Info prints an info message
func Info(tag, msg string) {
	printLog("INFO", tag, msg, blue, "●", "*")
}

// Success prints a success message
func Success(tag, msg string) {
	printLog("SUCCESS", tag, msg, green, "✓", "+")
}

// Warn prints a warning message
func Warn(tag, msg string) {
	printLog("WARN", tag, msg, yellow, "⚠", "!")
}

// Error prints an error message
func Error(tag, msg string) {
	printLog("ERROR", tag, msg, red, "✗", "x")
}

// Loading prints a loading message (without newline initially)
func Loading(tag, msg string) {
	emit(fmt.Sprintf("%s %s %s", logPrefix("LOADING", tag, magenta, "◌", "..."), messageSeparator(), msg))
}

// Done completes a loading message
func Done(details string) {
	if details != "" {
		emit(fmt.Sprintf(" %s\n", colorize(dim, details)))
	} else {
		emit("\n")
	}
}

// Server prints the server listening message
func Server(addr string) {
	emit("\n")
	Success("SERVER", "Listening on "+colorize(cyan+bold, "http://"+addr+" (http://localhost:13370/)"))
	emit(fmt.Sprintf("%s %s %s\n", strings.Repeat(" ", 12), messageSeparator(), colorize(dim, "Press Ctrl+C to stop")))
	emit("\n")
}

// Section prints a section header
func Section(title string) {
	cleanTitle := strings.TrimSpace(title)
	if cleanTitle == "" {
		cleanTitle = "Section"
	}
	cleanTitle = strings.ToUpper(cleanTitle)
	if useColors {
		emit(fmt.Sprintf("\n%s %s %s\n", colorize(cyan, "┌"), colorize(white+bold, cleanTitle), separator()))
		return
	}
	emit(fmt.Sprintf("\n%s %s %s\n", "+", cleanTitle, separator()))
}

// Stats prints statistics in a nice format
func Stats(label string, value interface{}) {
	labelCol := fitText(strings.TrimSpace(label), 18)
	emit(fmt.Sprintf("    %s %s %v\n", icon(dim, "•", "-"), colorize(dim, labelCol+":"), colorize(white, fmt.Sprint(value))))
}

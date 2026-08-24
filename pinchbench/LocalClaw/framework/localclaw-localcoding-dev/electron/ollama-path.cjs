const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const BINARY = process.platform === "win32" ? "ollama.exe" : "ollama";

/**
 * Resolve Ollama executable path.
 * Priority: env var > packaged resources > project-local > userData download > system PATH
 */
function getOllamaPath() {
  // 1. Environment variable override
  if (process.env.OLLAMA_PATH && fs.existsSync(process.env.OLLAMA_PATH)) {
    return process.env.OLLAMA_PATH;
  }

  // 2. Packaged Electron app: resources/ollama/
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, "ollama", BINARY);
    if (fs.existsSync(packed)) return packed;
  }

  // 3. Dev mode: project-root/ollama/
  const dev = path.join(__dirname, "..", "ollama", BINARY);
  if (fs.existsSync(dev)) return dev;

  // 4. Downloaded to userData (set by Electron main via OLLAMA_USER_DATA)
  const userData = process.env.OLLAMA_USER_DATA;
  if (userData) {
    const downloaded = path.join(userData, "ollama", BINARY);
    if (fs.existsSync(downloaded)) return downloaded;
  }

  // 5. System PATH
  try {
    const cmd = process.platform === "win32" ? "where ollama" : "which ollama";
    const result = execSync(cmd, { timeout: 3000, windowsHide: true, encoding: "utf-8" }).trim();
    const firstLine = result.split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  return null;
}

/**
 * Determine the source of the Ollama binary.
 */
function getOllamaSource() {
  const p = getOllamaPath();
  if (!p) return "none";
  if (process.resourcesPath && p.startsWith(process.resourcesPath)) return "embedded";
  const dev = path.join(__dirname, "..", "ollama", BINARY);
  if (p === dev) return "embedded";
  const userData = process.env.OLLAMA_USER_DATA;
  if (userData && p.startsWith(path.join(userData, "ollama"))) return "downloaded";
  return "system";
}

/**
 * Resolve models storage directory.
 * Uses userData/ollama/models/ for embedded/downloaded, system default for system install.
 */
function getOllamaModelsDir() {
  const source = getOllamaSource();
  if (source === "system") return ""; // Let system Ollama use its default
  const userData = process.env.OLLAMA_USER_DATA || "";
  if (userData) return path.join(userData, "ollama", "models");
  // Dev mode fallback
  return path.join(__dirname, "..", "ollama", "models");
}

module.exports = { getOllamaPath, getOllamaSource, getOllamaModelsDir };

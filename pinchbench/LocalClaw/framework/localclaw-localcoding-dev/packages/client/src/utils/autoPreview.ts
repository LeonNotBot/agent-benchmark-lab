// 自动预览：从 assistant 文本中提取本地服务地址 / 静态 HTML 文件，打开内置浏览器。
// 由 sessionHandlers 在 session.status=completed 时调用。
//
// 两种来源（对应 preview-guard 的两类规则）：
//  1. 纯静态页面：`预览文件：<HTML 绝对路径>` —— 文件直接存在，转 file:// 立即打开，不探测端口。
//  2. 需开发服务器：`预览地址：http://localhost:<port>` —— 探测端口就绪后再打开。

import { getBrowserPreviewUrl } from "./browserPreview";

// 提取 http://localhost:<port> 或 http://127.0.0.1:<port>，取最后一个匹配。
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?(?:\/[^\s)）"'，。]*)?/gi;

// 提取「预览文件：<path>」中的 HTML 文件路径，取最后一个匹配。
// 路径可被反引号包裹（preview-guard 规则要求包裹以便在聊天中渲染为可点击链接）。
// 两种分支：
//  1. 反引号包裹 `...`：以闭合反引号为定界，允许路径含空格（会话目录名可能带空格，
//     如 sessions/2026-07-02_帮我对一份 AI 大_8386ea/report.html）。
//  2. 无包裹：路径字符类排除空白与中文标点，遇空格即止，避免吞掉后续正文。
const FILE_RE = /预览文件[：:]\s*(?:`([^`]+\.html?)`|([^\s`，。)）]+\.html?))/gi;

export function extractLocalUrl(text: string): string | null {
  if (!text) return null;
  const matches = text.match(URL_RE);
  if (!matches || matches.length === 0) return null;
  // 取最后一个，去掉可能误吞的尾部标点
  return matches[matches.length - 1].replace(/[，。）)、,.]+$/, "");
}

// 提取静态预览 HTML 文件路径（去掉尾部标点），取最后一个匹配。
// 反引号包裹分支命中组1（可含空格），无包裹分支命中组2。
export function extractPreviewFile(text: string): string | null {
  if (!text) return null;
  let last: string | null = null;
  for (const m of text.matchAll(FILE_RE)) {
    last = m[1] ?? m[2];
  }
  return last ? last.replace(/[，。）)、,]+$/, "") : null;
}

// 复用 LocalServiceList 的探测方式：no-cors 下 opaque 响应即代表端口在监听。
async function probe(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(1200) });
    return true;
  } catch {
    return false;
  }
}

const MAX_ATTEMPTS = 10;
const INTERVAL_MS = 800;

// 轮询直到就绪或超时（约 8s）。就绪返回 true。
async function waitReady(url: string): Promise<boolean> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await probe(url)) return true;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  return false;
}

/**
 * 从文本提取预览目标并打开内置浏览器：
 *  - 优先静态 HTML 文件（`预览文件：`）：转 file:// 直接打开，无需端口探测。
 *  - 否则本地服务地址（`预览地址：`）：探测端口就绪后打开。
 * 命中并最终打开返回 url，否则返回 null（不弹）。
 *
 * shouldOpen：真正调用 openInBrowser 之前的最后一道守卫。端口探测最长约 8s，
 * 期间用户可能已切到别的会话，此时不应弹开全局右面板（见 sessionHandlers 的
 * maybeAutoPreview 说明）。返回 false 则放弃打开并返回 null。
 */
export async function tryAutoPreview(
  text: string,
  openInBrowser: (url: string) => void,
  workDir?: string,
  shouldOpen?: () => boolean,
): Promise<string | null> {
  const allow = () => (shouldOpen ? shouldOpen() : true);

  // 1) 纯静态 HTML 文件：文件已存在，转 file:// 立即打开
  const file = extractPreviewFile(text);
  if (file) {
    const fileUrl = getBrowserPreviewUrl(file, workDir);
    if (fileUrl) {
      if (!allow()) return null;
      openInBrowser(fileUrl);
      return fileUrl;
    }
  }

  // 2) 本地服务地址：探测端口就绪后打开
  const url = extractLocalUrl(text);
  if (!url) return null;
  const ready = await waitReady(url);
  if (!ready) return null;
  if (!allow()) return null;
  openInBrowser(url);
  return url;
}

// 浏览器预览 URL 处理工具（S3 解耦：支持外部注入依赖，保留 fallback 兼容现有调用方）

import { useAppStore } from "../store/useAppStore";

function isHtmlPath(value: string): boolean {
  return /\.html?(?:[?#].*)?$/i.test(value);
}

function isAbsoluteUrl(value: string): boolean {
  return /^(https?:|file:)\/\//i.test(value) || value.startsWith("//");
}

function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const withoutLeadingSlash = normalized.replace(/^\//, "");
  return encodeURI(`file:///${withoutLeadingSlash}`);
}

function resolveLocalHtmlUrl(href: string, workDir: string): string | null {
  const clean = href.replace(/^\.\//, "");

  if (/^[a-zA-Z]:[\\/]/.test(clean) || clean.startsWith("/")) {
    return toFileUrl(clean);
  }

  if (!workDir) return null;

  const base = workDir.replace(/\\/g, "/").replace(/\/$/, "");
  return toFileUrl(`${base}/${clean}`);
}

export function getBrowserPreviewUrl(href: string | undefined, workDir?: string): string | null {
  if (!href || href.startsWith("data:") || href.startsWith("#")) return null;

  if (isAbsoluteUrl(href)) {
    return href.startsWith("//") ? `https:${href}` : href;
  }

  if (isHtmlPath(href)) {
    return resolveLocalHtmlUrl(href, workDir || "");
  }

  return null;
}

export function openBrowserPreview(
  href: string | undefined,
  openInBrowser?: (url: string) => void,
  workDir?: string,
): boolean {
  const previewUrl = getBrowserPreviewUrl(href, workDir);
  if (!previewUrl) return false;

  // S3 解耦：优先用外部注入，fallback 到全局 store（兼容现有调用方）
  const opener = openInBrowser ?? useAppStore.getState().openInBrowser;
  opener(previewUrl);
  return true;
}

// 从 file:/// 预览 URL 反解出页面所在的本地目录（用于一键部署打包）
// 仅支持本地 file 协议；http(s) 等远程地址返回 null
export function fileUrlToLocalDir(url: string): string | null {
  if (!/^file:\/\//i.test(url)) return null;
  try {
    let p = decodeURI(url.replace(/^file:\/\//i, ""));
    p = p.replace(/^\//, ""); // 去掉 Windows 盘符前多余的斜杠
    p = p.split(/[?#]/)[0]; // 去掉查询串/锚点
    const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    if (slash <= 0) return null;
    return p.slice(0, slash);
  } catch {
    return null;
  }
}

// 规范化路径分隔符为 /，去掉末尾斜杠，用于跨平台路径比较。
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

// 判断 URL 是否指向本机运行的服务（localhost / 127.0.0.1 / 0.0.0.0 / ::1）
function isLocalHostUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

// 解析「当前预览页面」对应的可部署本地目录：
// - file:// 预览：反解出 HTML 所在目录
// - 本地服务（http://localhost 等）：AI 生成的开发服务即由会话工作目录启动，故用 workDir
// - 远程站点：无法部署，返回 null
export function resolvePreviewDir(url: string, workDir?: string): string | null {
  if (!url) return null;
  const fileDir = fileUrlToLocalDir(url);
  if (fileDir) return fileDir;
  if (isLocalHostUrl(url) && workDir) return workDir;
  return null;
}

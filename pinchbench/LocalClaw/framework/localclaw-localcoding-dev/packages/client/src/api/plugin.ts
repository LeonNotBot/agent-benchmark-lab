import type { PluginPreflight, PluginImportResult, PluginScope, ScaffoldResult } from "@lenovo/agent-protocol";

/** 拼 scope/cwd/overwrite/includeLocalSettings query。 */
function qs(scope: PluginScope, cwd?: string, overwrite?: boolean, includeLocalSettings?: boolean): string {
  const p = new URLSearchParams({ scope });
  if (cwd) p.set("cwd", cwd);
  if (overwrite) p.set("overwrite", "1");
  if (includeLocalSettings) p.set("includeLocalSettings", "1");
  return `?${p.toString()}`;
}

/** 预检插件 zip：返回 manifest/counts/conflicts，不写盘。 */
export async function apiPreflightPlugin(
  buffer: ArrayBuffer, scope: PluginScope, cwd?: string,
): Promise<PluginPreflight> {
  const r = await fetch(`/api/plugins/preflight${qs(scope, cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buffer,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "预检失败");
  return data as PluginPreflight;
}

/** 安装插件 zip 到目标作用域。overwrite 控冲突覆盖，includeLocalSettings 控是否导入本地权限设置。 */
export async function apiInstallPlugin(
  buffer: ArrayBuffer, scope: PluginScope, cwd: string | undefined,
  overwrite: boolean, includeLocalSettings = false,
): Promise<PluginImportResult> {
  const r = await fetch(`/api/plugins/install${qs(scope, cwd, overwrite, includeLocalSettings)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buffer,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "安装失败");
  return data as PluginImportResult;
}

/** 脚手架：在目标项目生成 .claude 骨架。 */
export async function apiScaffoldPlugin(
  cwd: string, name?: string, includeExamples = true,
): Promise<ScaffoldResult> {
  const r = await fetch("/api/plugins/scaffold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, name, includeExamples }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "生成失败");
  return data as ScaffoldResult;
}

/** 导出插件：触发浏览器下载 <包名>.zip。 */
export async function downloadPluginExport(cwd: string): Promise<void> {
  const r = await fetch(`/api/plugins/export?cwd=${encodeURIComponent(cwd)}`);
  if (!r.ok) {
    // 后端错误体形如 {"statusCode":400,"message":"no_claude_dir"}，抽出稳定错误码
    // 交给调用方做友好化，避免把原始 JSON / 英文码直接弹给用户。
    const raw = await r.text().catch(() => "");
    let code = raw;
    try { code = JSON.parse(raw)?.message ?? raw; } catch { /* keep raw */ }
    throw new Error(code || "export_failed");
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cd = r.headers.get("Content-Disposition") || "";
  a.download = /filename="([^"]+)"/.exec(cd)?.[1] || "scene-pack.zip";
  a.click();
  URL.revokeObjectURL(url);
}

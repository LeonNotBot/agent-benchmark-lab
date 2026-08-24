import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PluginService } from "../plugin.service";

const FW = "D:/lenovo-code/fw-agent/.claude";

describe("PluginService e2e — 真实 fw-agent 场景包", () => {
  it.skipIf(!existsSync(FW))("打包 fw-agent → preflight + install 到空项目", () => {
    const zip = new AdmZip();
    zip.addLocalFolder(FW, ".claude");
    const buf = zip.toBuffer();
    const svc = new PluginService();
    const proj = mkdtempSync(join(tmpdir(), "e2e-fw-"));
    try {
      const pf = svc.preflight(buf, "project", proj);
      expect(pf.counts.commands).toBeGreaterThan(0);
      expect(pf.counts.skills).toBeGreaterThan(0);
      expect(pf.conflicts).toEqual([]);
      // 阶段三：审查到 fw-agent 的脚本（flash-stm32.sh / *.py 等）
      expect(pf.audit.scripts.length).toBeGreaterThan(0);
      expect(pf.audit.scripts.some((s) => s.type === "sh" || s.type === "py")).toBe(true);
      const r = svc.install(buf, "project", proj, { overwrite: false });
      expect(r.ok).toBe(true);
      expect(r.installed.length).toBeGreaterThan(0);
      // settings.local.json 不应被装入
      expect(existsSync(join(proj, ".claude", "settings.local.json"))).toBe(false);
    } finally { rmSync(proj, { recursive: true, force: true }); }
  });
});

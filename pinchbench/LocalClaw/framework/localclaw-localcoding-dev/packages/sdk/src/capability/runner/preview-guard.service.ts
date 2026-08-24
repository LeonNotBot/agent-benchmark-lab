import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { join } from "path";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { atomicWriteFile } from "../../util/atomic-write";
import { getAgentHomeDir } from "../../config/paths";

/**
 * @internal 预览守则注册器：往用户级 ~/.localclaw/CLAUDE.md 追加
 * 「开发完成后自动预览」规则。复用 cron 守则的版本化 marker + 幂等替换模式。
 */
@Injectable()
export class PreviewGuardService implements OnModuleInit {
  private readonly logger = new Logger(PreviewGuardService.name);

  onModuleInit(): void {
    try {
      this.appendPreviewGuardToUserClaudeMd();
    } catch (e) {
      this.logger.error(`[preview-guard] sync failed: ${String(e)}`);
    }
  }

  private appendPreviewGuardToUserClaudeMd(): void {
    const claudeDir = getAgentHomeDir();
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    const p = join(claudeDir, "CLAUDE.md");
    const CURRENT_VERSION = 3;
    const markerRe = /<!-- local-claw:preview-guard:v(\d+) -->/;
    const startMarker = `<!-- local-claw:preview-guard:v${CURRENT_VERSION} -->`;
    const endMarker = "<!-- /local-claw:preview-guard -->";

    const bodyLines = [
      startMarker,
      "## 开发完成后自动预览（Local Claw）",
      "",
      "完成一个可在本地运行的 Web 项目后，按项目类型选择预览方式：",
      "",
      "- 纯静态页面（只有 HTML/CSS/JS、无构建步骤、无后端）：不要启动任何服务器。完成后在回复末尾用单独一行明确输出入口 HTML 文件路径，使用固定格式：`预览文件：` 后紧跟用反引号包裹的 HTML 文件绝对路径，例如 `预览文件：`D:\\proj\\index.html``（前端会自动在右侧内置浏览器打开该文件；反引号包裹可让该路径在聊天中渲染为可点击链接，用户点击也能打开预览）。",
      "- 需要开发服务器的项目（有 package.json 且含 dev/start 脚本，如 Vite/Next/React，或带后端服务）：",
      "  1. 用后台方式启动（必须 run_in_background，禁止前台阻塞当前对话）：按 lockfile 选包管理器（pnpm-lock.yaml→pnpm / bun.lock→bun / 否则 npm）运行 dev 或 start 脚本。",
      "  2. 等待服务就绪，从启动日志里读出本地访问地址（Local URL）。",
      "  3. 在回复末尾用单独一行明确输出该地址，使用固定格式：`预览地址：http://localhost:<port>`。",
      "  4. 不要在前台运行会阻塞的命令；若需查看日志，使用后台任务的输出查看方式。",
      endMarker,
    ];

    const existing = existsSync(p) ? readFileSync(p, "utf-8") : "";
    const nl = existing.includes("\r\n") ? "\r\n" : "\n";
    const body = bodyLines.join(nl);

    let next: string;
    const startMatch = existing.match(markerRe);
    if (startMatch) {
      const startIdx = startMatch.index ?? 0;
      const endIdx = existing.indexOf(endMarker, startIdx);
      if (endIdx >= 0) {
        next =
          existing.slice(0, startIdx) +
          body +
          existing.slice(endIdx + endMarker.length);
      } else {
        next =
          existing.slice(0, startIdx).replace(/\s+$/, "") + nl + nl + body + nl;
      }
    } else {
      next = existing
        ? existing.replace(/\s+$/, "") + nl + nl + body + nl
        : body + nl;
    }

    if (next === existing) return;
    atomicWriteFile(p, next);
    this.logger.log(`[preview-guard] updated ${p} (marker v${CURRENT_VERSION})`);
  }
}

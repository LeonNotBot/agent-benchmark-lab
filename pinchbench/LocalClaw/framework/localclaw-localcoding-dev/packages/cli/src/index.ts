/**
 * LocalClaw CLI 主启动器。
 *
 * 薄壳：布置好隔离配置目录与端点凭据后，in-process import vendored claude-cli 点火。
 * claude-cli 从 process.argv / process.env 取输入，故所有布置必须在 import 之前完成；
 * import 之后进程即交由 CLI 接管（含它内部的 process.exit）。
 */
import { prepareEnv } from "./prepare-env.js";

async function main(): Promise<void> {
  const { configDir, credentialSource } = prepareEnv();

  // 无任何可用凭据：给一句友好引导，仍然放行（用户可能只想看 --help / --version）。
  if (credentialSource === "none" && needsCredentials()) {
    process.stderr.write(
      "⚠ 未找到可用的模型端点凭据。\n" +
        `  可在桌面版/VSCode 插件里配置端点（写入 ${configDir}/settings.json），\n` +
        "  或设置环境变量 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN 后重试。\n\n",
    );
  }

  // 点火：交出控制权给 claude-cli。用包 exports 的 node 入口。
  await import("@lenovo/claude-cli/cli-node.js");
}

/** 是否是一次真正需要模型的调用（排除 --help / --version 等纯本地命令）。 */
function needsCredentials(): boolean {
  const args = process.argv.slice(2);
  const localOnly = ["--help", "-h", "--version", "-v", "mcp", "config"];
  return !args.some((a) => localOnly.includes(a));
}

main().catch((err) => {
  process.stderr.write(`[lc] 启动失败: ${(err as Error)?.message ?? err}\n`);
  process.exit(1);
});

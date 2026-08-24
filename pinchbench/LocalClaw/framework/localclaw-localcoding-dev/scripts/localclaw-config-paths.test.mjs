import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");

// 受检的产品配置/运行时源文件。验证它们不把「产品自己的配置」硬编码到 ~/.claude
// （CLI 共用目录）。注意：
//  - 路径决策已收敛到 SDK（paths.ts / agent-settings.ts），故 server 侧多为兼容 shim。
//  - paths.ts 与 vendored CLI bundle 合法引用 .claude（CLI 共用目录的唯一真相处），
//    因此不纳入本检查，否则误报。
const filesToCheck = [
  "packages/server/src/config/claude-settings.ts",
  "packages/server/src/config/localclaw-settings.ts",
  "packages/channel/src/channel.service.ts",
  "packages/sdk/src/capability/scheduled-task/cron-mcp-registrar.service.ts",
  "packages/sdk/src/capability/scheduled-task/mcp-servers/cron-tools.mjs",
  "packages/sdk/src/config/agent-settings.ts",
  ".gitignore",
  "README.md",
];

const forbiddenPatterns = [
  /~\/\.claude\//,
  /\"\.claude\//,
  /'\.claude\//,
  /join\([^\n]*"\.claude"/,
  /join\([^\n]*'\.claude'/,
  /\.claude\/settings\.json/,
  /\.claude\/settings\.local\.json/,
];

test("runtime MCP settings resolve to <agentHome>/settings.json (product-derived home)", () => {
  // 路径解析真相：SDK paths.ts 的 agentHome 默认按产品名派生 ~/.<product>；
  // agent-settings 在其下取 settings.json。
  const pathsContent = readFileSync(join(repoRoot, "packages/sdk/src/config/paths.ts"), "utf8");
  assert.match(
    pathsContent,
    /join\(homedir\(\), "\." \+ getProductName\(\)\)/,
    "paths.ts getAgentHomeDir should default to ~/.<product> via getProductName()",
  );

  const agentSettingsContent = readFileSync(join(repoRoot, "packages/sdk/src/config/agent-settings.ts"), "utf8");
  assert.match(
    agentSettingsContent,
    /join\(getAgentConfigDir\(\), "settings\.json"\)/,
    "agent-settings.ts should resolve settings.json under the agent config dir",
  );

  // 写 MCP server 的运行时服务都必须经共享 settings helper，且不再触碰 ~/.claude.json。
  const runtimeFiles = [
    "packages/channel/src/channel.service.ts",
    "packages/sdk/src/capability/scheduled-task/cron-mcp-registrar.service.ts",
  ];

  for (const relativePath of runtimeFiles) {
    const content = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.match(content, /readLocalClawSettings/, `${relativePath} should read MCP settings via shared helper`);
    assert.match(content, /writeLocalClawSettings/, `${relativePath} should write MCP settings via shared helper`);
    assert.doesNotMatch(
      content,
      /\.claude\.json/,
      `${relativePath} should no longer reference ~/.claude.json`,
    );
  }
});

test("runtime config paths never hardcode the CLI-shared ~/.claude dir", () => {
  for (const relativePath of filesToCheck) {
    const content = readFileSync(join(repoRoot, relativePath), "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(
        content,
        pattern,
        `${relativePath} still matches ${pattern}`,
      );
    }
  }
});

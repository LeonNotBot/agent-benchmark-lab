import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "fs";
import { dirname, join } from "path";
import { getAgentHomeDir } from "./paths";
import { atomicWriteFile } from "../util/atomic-write";
import { logger } from "../util/logger";

/**
 * Agent 配置存储（去产品化）。
 *
 * 配置目录由 paths.ts 统一解析（getAgentHomeDir）：宿主经 configurePaths 注入、
 * 或 AGENT_CONFIG_DIR 环境变量覆盖，默认 ~/.localclaw。不写死任何产品名。
 */
export type AgentSettings = {
  env?: Record<string, unknown>;
  /** 「默认 Claude 通道」直连配置；独立于 env 块，避免 CLI 配置清洗误删。 */
  directEnv?: Record<string, unknown>;
  /** directEnv 迁移失败或不完整时的归档（保留凭据不销毁，对齐 Action A 规则）。 */
  directEnvArchived?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  techStack?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * 产品配置根目录。getAgentHomeDir 的别名，保留旧名供存量消费方（channel 等）使用。
 * @see getAgentHomeDir
 */
export function getAgentConfigDir(): string {
  return getAgentHomeDir();
}

export function getAgentSettingsPath(): string {
  return join(getAgentConfigDir(), "settings.json");
}

export function readAgentSettings(): AgentSettings {
  const settingsPath = getAgentSettingsPath();
  if (!existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as AgentSettings;
  } catch (err) {
    // 坏 JSON 不能静默吞成 {}：下游 read-modify-write 链（endpoint-registry
    // persist、directEnv 迁移等）会拿这个 {} 回写盘，把用户的 directEnv/mcpServers/
    // techStack/endpoints 全部覆盖销毁，且坏文件原地被盖、无法救回。
    //
    // 故先把坏文件改名留档（settings.corrupt-<ts>.json，保留现场供人工恢复），再返回
    // 默认 {} 让系统降级续跑——绝不在 server 启动链里 throw（settings.json 是全局单
    // 文件，一个坏字符会瘫痪全员）。备份后原路径无文件，下次读走「不存在→默认」分支，
    // 不会每读堆一个 .corrupt；rename 自身失败则吞掉异常、仅告警，不阻断启动也不重试。
    backupCorruptSettings(settingsPath, err);
    return {};
  }
}

/**
 * 本进程内已尝试过备份的坏文件路径。仅用于「rename 失败」场景：坏文件仍在原地，
 * 后续每次读都会再次 parse-fail，若不短路就会每读重试 rename + 重复刷日志。
 * rename 成功时原路径已无文件、走「不存在」分支，本集合不参与。
 */
const corruptBackupAttempted = new Set<string>();

/** @internal 仅供测试：清空「本进程已尝试备份」记录，使各用例互不串扰。 */
export function __resetCorruptBackupForTest(): void {
  corruptBackupAttempted.clear();
}

/** 把无法解析的 settings.json 改名备份（best-effort，失败不抛、不阻断启动）。 */
function backupCorruptSettings(settingsPath: string, parseErr: unknown): void {
  if (corruptBackupAttempted.has(settingsPath)) return;
  corruptBackupAttempted.add(settingsPath);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(dirname(settingsPath), `settings.corrupt-${ts}.json`);
  try {
    renameSync(settingsPath, backupPath);
    logger.warn(
      `[agent-settings] settings.json 解析失败（${(parseErr as Error)?.message ?? parseErr}）：` +
        `已将坏文件备份到 ${backupPath} 并以默认配置降级启动。原配置未丢，可手工修复后改回。`,
    );
  } catch (renameErr) {
    // 备份失败（权限/占用）：不阻断启动、不重试。仅告警，仍返回默认。
    logger.warn(
      `[agent-settings] settings.json 解析失败且备份未成功（${
        (renameErr as Error)?.message ?? renameErr
      }）：以默认配置降级启动，坏文件仍留在 ${settingsPath}。`,
    );
  }
}

export function writeAgentSettings(settings: AgentSettings): void {
  const settingsPath = getAgentSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
}

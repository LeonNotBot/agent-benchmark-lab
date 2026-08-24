import { SK } from "../../store/storageKeys";
import type { DeployPayload } from "./autoDeployTypes";

// 部署面板的会话级本地存储：表单 + 「进行中」部署记录均按 sessionId 隔离，
// 避免切换会话时表单内容串味、并支持切回自动恢复订阅。

export interface DeployForm {
  packagePath: string;
  deployId: string;
  name: string;
}

export const EMPTY_FORM: DeployForm = { packagePath: "", deployId: "", name: "" };

// 进行中记录：哪个会话正在部署哪个 deployId（终态后清除）
export interface ActiveDeploy {
  deployId: string;
  ts: number;
}

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Record<string, T>;
  } catch { /* ignore */ }
  return {};
}

function writeMap<T>(key: string, map: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch (e) {
    // QuotaExceededError 等存储异常：记录警告，避免静默丢数据
    console.warn("[deployStorage] localStorage write failed:", e);
  }
}

// 全局默认值回退：新 session 若没有自己的表单记录，回退到旧版存下的全局值。
// 旧版直接把 DeployForm 存成 flat object 在 SK.AUTO_DEPLOY_FORM（非 sessionId map）。
// 通过检测值是否为字符串区分旧格式（新格式的 map value 是 DeployForm 对象）。
// 注：此路径是全局默认值语义，不是一次性迁移——flat 数据不会被清除，
// 直到该 key 被新格式 map 覆盖为止。若需真正迁移，应在首次读到后搬入 map[sessionId]。
function readLegacyForm(): Partial<DeployForm> | null {
  try {
    const raw = localStorage.getItem(SK.AUTO_DEPLOY_FORM);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 旧格式：{ packagePath: "...", deployId: "...", name: "..." }（值均为字符串）
    // 新格式：{ "<sessionUUID>": { packagePath, deployId, name } }（值为对象）
    if (parsed && typeof parsed.packagePath === "string") return parsed as Partial<DeployForm>;
  } catch { /* ignore */ }
  return null;
}

export function loadForm(sessionId: string): DeployForm {
  const map = readMap<DeployForm>(SK.AUTO_DEPLOY_FORM);
  const saved = sessionId ? map[sessionId] : undefined;
  if (saved) return { ...EMPTY_FORM, ...saved };
  const legacy = readLegacyForm();
  return legacy ? { ...EMPTY_FORM, ...legacy } : { ...EMPTY_FORM };
}

export function saveForm(sessionId: string, form: DeployForm): void {
  if (!sessionId) return;
  const map = readMap<DeployForm>(SK.AUTO_DEPLOY_FORM);
  map[sessionId] = form;
  writeMap(SK.AUTO_DEPLOY_FORM, map);
}

// 读取某会话进行中的部署记录
export function getActiveDeploy(sessionId: string): ActiveDeploy | null {
  if (!sessionId) return null;
  const map = readMap<ActiveDeploy>(SK.AUTO_DEPLOY_ACTIVE);
  return map[sessionId] ?? null;
}

// 标记某会话进入「进行中」
export function setActiveDeploy(sessionId: string, deployId: string): void {
  if (!sessionId || !deployId) return;
  const map = readMap<ActiveDeploy>(SK.AUTO_DEPLOY_ACTIVE);
  map[sessionId] = { deployId, ts: Date.now() };
  writeMap(SK.AUTO_DEPLOY_ACTIVE, map);
}

// 终态后清除某会话的进行中记录
export function clearActiveDeploy(sessionId: string): void {
  if (!sessionId) return;
  const map = readMap<ActiveDeploy>(SK.AUTO_DEPLOY_ACTIVE);
  if (map[sessionId]) {
    delete map[sessionId];
    writeMap(SK.AUTO_DEPLOY_ACTIVE, map);
  }
}

// 最近一次成功记录：下次进入面板时回显访问地址
export interface LastSuccess {
  url: string;
  name: string;
  deployId: string;
  ts: number;
}

export function getLastSuccess(sessionId: string): LastSuccess | null {
  if (!sessionId) return null;
  const map = readMap<LastSuccess>(SK.AUTO_DEPLOY_LAST);
  return map[sessionId] ?? null;
}

export function setLastSuccess(sessionId: string, rec: LastSuccess): void {
  if (!sessionId) return;
  const map = readMap<LastSuccess>(SK.AUTO_DEPLOY_LAST);
  map[sessionId] = rec;
  writeMap(SK.AUTO_DEPLOY_LAST, map);
}

// 最近一次失败记录：保存整个失败终态 payload，切回会话时完整还原失败现场
// （状态标题 / 建议 / 阶段时间线 / 终端输出），并可就地重新部署。
export interface LastFailure {
  payload: DeployPayload;
  ts: number;
}

export function getLastFailure(sessionId: string): LastFailure | null {
  if (!sessionId) return null;
  const map = readMap<LastFailure>(SK.AUTO_DEPLOY_LAST_FAIL);
  return map[sessionId] ?? null;
}

export function setLastFailure(sessionId: string, payload: DeployPayload): void {
  if (!sessionId) return;
  // 截断终端输出尾部，避免超长日志撑爆 localStorage（保留最后 8000 字符即够排查）
  const MAX_TAIL = 8000;
  const tail = payload.terminalTail;
  const trimmed = tail && tail.length > MAX_TAIL
    ? { ...payload, terminalTail: `…（前文省略）\n${tail.slice(-MAX_TAIL)}` }
    : payload;
  const map = readMap<LastFailure>(SK.AUTO_DEPLOY_LAST_FAIL);
  map[sessionId] = { payload: trimmed, ts: Date.now() };
  writeMap(SK.AUTO_DEPLOY_LAST_FAIL, map);
}

// 重新部署成功 / 开始新部署时清除失败记录，避免旧失败现场残留
export function clearLastFailure(sessionId: string): void {
  if (!sessionId) return;
  const map = readMap<LastFailure>(SK.AUTO_DEPLOY_LAST_FAIL);
  if (map[sessionId]) {
    delete map[sessionId];
    writeMap(SK.AUTO_DEPLOY_LAST_FAIL, map);
  }
}

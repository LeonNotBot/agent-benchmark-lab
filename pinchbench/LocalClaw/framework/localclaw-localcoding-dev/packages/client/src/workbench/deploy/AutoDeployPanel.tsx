import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import { useWorkbenchStore } from "../store";
import { useDeployEvents } from "./useDeployEvents";
import { DeployProgressView } from "./DeployProgressView";
import { DeployEmptyState } from "./DeployEmptyState";
import { showToast } from "../../components/Toast";
import {
  type DeployForm as FormState, type LastSuccess, type LastFailure, EMPTY_FORM,
  loadForm, saveForm, getActiveDeploy, setActiveDeploy, clearActiveDeploy,
  getLastSuccess, setLastSuccess,
  getLastFailure, setLastFailure, clearLastFailure,
} from "./deployStorage";

interface Props {
  workDir: string;
  // 当前会话 ID：表单与「进行中」部署记录均按此隔离
  sessionId: string;
}

// 自动部署面板：提交本地代码包到第三方部署系统并订阅 SSE 进度
export function AutoDeployPanel({ workDir, sessionId }: Props) {
  const { t } = useLocale();
  const [form, setForm] = useState<FormState>(() => loadForm(sessionId));
  const [submitting, setSubmitting] = useState(false);
  const [packing, setPacking] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [packInfo, setPackInfo] = useState<string | null>(null);
  // 目录内没有可打包文件（空目录或全被过滤）→ 展示友好空态而非红色错误
  const [emptyDir, setEmptyDir] = useState(false);
  const { connected, payload, terminal, error, subscribe, stop } = useDeployEvents();
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 最近一次成功记录：挂载时读入，空态时回显访问地址
  const [lastSuccess, setLast] = useState<LastSuccess | null>(() => getLastSuccess(sessionId));
  // 最近一次失败记录：挂载时读入，空态时完整还原失败现场并支持重新部署
  const [lastFailure, setFail] = useState<LastFailure | null>(() => getLastFailure(sessionId));

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const inFlight = !terminal && (submitting || connected || !!payload);

  // 部署请求令牌 + 当前激活标签
  const deployReqToken = useWorkbenchStore((s) => s.deployReqToken);
  const activeTab = useWorkbenchStore((s) => s.workbenchTab);

  // 部署目录：取当前会话 workDir。可见且可手动改，
  // 用户改过后(dirTouchedRef)不再被会话目录变化覆盖。
  const [deployDir, setDeployDir] = useState<string>(workDir);
  const dirTouchedRef = useRef(false);
  useEffect(() => {
    if (dirTouchedRef.current) return;
    setDeployDir(workDir);
  }, [workDir]);
  const setDir = useCallback((v: string) => {
    dirTouchedRef.current = true;
    setDeployDir(v);
  }, []);

  // 打包指定目录，成功返回 { zipPath, hash, dirName }，失败返回 null（错误已写入 state）
  const pack = useCallback(async (dir: string) => {
    setSubmitError(null);
    setPackInfo(null);
    setEmptyDir(false);
    setPacking(true);
    try {
      const resp = await fetch("/api/workspace/pack-dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dir }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error || !data.zipPath) {
        // 空目录（全部被过滤）→ 友好空态，而非红色错误
        if (typeof data.error === "string" && data.error.startsWith("EMPTY_DIR:")) {
          setEmptyDir(true);
          return null;
        }
        setSubmitError(t("deploy.packFailed", { error: data.error || `HTTP ${resp.status}` }));
        return null;
      }
      setForm((f) => ({ ...f, packagePath: data.zipPath, deployId: data.hash, name: f.name || data.dirName }));
      setPackInfo(data.skipped
        ? t("deploy.packedFiltered", { count: data.fileCount, skipped: data.skipped })
        : t("deploy.packed", { count: data.fileCount }));
      return data as { zipPath: string; hash: string; dirName: string };
    } catch (e: any) {
      setSubmitError(t("deploy.packFailed", { error: e?.message ?? e }));
      return null;
    } finally {
      setPacking(false);
    }
  }, [t]);

  // 激活部署标签 / 切换目录时：只用目录名预填 name，并清空上一次的 zip 与提示，
  // 不再自动打包——打包推迟到用户点「部署」时再做（见 submit）。
  const lastDirRef = useRef<string>("");
  useEffect(() => {
    if (activeTab !== "deploy" || !deployDir || inFlight) return;
    const key = `${deployDir}@${deployReqToken}`;
    if (lastDirRef.current === key) return;
    lastDirRef.current = key;
    const base = deployDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
    setForm((f) => ({ ...f, packagePath: "", deployId: "", name: f.name || base }));
    setPackInfo(null);
  }, [activeTab, deployDir, deployReqToken, inFlight]);

  useEffect(() => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      saveForm(sessionId, form);
    }, 300);
    return () => clearTimeout(persistTimer.current);
  }, [form, sessionId]);

  // 挂载：若当前会话有「进行中」记录，直接订阅其 deployId 恢复进度（不重新打包/提交）。
  // 切回会话时本组件因外层 key 变化重建，由此自动接回上次部署。
  useEffect(() => {
    const active = getActiveDeploy(sessionId);
    if (active?.deployId) subscribe(active.deployId);
    // 仅挂载时执行一次；sessionId 变化由外层 key 触发重建，不在此响应
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 部署进入终态：清除该会话的进行中记录，避免下次切回又订阅已结束的任务。
  useEffect(() => {
    if (!terminal) return;
    clearActiveDeploy(sessionId);
    const st = payload?.status;
    const url = payload?.result?.publishedUrl || payload?.result?.url;
    const ok = st !== "failed" && st !== "stopped" && st !== "deleted";
    if (ok && url) {
      // 成功终态（非失败/停止/删除）且拿到访问地址 → 记录最近一次成功，供下次回显；
      // 同时清掉旧失败记录，避免成功后仍残留失败现场。
      const rec: LastSuccess = {
        url,
        name: form.name || payload?.deployId || "",
        deployId: payload?.deployId || form.deployId || "",
        ts: Date.now(),
      };
      setLastSuccess(sessionId, rec);
      setLast(rec);
      clearLastFailure(sessionId);
      setFail(null);
    } else if (st === "failed" && payload) {
      // 失败终态 → 持久化整个 payload，切回会话时完整还原失败现场并可重新部署。
      setLastFailure(sessionId, payload);
      setFail({ payload, ts: Date.now() });
    }
  }, [terminal, sessionId, payload, form.name, form.deployId]);

  // 卸载（含切走会话）时若仍在进行中：提示部署在后台继续，可切回查看。
  // 用 ref 让 cleanup 读到最新 inFlight，而非闭包里的旧值。
  const inFlightRef = useRef(inFlight);
  inFlightRef.current = inFlight;
  const leaveHintRef = useRef(t("deploy.leftBackground"));
  leaveHintRef.current = t("deploy.leftBackground");
  useEffect(() => {
    return () => {
      if (inFlightRef.current) showToast("warning", leaveHintRef.current);
    };
  }, []);

  const submit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    // 开始新一轮部署：先清掉上次失败现场，避免与本轮进度并存造成误读。
    clearLastFailure(sessionId);
    setFail(null);
    try {
      // 用户没手动指定 zip 时，先按部署目录打包，拿最新内容与 hash
      let packagePath = form.packagePath.trim();
      let deployId = form.deployId.trim();
      let name = form.name.trim();
      if (!packagePath) {
        const packed = await pack(deployDir);
        if (!packed) return; // pack 已写入错误提示
        packagePath = packed.zipPath;
        deployId = packed.hash;
        name = name || packed.dirName;
      }
      if (!packagePath || !deployId || !name) {
        setSubmitError(t("deploy.missingFields"));
        return;
      }
      const resp = await fetch("/api/deploy-agent/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packagePath, deployId, name }),
      });
      const data = await resp.json();
      // 202 新建 / 409 正在进行：两种情况都订阅事件流
      if (resp.status === 202 || (resp.status === 409 && data.status === "building")) {
        const activeId = data.deploymentId || deployId;
        setActiveDeploy(sessionId, activeId); // 记录进行中，供切走后切回自动恢复
        subscribe(activeId);
      } else {
        setSubmitError(data.error || data.message || t("deploy.submitFailedHttp", { status: resp.status }));
      }
    } catch (e: any) {
      setSubmitError(t("deploy.submitFailed", { error: e?.message ?? e }));
    } finally {
      setSubmitting(false);
    }
  };

  const inp = "w-full text-xs font-mono border border-border-200 rounded px-2 py-1 bg-bg-50 text-text-200";
  const canSubmit = !!deployDir.trim() && !inFlight && !packing;

  if (!workDir) {
    return <DeployEmptyState reason="noWorkDir" />;
  }

  if (emptyDir && !inFlight) {
    return (
      <div className="flex h-full flex-col">
        <DeployEmptyState reason="emptyDir" dir={deployDir} />
        <div className="px-6 pb-8 text-center">
          <button
            onClick={() => setEmptyDir(false)}
            className="text-xs px-3 py-1 rounded border border-border-200 text-text-300 hover:bg-bg-100"
          >{t("deploy.empty.back")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs font-semibold text-text-300">{t("deploy.auto")}</div>
      <PanelBody
        form={form} set={set} inp={inp} workDir={workDir}
        deployDir={deployDir} setDir={setDir}
        inFlight={inFlight} canSubmit={!!canSubmit} submitting={submitting} packing={packing}
        submit={submit} stop={stop}
        submitError={submitError} streamError={error}
        packInfo={packInfo}
        connected={connected} payload={payload} terminal={terminal}
        lastSuccess={lastSuccess}
        lastFailure={lastFailure}
      />
    </div>
  );
}

// 表单 + 操作 + 进度，拆分以控制单文件体量
function PanelBody(p: any) {
  const { t } = useLocale();
  const [advanced, setAdvanced] = useState(false);
  const dirName = (p.deployDir || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  return (
    <>
      {/* 主区：一句说明 + 目标目录，部署所需信息全部自动推导 */}
      <div className="space-y-1.5">
        <div className="text-xs text-text-300">{t("deploy.willDeploy", { name: dirName })}</div>
        <div className="rounded bg-bg-100 px-2 py-1 font-mono text-[11px] text-text-400 truncate">
          {p.deployDir}
        </div>
        {p.packing ? (
          <div className="text-blue-500 text-xs animate-pulse">{t("deploy.packing")}</div>
        ) : p.packInfo && (
          <div className="text-green-600 text-xs">✓ {p.packInfo}</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!p.inFlight ? (
          <button
            onClick={p.submit} disabled={!p.canSubmit}
            className="flex w-full items-center justify-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-2 rounded font-medium"
          >
            <span>🚀</span><span>{p.submitting ? t("deploy.submitting") : t("deploy.submit")}</span>
          </button>
        ) : (
          <>
            <span className="text-xs text-blue-500 animate-pulse">{t("deploy.inProgress")}</span>
            <button onClick={p.stop} className="text-xs bg-bg-200 text-text-300 px-2.5 py-1 rounded hover:bg-bg-300">
              {t("deploy.disconnect")}
            </button>
          </>
        )}
      </div>

      {/* 部署中常驻提示：明确部署在后台/云端进行，切走会话不影响，切回可继续查看 */}
      {p.inFlight && (
        <div className="rounded bg-blue-50 border border-blue-100 px-2 py-1.5 text-[11px] text-blue-600 leading-relaxed">
          {t("deploy.backgroundHint")}
        </div>
      )}

      {p.submitError && <div className="text-xs text-red-500">{p.submitError}</div>}
      {p.streamError && !p.submitError && <div className="text-xs text-red-500">{p.streamError}</div>}

      {/* 高级选项：默认折叠。改部署目录（子目录场景）/ 自定义名称 */}
      {!p.inFlight && (
        <div className="border-t border-border-100 pt-2">
          <button
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-text-400 hover:text-text-300"
          >
            <span>{advanced ? "▾" : "▸"}</span>
            <span>{t("deploy.advanced")}</span>
          </button>
          {advanced && (
            <div className="mt-2 space-y-2">
              <div>
                <div className="text-text-400 text-xs mb-0.5">{t("deploy.deployDirLabel")}</div>
                <input
                  className={p.inp} value={p.deployDir}
                  onChange={(e) => p.setDir(e.target.value)}
                  placeholder="C:\\Users\\you\\project"
                />
                <button
                  onClick={() => p.setDir(p.workDir)}
                  className="mt-1 text-[11px] px-2 py-0.5 rounded border border-border-200 text-text-400 hover:bg-bg-100"
                >{t("deploy.useWorkDir")}</button>
              </div>
              <div>
                <div className="text-text-400 text-xs mb-0.5">{t("deploy.nameLabel")}</div>
                <input
                  className={p.inp} value={p.form.name}
                  onChange={(e) => p.set("name", e.target.value)}
                  placeholder={t("deploy.namePlaceholder")}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 空态（无进行中部署、无当前进度）回显上次部署结果：
          成功 / 失败按时间戳谁新显示谁，避免二者并存造成误读。 */}
      {!p.inFlight && !p.payload && (() => {
        const fail = p.lastFailure as LastFailure | null;
        const succ = p.lastSuccess as LastSuccess | null;
        const showFail = fail && (!succ || fail.ts >= succ.ts);
        if (showFail) {
          return <LastFailureCard rec={fail!} onRedeploy={p.submit} canSubmit={p.canSubmit} />;
        }
        if (succ) {
          return <LastSuccessCard rec={succ} onRedeploy={p.submit} canSubmit={p.canSubmit} />;
        }
        return null;
      })()}

      <DeployProgressView payload={p.payload} connected={p.connected} terminal={p.terminal} />
    </>
  );
}

// ISO/时间戳 → 2026-06-23 15:22
function fmtTs(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 上次部署成功卡片：访问地址（可点）+ 完成时间 + 重新部署
function LastSuccessCard(p: { rec: LastSuccess; onRedeploy: () => void; canSubmit: boolean }) {
  const { t } = useLocale();
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
        <span>✓</span><span>{t("deploy.lastSuccess")}</span>
      </div>
      <a
        href={p.rec.url} target="_blank" rel="noreferrer"
        className="block text-xs text-accent-brand underline break-all"
      >{p.rec.url}</a>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-text-400">{t("deploy.deployedAt", { time: fmtTs(p.rec.ts) })}</span>
        <button
          onClick={p.onRedeploy} disabled={!p.canSubmit}
          className="text-[11px] px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-40"
        >{t("deploy.redeploy")}</button>
      </div>
    </div>
  );
}

// 上次部署失败卡片：红色横幅（标题 + 失败时间 + 重新部署）+ 复用 DeployProgressView
// 以终态还原失败现场（诊断建议 / 阶段时间线 / 终端输出）。
function LastFailureCard(p: { rec: LastFailure; onRedeploy: () => void; canSubmit: boolean }) {
  const { t } = useLocale();
  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
            <span>⚠</span><span>{t("deploy.lastFailure")}</span>
          </div>
          <button
            onClick={p.onRedeploy} disabled={!p.canSubmit}
            className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-100 disabled:opacity-40"
          >{t("deploy.redeploy")}</button>
        </div>
        <span className="text-[10px] text-text-400">{t("deploy.failedAt", { time: fmtTs(p.rec.ts) })}</span>
      </div>
      {/* 终态还原：terminal=true 让进度视图按失败终态渲染标题/建议/阶段/终端输出 */}
      <DeployProgressView payload={p.rec.payload} connected={false} terminal />
    </div>
  );
}

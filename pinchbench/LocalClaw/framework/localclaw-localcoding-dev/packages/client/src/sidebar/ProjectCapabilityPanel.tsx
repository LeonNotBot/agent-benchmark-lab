// 项目能力浮层：入口在项目 ··· 菜单的「查看能力」项 → 从项目行右侧弹出卡片，
// 展示 .claude 的命令/子代理/技能/规则/知识库。
// 用 Portal(挂到 body) + fixed 定位：侧边栏是 overflow-hidden/auto，
// 若用行内 absolute 会被裁掉看不见——故渲到 body、按锚点行的视口坐标定位。
// 懒加载（首次打开才扫描）+ 缓存 + 骨架屏。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectCapabilities } from "@lenovo/agent-protocol";
import { apiScanProjectCapabilities } from "../api/project-capability";
import { useAppStore } from "../store/useAppStore";
import { useThreadStore } from "../thread/store";
import { CapabilitySections } from "./CapabilitySections";

const capCache = new Map<string, ProjectCapabilities>();

/** 使某项目的能力缓存失效（scaffold/导入后调用，下次打开浮层会重扫）。 */
export function invalidateCapabilityCache(path: string): void {
  capCache.delete(path);
}

export function ProjectCapabilityFlyout({
  path, open, onOpenChange, anchorRef,
}: {
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 定位锚点：项目行 DOM，浮层贴其右侧、顶端对齐。 */
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [caps, setCaps] = useState<ProjectCapabilities | null>(() => capCache.get(path) ?? null);
  const [loading, setLoading] = useState(false);
  const setDefaultWorkspace = useAppStore((s) => s.setDefaultWorkspace);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const setDraftForSession = useThreadStore((s) => s.setDraftForSession);
  const aliveRef = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 打开时按锚点行的视口坐标定位（贴右侧、顶端对齐）。
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top, left: r.right + 4 });
  }, [open, anchorRef]);

  // 渲染后按实际高度做垂直钳制：底端超出视口则上移贴底（留 8px 边距），
  // 顶端不越过视口顶。避免项目行靠下时浮层被下方裁掉（见 docs/images/1.png）。
  useEffect(() => {
    if (!open || !pos) return;
    const panel = panelRef.current;
    if (!panel) return;
    const MARGIN = 8;
    const h = panel.offsetHeight;
    const maxTop = window.innerHeight - h - MARGIN;
    const clamped = Math.max(MARGIN, Math.min(pos.top, maxTop));
    if (clamped !== pos.top) setPos((p) => (p ? { ...p, top: clamped } : p));
  }, [open, pos, caps, loading]);

  // SWR：打开时先显缓存（无闪烁），同时后台重拉，有变化静默刷新。
  // 陈旧自愈——导入/scaffold 改了磁盘也无需手动失效缓存，每次打开都会校正。
  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    const cached = capCache.get(path) ?? null;
    setCaps(cached);
    // 仅在无缓存可显时才亮骨架屏；有缓存则静默后台刷新。
    setLoading(!cached);
    apiScanProjectCapabilities(path)
      .then((res) => {
        if (!aliveRef.current || !res) return;
        capCache.set(path, res);
        // 仅在内容变化时 setState，避免无谓重渲染。
        setCaps((prev) => (JSON.stringify(prev) === JSON.stringify(res) ? prev : res));
      })
      .finally(() => { if (aliveRef.current) setLoading(false); });
    return () => { aliveRef.current = false; };
  }, [open, path]);

  // 打开时：点击外部 / Esc → 关闭。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    // 延后一帧挂载，避开打开这一次点击自身触发的 mousedown。
    const id = requestAnimationFrame(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  // 点命令/技能 → 在该项目新建会话并预填 /xxx，然后关闭浮层。
  const runIn = (insert: string) => {
    setDefaultWorkspace(path);
    setActiveSessionId(null);
    setDraftForSession("__new__", `/${insert} `);
    onOpenChange(false);
  };

  if (!open || !pos) return null;

  // Portal 到 body + fixed：脱离侧边栏 overflow 裁剪。
  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      className="z-[9999] max-h-[420px] w-[280px] overflow-y-auto rounded-xl border border-border-300 bg-bg-000 py-2 text-[13px] shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <CapabilitySections loading={loading} caps={caps} onRun={runIn} />
    </div>,
    document.body,
  );
}

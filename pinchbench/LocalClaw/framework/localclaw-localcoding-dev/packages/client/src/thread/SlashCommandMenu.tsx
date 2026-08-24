// 斜杠命令补全面板（样式参考 docs/images/12.png、13.png）：
// 贴输入框的大列表，分组标题 + 六边形图标行 + 右侧来源标签，选中整行高亮。
// 数据源：项目 .claude 的命令 + 可主动调用的技能（对齐 claude-cli 原生 / 行为）。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectCapabilities } from "@lenovo/agent-protocol";
import { apiScanProjectCapabilities } from "../api/project-capability";
import { useLocale } from "../i18n";
import { SlashMenuBody } from "./SlashMenuBody";

/** 面板里的一个可选项（命令或技能统一结构）。 */
export interface SlashItem {
  /** 插入输入框的文本，不含前导 /，如 "fw:build"。 */
  insert: string;
  /** 展示名。 */
  label: string;
  description?: string;
  /** 分组：命令 / 技能。 */
  kind: "command" | "skill";
}

interface Props {
  cwd: string | undefined;
  /** `/` 之后的过滤词（不含 /）。 */
  filter: string;
  /** 弹出方向：up = 面板在输入框上方（12.png）；down = 下方（13.png）。 */
  direction: "up" | "down";
  /** 选中某项 → 回填输入框。 */
  onSelect: (item: SlashItem) => void;
  /** 请求关闭（Esc / 失焦）。 */
  onClose: () => void;
  /** 受控高亮索引（键盘导航，由 Composer 统一管理）。 */
  activeIndex: number;
  /** 扁平化后的选项列表变化时通知 Composer（用于键盘导航边界）。 */
  onItemsChange: (items: SlashItem[]) => void;
  /** 输入框元素：点击其上不关闭浮层（用户还在编辑命令词）。 */
  anchorEl?: HTMLElement | null;
  /** 定位锚点：浮层贴其下方/上方、与之等宽。缺省用 anchorEl。传整张输入卡片，
   *  避免浮层压在卡片内工具栏上（见 docs/images/1.png）。 */
  positionEl?: HTMLElement | null;
}

/** 把扫描结果转成扁平选项：命令在前，可主动调用的技能在后。 */
function toItems(caps: ProjectCapabilities | null): SlashItem[] {
  if (!caps) return [];
  const cmds: SlashItem[] = caps.commands.map((c) => ({
    insert: c.name, label: c.name, description: c.description, kind: "command",
  }));
  const skills: SlashItem[] = caps.skills
    .filter((s) => s.userInvocable !== false && !s.disabled)
    .map((s) => ({
      insert: s.name, label: s.displayName || s.name, description: s.description, kind: "skill",
    }));
  return [...cmds, ...skills];
}

export function SlashCommandMenu({
  cwd, filter, direction, onSelect, onClose, activeIndex, onItemsChange, anchorEl, positionEl,
}: Props) {
  const { t } = useLocale();
  const [caps, setCaps] = useState<ProjectCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, ProjectCapabilities>>(new Map());

  // 拉取能力（按 cwd 缓存到组件内，避免每次开面板都请求；后端另有 5s 缓存兜底）。
  useEffect(() => {
    if (!cwd) { setCaps(null); return; }
    const cached = cacheRef.current.get(cwd);
    if (cached) { setCaps(cached); return; }
    let alive = true;
    setLoading(true);
    apiScanProjectCapabilities(cwd)
      .then((res) => {
        if (!alive) return;
        if (res) cacheRef.current.set(cwd, res);
        setCaps(res);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [cwd]);

  // 过滤 + 分组。
  const items = useMemo(() => {
    const all = toItems(caps);
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter(
      (it) => it.label.toLowerCase().includes(f) || it.insert.toLowerCase().includes(f),
    );
  }, [caps, filter]);

  // 列表变化通知 Composer（键盘导航需要知道总数）。
  useEffect(() => { onItemsChange(items); }, [items, onItemsChange]);

  // Portal + fixed 定位：脱离 composer/首页容器的 overflow 裁剪（首页输入框垂直居中，
  // absolute 浮层会被祖先裁掉底部，见 docs/images/1.png）。按输入框视口坐标 + 上下
  // 剩余空间动态定位、限高、择向。
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  useEffect(() => {
    const el = positionEl ?? anchorEl;
    if (!el) { setBox(null); return; }
    const measure = () => {
      const r = el.getBoundingClientRect();
      const GAP = 8, MARGIN = 12;
      const below = window.innerHeight - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      let dir = direction;
      if (dir === "down" && below < 220 && above > below) dir = "up";
      if (dir === "up" && above < 220 && below > above) dir = "down";
      const avail = dir === "down" ? below : above;
      const maxH = Math.max(140, Math.min(340, avail));
      setBox(dir === "down"
        ? { left: r.left, width: r.width, top: r.bottom + GAP, maxH }
        : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + GAP, maxH });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchorEl, positionEl, direction, items.length]);

  // 点击浮层外部（且不在输入框上）→ 关闭。延后一帧挂载，避开触发打开的那次点击。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      // 点在输入框上不关闭（用户还在编辑 / 命令词）。
      if (anchorEl && anchorEl.contains(target)) return;
      onClose();
    };
    const id = requestAnimationFrame(() => document.addEventListener("mousedown", onDown));
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDown);
    };
  }, [anchorEl, onClose]);

  if (!box) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: box.left,
        width: box.width,
        top: box.top,
        bottom: box.bottom,
        maxHeight: box.maxH,
      }}
      className="z-[9999] overflow-y-auto rounded-xl border border-border-300 bg-bg-000 py-2 shadow-lg"
      role="listbox"
    >
      <SlashMenuBody
        loading={loading} items={items} activeIndex={activeIndex}
        onSelect={onSelect} emptyText={t("slashCommand.empty")}
        commandTitle={t("projectCapability.commands")} skillTitle={t("projectCapability.skills")}
        sourceProject={t("slashCommand.sourceProject")}
      />
    </div>,
    document.body,
  );
}

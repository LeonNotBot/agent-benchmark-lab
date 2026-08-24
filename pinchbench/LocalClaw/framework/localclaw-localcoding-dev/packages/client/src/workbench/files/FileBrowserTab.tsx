import { useState, useEffect, useCallback, useRef } from "react";
import MDContent from "../../render/markdown";
import { useLocale } from "../../i18n";
import { workspaceFileEventBus } from "../../events/workspaceFileEventBus";
import { normalizePath } from "../../utils/browserPreview";
import { SplitFileLayout } from "../SplitFileLayout";
import { CodePreview, CODE_LANGS, getExt } from "../CodePreview";
import type { ClientEvent } from "@lenovo/agent-protocol";

type PreviewKind = "code" | "image" | "markdown" | "text" | "pdf" | "docx" | "binary" | "unsupported";
interface PreviewData {
  kind: PreviewKind;
  content: string;
  language?: string;
  notes?: string[];
}

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const MD_EXTS = new Set(["md", "markdown"]);
const PDF_EXTS = new Set(["pdf"]);
const HTML_EXTS = new Set(["html", "htm"]);
const DOCX_EXTS = new Set(["docx"]);
const UNSUPPORTED_OFFICE_EXTS = new Set(["doc", "xls", "xlsx", "ppt", "pptx", "numbers", "pages", "key"]);

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  expanded?: boolean;
  children?: FileNode[];
}

interface Props {
  workDir: string;
  sendEvent?: (event: ClientEvent) => void;
}

/** 取父目录路径（规范化后）。 */
function parentDir(p: string): string {
  const n = normalizePath(p);
  return n.substring(0, n.lastIndexOf("/"));
}

async function fetchTree(path: string): Promise<FileNode[]> {
  const res = await fetch(`/api/workspace/tree?path=${encodeURIComponent(path)}&depth=1`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.nodes ?? []) as FileNode[];
}

async function fetchFileContent(path: string, cannotReadMsg: string): Promise<{ content: string; encoding: string }> {
  const res = await fetch(`/api/workspace/file-content?path=${encodeURIComponent(path)}`);
  if (!res.ok) return { content: cannotReadMsg, encoding: "utf8" };
  return res.json();
}

async function fetchFileBase64(path: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(`/api/workspace/file-content-base64?path=${encodeURIComponent(path)}`);
  if (!res.ok) return { base64: "", mimeType: "" };
  const data = await res.json();
  if (data.error) return { base64: "", mimeType: "" };
  return { base64: data.base64 ?? "", mimeType: data.mime ?? "" };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function renderDocxPreview(base64: string, fallbackNote: string): Promise<{ html: string; notes: string[] }> {
  const mammoth = await import("mammoth/mammoth.browser");
  const arrayBuffer = base64ToArrayBuffer(base64);
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value?.trim();

  if (html) {
    return {
      html,
      notes: (result.messages ?? []).map((message) => `${message.type}: ${message.message}`),
    };
  }

  const rawTextResult = await mammoth.extractRawText({ arrayBuffer });
  return {
    html: (rawTextResult.value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
      .join(""),
    notes: [
      ...((result.messages ?? []).map((message) => `${message.type}: ${message.message}`)),
      `info: ${fallbackNote}`,
    ],
  };
}

const FILE_EXT_ICONS: Record<string, string> = {
  ts: "📜", tsx: "⚛️", js: "📜", jsx: "⚛️", py: "🐍", go: "🔵",
  json: "📋", md: "📝", txt: "📄", html: "🌐", css: "🎨",
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️", svg: "🖼️", gif: "🖼️",
  sh: "⚙️", yaml: "📋", yml: "📋", toml: "📋", pdf: "📕",
  docx: "📝", doc: "📝", xls: "📗", xlsx: "📗", csv: "📗",
  ppt: "📙", pptx: "📙", log: "📄", xml: "🧾",
};

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_EXT_ICONS[ext] ?? "📄";
}

function FileTreeNode({
  node,
  depth,
  onSelectFile,
  selectedPath,
}: {
  node: FileNode;
  depth: number;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[] | undefined>(undefined);

  const handleClick = async () => {
    if (node.isDir) {
      if (!expanded && children === undefined) {
        const nodes = await fetchTree(node.path);
        setChildren(nodes);
      }
      setExpanded((v) => !v);
    } else {
      onSelectFile(node.path);
    }
  };

  // 订阅文件系统事件：当变更发生在「本目录的直接子级」且本目录已加载过 children 时，
  // 重新拉取本层级。只刷新受影响的那一层,其他节点的展开态/children 不受扰动（避免闪烁）。
  useEffect(() => {
    if (!node.isDir) return;
    const myPath = normalizePath(node.path);

    const refreshIfAffected = (payload: { path: string }) => {
      // 仅当 children 已加载（展开过）才需要刷新；未加载的目录下次展开自然拿到最新。
      if (children === undefined) return;
      if (parentDir(payload.path) !== myPath) return;
      fetchTree(node.path).then(setChildren).catch(() => {});
    };

    const unsubAdded = workspaceFileEventBus.on("workspace.file.added", refreshIfAffected);
    const unsubDeleted = workspaceFileEventBus.on("workspace.file.deleted", refreshIfAffected);
    return () => {
      unsubAdded();
      unsubDeleted();
    };
  }, [node.isDir, node.path, children]);

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-bg-200 rounded text-sm
          ${!node.isDir && selectedPath === node.path ? "bg-purple-light2 text-accent-text" : "text-text-200"}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={handleClick}
      >
        {node.isDir ? (
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-text-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0">{fileIcon(node.name, node.isDir)}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDir && expanded && children && (
        <div>
          {children.length === 0 ? (
            <div className="text-xs text-text-400 pl-10 py-0.5">{t("files.emptyDir")}</div>
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── 搜索结果树 ────────────────────────────────
// 把扁平搜索结果（含 relativePath）构建成「只含匹配文件及其祖先目录」的树，
// 并对单链目录做路径压缩（如 assistant/myauiapp 合并为一个节点），贴近 IDE 搜索结果观感。
interface SearchNode {
  name: string;         // 显示名（目录为压缩后的相对段，如 "assistant/myauiapp"）
  path: string;         // 绝对路径（文件用于选中，目录用于 key）
  isDir: boolean;
  relativePath: string; // 文件的相对路径（用于 title）
  children: SearchNode[];
}

function buildSearchTree(
  results: Array<{ name: string; path: string; relativePath: string; isDir: boolean }>,
  rootDir: string,
): SearchNode[] {
  interface MutNode {
    name: string;
    path: string;
    childrenMap: Map<string, MutNode>;
    childFiles: SearchNode[];
  }
  const rootBase = rootDir.replace(/[\\/]+$/, "");
  const makeDir = (name: string, path: string): MutNode => ({
    name, path, childrenMap: new Map(), childFiles: [],
  });
  const root = makeDir("", rootBase);

  for (const r of results) {
    if (r.isDir) continue;
    const segs = r.relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segs.pop() ?? r.name;
    let cur = root;
    let curPath = rootBase;
    for (const seg of segs) {
      curPath = `${curPath}/${seg}`;
      let next = cur.childrenMap.get(seg);
      if (!next) {
        next = makeDir(seg, curPath);
        cur.childrenMap.set(seg, next);
      }
      cur = next;
    }
    cur.childFiles.push({
      name: fileName, path: r.path, isDir: false, relativePath: r.relativePath, children: [],
    });
  }

  // 递归转换 + 单链目录压缩（当前目录只有 1 个子目录且无直接文件 → 合并名字）
  const finalize = (node: MutNode): SearchNode[] => {
    const dirs: SearchNode[] = [];
    for (const child of node.childrenMap.values()) {
      let label = child.name;
      let cur = child;
      while (cur.childrenMap.size === 1 && cur.childFiles.length === 0) {
        const only = cur.childrenMap.values().next().value as MutNode;
        label = `${label}/${only.name}`;
        cur = only;
      }
      dirs.push({
        name: label,
        path: cur.path,
        isDir: true,
        relativePath: "",
        children: [...finalize(cur), ...cur.childFiles],
      });
    }
    return dirs;
  };

  return [...finalize(root), ...root.childFiles];
}

// 搜索结果树节点：目录默认展开，可折叠；文件点击预览。样式对齐 FileTreeNode。
function SearchTreeNode({
  node,
  depth,
  onSelectFile,
  selectedPath,
}: {
  node: SearchNode;
  depth: number;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = !node.isDir && selectedPath === node.path;
  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-bg-200 rounded text-sm
          ${isSelected ? "bg-purple-light2 text-accent-text" : "text-text-200"}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => (node.isDir ? setExpanded((v) => !v) : onSelectFile(node.path))}
        title={node.isDir ? node.name : node.relativePath}
      >
        {node.isDir ? (
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-text-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0">{fileIcon(node.name, node.isDir)}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDir && expanded && node.children.map((child) => (
        <SearchTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          onSelectFile={onSelectFile}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

export function FileBrowserTab({ workDir, sendEvent }: Props) {
  const { t } = useLocale();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [filter, setFilter] = useState("");
  // 全树递归搜索结果（filter 非空时展示扁平结果，替代目录树）
  const [searchResults, setSearchResults] = useState<Array<{ name: string; path: string; relativePath: string; isDir: boolean }>>([]);
  const [searching, setSearching] = useState(false);
  // 版本计数器：每次 loadPreview 调用递增，完成时检查版本仍是自己才 setPreview，
  // 防止慢速 async 在用户切换文件后覆盖新文件的预览内容。
  const previewVersionRef = useRef(0);

  const loadRoots = useCallback(async () => {
    if (!workDir) return;
    setLoading(true);
    const nodes = await fetchTree(workDir);
    setRoots(nodes);
    setLoading(false);
  }, [workDir]);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  // 切换工作目录（切 session）时重置选中文件与预览，避免残留上一个 session 的文件预览。
  useEffect(() => {
    setSelectedPath(null);
    setPreview(null);
    setFileLoading(false);
    previewVersionRef.current += 1; // 作废在途的 loadPreview，防止其回填旧内容
  }, [workDir]);

  // 发送 watch 订阅 / unwatch 取消，跟随 workDir 变化或组件卸载。
  useEffect(() => {
    if (!workDir || !sendEvent) return;
    sendEvent({ type: "workspace.watch", payload: { path: workDir } });
    return () => {
      sendEvent({ type: "workspace.unwatch", payload: { path: workDir } });
    };
  }, [workDir, sendEvent]);

  // 订阅根层级的文件变更事件，当变更发生在 workDir 的直接子级时重新拉取根列表。
  useEffect(() => {
    if (!workDir) return;
    const myPath = normalizePath(workDir);

    const refreshRootsIfAffected = (payload: { path: string }) => {
      if (parentDir(payload.path) !== myPath) return;
      loadRoots();
    };

    const unsubAdded = workspaceFileEventBus.on("workspace.file.added", refreshRootsIfAffected);
    const unsubDeleted = workspaceFileEventBus.on("workspace.file.deleted", refreshRootsIfAffected);
    return () => {
      unsubAdded();
      unsubDeleted();
    };
  }, [workDir, loadRoots]);

  // 加载并渲染某个文件的预览内容。silent=true 时不清空当前预览、不显示 loading，
  // 用于磁盘变更后的「原地刷新」，避免内容闪烁。
  const loadPreview = useCallback(async (path: string, silent = false) => {
    const myVersion = ++previewVersionRef.current;
    const isCurrent = () => previewVersionRef.current === myVersion;
    if (!silent) {
      setFileLoading(true);
      setPreview(null);
    }
    const ext = getExt(path.split(/[\\/]/).pop() ?? "");
    try {
      if (IMG_EXTS.has(ext)) {
        const { base64, mimeType } = await fetchFileBase64(path);
        if (isCurrent()) setPreview(base64 ? { kind: "image", content: `data:${mimeType};base64,${base64}` } : { kind: "binary", content: "" });
      } else if (PDF_EXTS.has(ext)) {
        const { base64 } = await fetchFileBase64(path);
        if (isCurrent()) setPreview(base64 ? { kind: "pdf", content: `data:application/pdf;base64,${base64}` } : { kind: "binary", content: "" });
      } else if (HTML_EXTS.has(ext)) {
        // HTML 直接以源码高亮展示，不再用 iframe 当网页加载
        const { content, encoding } = await fetchFileContent(path, t("files.cannotRead"));
        if (isCurrent()) setPreview(encoding === "binary"
          ? { kind: "binary", content: "" }
          : { kind: "code", content, language: "xml" });
      } else if (DOCX_EXTS.has(ext)) {
        const { base64 } = await fetchFileBase64(path);
        if (!base64) {
          if (isCurrent()) setPreview({ kind: "binary", content: "" });
        } else {
          const { html, notes } = await renderDocxPreview(base64, t("files.docxFallback"));
          if (isCurrent()) setPreview({ kind: "docx", content: html, notes });
        }
      } else if (MD_EXTS.has(ext)) {
        const { content } = await fetchFileContent(path, t("files.cannotRead"));
        if (isCurrent()) setPreview({ kind: "markdown", content });
      } else if (CODE_LANGS[ext]) {
        const { content, encoding } = await fetchFileContent(path, t("files.cannotRead"));
        if (isCurrent()) setPreview(encoding === "binary"
          ? { kind: "binary", content: "" }
          : { kind: "code", content, language: CODE_LANGS[ext] });
      } else if (UNSUPPORTED_OFFICE_EXTS.has(ext)) {
        if (isCurrent()) setPreview({
          kind: "unsupported",
          content: t("files.officeUnsupported"),
          notes: [t("files.officeNote")],
        });
      } else {
        const { content, encoding } = await fetchFileContent(path, t("files.cannotRead"));
        if (isCurrent()) setPreview(encoding === "binary" ? { kind: "binary", content: "" } : { kind: "text", content });
      }
    } catch {
      if (isCurrent()) setPreview({ kind: "unsupported", content: t("files.previewFailed") });
    }
    if (isCurrent()) setFileLoading(false);
  }, [t]);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path);
    loadPreview(path);
  }, [loadPreview]);

  // 筛选关键词变化时做全树递归搜索（250ms 防抖）；清空则回到目录树视图。
  useEffect(() => {
    const q = filter.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/workspace/search?cwd=${encodeURIComponent(workDir)}&q=${encodeURIComponent(q)}`);
        const data = await r.json();
        if (!cancelled) setSearchResults(data.results ?? []);
      } catch {
        if (!cancelled) setSearchResults([]);
      }
      if (!cancelled) setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filter, workDir]);

  // 用系统默认程序打开当前文件
  const openDefaultApp = useCallback(() => {
    if (!selectedPath) return;
    fetch("/api/workspace/open-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedPath }),
    }).catch(() => {});
  }, [selectedPath]);

  // 打开所在文件夹并选中当前文件
  const revealInFolder = useCallback(() => {
    if (!selectedPath) return;
    fetch("/api/workspace/reveal-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedPath }),
    }).catch(() => {});
  }, [selectedPath]);

  // 订阅文件内容变更：当变更发生在「当前已打开预览的文件」上时，原地静默刷新预览内容。
  useEffect(() => {
    if (!selectedPath) return;
    const myPath = normalizePath(selectedPath);
    const refreshIfCurrent = (payload: { path: string }) => {
      if (normalizePath(payload.path) !== myPath) return;
      loadPreview(selectedPath, true);
    };
    return workspaceFileEventBus.on("workspace.file.changed", refreshIfCurrent);
  }, [selectedPath, loadPreview]);

  if (!workDir) {
    return <div className="p-4 text-xs text-text-400 text-center">{t("deploy.noWorkDir")}</div>;
  }

  // 左侧预览区：未选中时显示空态，选中后按类型渲染
  const previewNode = !selectedPath ? (
    <EmptyPreview />
  ) : (
    <div className="p-2">
      {fileLoading ? (
        <div className="text-xs text-text-400">{t("files.loading")}</div>
      ) : preview?.kind === "pdf" ? (
        <iframe src={preview.content} className="w-full h-full min-h-[500px] rounded border-0" title={t("files.pdfPreview")} />
      ) : preview?.kind === "docx" ? (
        <div className="space-y-3 rounded bg-white p-3">
          {preview.notes?.length ? (
            <div className="rounded-lg border border-border-200 bg-bg-100 px-3 py-2 text-[11px] text-text-400">
              {preview.notes[0]}
            </div>
          ) : null}
          <div
            className="prose prose-sm max-w-none text-[12px] text-text-200 [&_p]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border-200 [&_td]:p-2 [&_th]:border [&_th]:border-border-200 [&_th]:bg-bg-100 [&_th]:p-2 [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: preview.content || `<p>${t("files.noPreviewContent")}</p>` }}
          />
        </div>
      ) : preview?.kind === "code" ? (
        <CodePreview content={preview.content} language={preview.language} />
      ) : preview?.kind === "image" ? (
        <img src={preview.content} alt="" className="max-w-full rounded" />
      ) : preview?.kind === "markdown" ? (
        <div className="prose prose-sm max-w-none text-[12px]"><MDContent text={preview.content} /></div>
      ) : preview?.kind === "unsupported" ? (
        <div className="rounded-lg border border-border-200 bg-bg-100 px-4 py-4 text-sm text-text-300">
          <div>{preview.content}</div>
          {preview.notes?.length ? (
            <div className="mt-2 text-xs text-text-400">{preview.notes.join(" ")}</div>
          ) : null}
        </div>
      ) : preview?.kind === "binary" ? (
        <div className="text-xs text-text-400">{t("files.binaryFile")}</div>
      ) : (
        <pre className="text-[11px] font-mono text-text-200 whitespace-pre-wrap break-all leading-5">
          {preview?.content}
        </pre>
      )}
    </div>
  );

  const isSearching = filter.trim().length > 0;

  // 右侧列表：刷新按钮 +（筛选时）全树搜索结果 /（否则）目录树
  const listNode = (
    <div className="py-1">
      {isSearching ? (
        searching ? (
          <div className="text-xs text-text-400 p-4 text-center">{t("files.searching")}</div>
        ) : searchResults.length === 0 ? (
          <div className="text-xs text-text-400 p-4 text-center">{t("files.searchEmpty")}</div>
        ) : (
          buildSearchTree(searchResults, workDir).map((node) => (
            <SearchTreeNode
              key={node.path}
              node={node}
              depth={0}
              onSelectFile={handleSelectFile}
              selectedPath={selectedPath}
            />
          ))
        )
      ) : loading ? (
        <div className="text-xs text-text-400 p-4 text-center">{t("files.loading")}</div>
      ) : roots.length === 0 ? (
        <div className="text-xs text-text-400 p-4 text-center">{t("files.dirEmpty")}</div>
      ) : (
        roots.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            onSelectFile={handleSelectFile}
            selectedPath={selectedPath}
          />
        ))
      )}
    </div>
  );

  return (
    <SplitFileLayout
      filePath={selectedPath}
      rootDir={workDir}
      preview={previewNode}
      list={listNode}
      filter={filter}
      onFilterChange={setFilter}
      onOpenDefaultApp={openDefaultApp}
      onRevealInFolder={revealInFolder}
    />
  );
}

// 未选中文件时的空态（对齐 2.png）
function EmptyPreview() {
  const { t } = useLocale();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <svg viewBox="0 0 24 24" className="h-12 w-12 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      </svg>
      <div className="text-sm font-medium text-text-200">{t("files.emptyTitle")}</div>
      <div className="text-xs text-text-400">{t("files.emptyHint")}</div>
    </div>
  );
}

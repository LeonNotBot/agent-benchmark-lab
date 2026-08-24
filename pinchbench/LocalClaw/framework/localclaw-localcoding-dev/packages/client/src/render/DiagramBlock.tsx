import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import {
  DIAGRAM_DEFAULT_ZOOM,
  DIAGRAM_MAX_ZOOM,
  DIAGRAM_MIN_ZOOM,
  clampDiagramZoom,
  getButtonZoom,
  getDiagramFitZoom,
  getDraggedPan,
  getNextDiagramZoom,
  getPinchZoom,
  getTouchDistance,
  shouldHandleDiagramWheelZoom,
} from "./diagramZoom.js";

type MermaidModule = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
  parse?: (text: string, options?: Record<string, unknown>) => Promise<unknown>;
};

type MermaidErrorInfo = {
  summary: string;
  details: string[];
  diagnosticText: string;
};

type DiagramPan = {
  x: number;
  y: number;
};

type TouchPoint = {
  clientX: number;
  clientY: number;
};

let mermaidPromise: Promise<MermaidModule> | null = null;
let mermaidInitialized = false;

function getMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => (mod.default ?? mod) as MermaidModule);
  }
  return mermaidPromise;
}

function looksLikeSvg(markup: string): boolean {
  const trimmed = markup.trim();
  return /^<svg[\s>]/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed);
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getTimestampLabel(): string {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function useCopyAction() {
  const [copied, setCopied] = useState(false);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      setCopied(false);
    }
  }

  return {
    copied,
    copyText,
  };
}

function DiagramActionButton(
  { label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-border-300/80 bg-bg-000/85 px-3 py-1.5 text-xs font-medium text-text-200 transition hover:border-slate-400 hover:bg-bg-000 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function DiagramCard(
  {
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
  },
) {
  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border-200 bg-gradient-to-br from-bg-100 via-bg-000 to-bg-100 shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-200/80 bg-bg-000/80 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[0.12em] text-text-200 uppercase">{title}</div>
          <div className="mt-1 text-xs text-text-400">{subtitle}</div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:24px_24px] p-4 sm:p-5">
        <div className="overflow-auto rounded-2xl border border-border-200 bg-bg-000/90 p-4 shadow-inner shadow-slate-200/60 [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:w-full">
          {children}
        </div>
      </div>
    </section>
  );
}

function DiagramPreviewSurface(
  { onOpen, children }: { onOpen: () => void; children: React.ReactNode },
) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full cursor-zoom-in rounded-2xl text-left transition hover:opacity-95"
      aria-label={t("diagram.fullscreenView")}
    >
      {children}
    </button>
  );
}

function DiagramLightbox(
  {
    open,
    title,
    subtitle,
    markup,
    onClose,
  }: {
    open: boolean;
    title: string;
    subtitle: string;
    markup: string;
    onClose: () => void;
  },
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { t } = useLocale();
  const zoomRef = useRef(DIAGRAM_DEFAULT_ZOOM);
  const fitZoomRef = useRef(DIAGRAM_DEFAULT_ZOOM);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const touchPointsRef = useRef(new Map<number, TouchPoint>());
  const pinchStateRef = useRef<{
    startDistance: number;
    startZoom: number;
  } | null>(null);
  const [zoom, setZoom] = useState(DIAGRAM_DEFAULT_ZOOM);
  const [fitZoom, setFitZoom] = useState(DIAGRAM_DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);

  zoomRef.current = zoom;
  fitZoomRef.current = fitZoom;

  useEffect(() => {
    if (!open) {
      return;
    }

    setZoom(DIAGRAM_DEFAULT_ZOOM);
    setFitZoom(DIAGRAM_DEFAULT_ZOOM);
    setIsDragging(false);
    dragStateRef.current = null;
    pinchStateRef.current = null;
    touchPointsRef.current.clear();

    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport) {
        return;
      }

      if (content) {
        const contentRect = content.getBoundingClientRect();
        const nextFitZoom = getDiagramFitZoom({
          viewportWidth: viewport.clientWidth,
          viewportHeight: viewport.clientHeight,
          contentWidth: contentRect.width / zoomRef.current,
          contentHeight: contentRect.height / zoomRef.current,
        });

        fitZoomRef.current = nextFitZoom;
        setFitZoom(nextFitZoom);
        setZoom(nextFitZoom);
      }

      window.requestAnimationFrame(() => {
        const currentViewport = viewportRef.current;
        if (!currentViewport) {
          return;
        }
        currentViewport.scrollLeft = 0;
        currentViewport.scrollTop = 0;
      });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, markup, onClose]);

  if (!open) {
    return null;
  }

  function applyZoom(nextZoom: number, anchor?: DiagramPan) {
    const viewport = viewportRef.current;
    const currentZoom = zoomRef.current;
    const safeNextZoom = clampDiagramZoom(nextZoom);

    if (!viewport) {
      setZoom(safeNextZoom);
      return;
    }

    if (currentZoom === safeNextZoom) {
      return;
    }

    const safeAnchor = anchor ?? {
      x: viewport.clientWidth / 2,
      y: viewport.clientHeight / 2,
    };
    const worldX = (viewport.scrollLeft + safeAnchor.x) / currentZoom;
    const worldY = (viewport.scrollTop + safeAnchor.y) / currentZoom;

    setZoom(safeNextZoom);
    window.requestAnimationFrame(() => {
      const currentViewport = viewportRef.current;
      if (!currentViewport) {
        return;
      }

      currentViewport.scrollLeft = Math.max(0, worldX * safeNextZoom - safeAnchor.x);
      currentViewport.scrollTop = Math.max(0, worldY * safeNextZoom - safeAnchor.y);
    });
  }

  function syncTouchPoint(pointerId: number, clientX: number, clientY: number) {
    touchPointsRef.current.set(pointerId, { clientX, clientY });
  }

  function clearTouchPoint(pointerId: number) {
    touchPointsRef.current.delete(pointerId);
    if (touchPointsRef.current.size < 2) {
      pinchStateRef.current = null;
    }
  }

  function updatePinchState() {
    const viewport = viewportRef.current;
    if (!viewport || touchPointsRef.current.size < 2) {
      pinchStateRef.current = null;
      return;
    }

    const [firstTouch, secondTouch] = Array.from(touchPointsRef.current.values());
    const startDistance = getTouchDistance(firstTouch, secondTouch);
    if (startDistance <= 0) {
      pinchStateRef.current = null;
      return;
    }

    pinchStateRef.current = {
      startDistance,
      startZoom: zoomRef.current,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (event.pointerType === "touch") {
      syncTouchPoint(event.pointerId, event.clientX, event.clientY);
      if (touchPointsRef.current.size === 2) {
        updatePinchState();
      }
      return;
    }

    if (event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (event.pointerType === "touch") {
      syncTouchPoint(event.pointerId, event.clientX, event.clientY);
      if (touchPointsRef.current.size === 2 && pinchStateRef.current) {
        const [firstTouch, secondTouch] = Array.from(touchPointsRef.current.values());
        const rect = viewport.getBoundingClientRect();
        const currentDistance = getTouchDistance(firstTouch, secondTouch);
        const nextZoom = getPinchZoom({
          startZoom: pinchStateRef.current.startZoom,
          startDistance: pinchStateRef.current.startDistance,
          currentDistance,
        });
        applyZoom(nextZoom, {
          x: (firstTouch.clientX + secondTouch.clientX) / 2 - rect.left,
          y: (firstTouch.clientY + secondTouch.clientY) / 2 - rect.top,
        });
      }
      return;
    }

    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    const nextPan = getDraggedPan({
      pan: {
        x: dragStateRef.current.startScrollLeft,
        y: dragStateRef.current.startScrollTop,
      },
      delta: {
        x: -(event.clientX - dragStateRef.current.startX),
        y: -(event.clientY - dragStateRef.current.startY),
      },
    });
    viewport.scrollLeft = Math.max(0, nextPan.x);
    viewport.scrollTop = Math.max(0, nextPan.y);
  }

  function finishPointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      clearTouchPoint(event.pointerId);
      return;
    }

    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (!shouldHandleDiagramWheelZoom({ ctrlKey: event.ctrlKey, metaKey: event.metaKey })) {
      return;
    }

    event.preventDefault();
    const nextZoom = getNextDiagramZoom({
      currentZoom: zoomRef.current,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
    });
    const rect = viewport.getBoundingClientRect();
    applyZoom(nextZoom, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-000/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-border-200 bg-bg-000 shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-center gap-3 border-b border-border-200 bg-bg-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-[0.12em] text-text-200 uppercase">{title}</div>
            <div className="mt-1 text-xs text-text-400">
              {subtitle} {t("diagram.lightboxHint")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-border-200 bg-bg-000 px-3 py-1.5 text-xs font-medium text-text-300">
              {Math.round(zoom * 100)}%
            </div>
            <DiagramActionButton
              label="-"
              disabled={zoom <= DIAGRAM_MIN_ZOOM}
              onClick={() => {
                applyZoom(getButtonZoom({ currentZoom: zoomRef.current, action: "zoomOut" }));
              }}
            />
            <DiagramActionButton
              label={t("diagram.reset")}
              disabled={Math.abs(zoom - fitZoom) < 0.01}
              onClick={() => {
                applyZoom(fitZoomRef.current);
              }}
            />
            <DiagramActionButton
              label="+"
              disabled={zoom >= DIAGRAM_MAX_ZOOM}
              onClick={() => {
                applyZoom(getButtonZoom({ currentZoom: zoomRef.current, action: "zoomIn" }));
              }}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border-300 bg-bg-000 px-3 py-1.5 text-xs font-medium text-text-200 transition hover:bg-bg-200"
          >
            {t("diagram.close")}
          </button>
        </div>
        <div
          ref={viewportRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerInteraction}
          onPointerCancel={finishPointerInteraction}
          className={`flex-1 overflow-auto bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:28px_28px] p-4 select-none sm:p-6 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        >
          <div className="inline-block min-h-full min-w-full rounded-3xl border border-border-200 bg-bg-000 p-4 shadow-inner shadow-slate-200/70 sm:p-6">
            <div
              ref={contentRef}
              style={{ zoom }}
              className="w-max max-w-none origin-top-left [&_svg]:h-auto [&_svg]:max-h-none [&_svg]:max-w-none [&_svg]:w-auto"
              dangerouslySetInnerHTML={{ __html: markup }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function formatSourceWithLineNumbers(source: string): string {
  const lines = source.replace(/\n$/, "").split("\n");
  const width = String(lines.length).length;
  return lines
    .map((line, index) => `${String(index + 1).padStart(width, " ")} | ${line}`)
    .join("\n");
}

function buildMermaidErrorInfo(cause: unknown, chart: string): MermaidErrorInfo {
  const lines: string[] = [];
  let summary = "Mermaid render failed";

  if (cause instanceof Error) {
    summary = cause.message || summary;
    if (cause.name && cause.name !== "Error") {
      lines.push(`name: ${cause.name}`);
    }
  } else if (typeof cause === "string" && cause.trim()) {
    summary = cause;
  }

  const record = getObjectRecord(cause);
  const hash = getObjectRecord(record?.hash);

  if (record?.message && typeof record.message === "string") {
    summary = record.message;
  }

  if (record?.name && typeof record.name === "string" && record.name !== "Error") {
    lines.push(`name: ${record.name}`);
  }

  if (typeof record?.str === "string" && record.str.trim()) {
    lines.push(`input: ${record.str}`);
  }

  if (typeof record?.token === "string" && record.token.trim()) {
    lines.push(`token: ${record.token}`);
  }

  if (typeof record?.line === "number") {
    lines.push(`line: ${record.line}`);
  }

  if (hash) {
    if (Array.isArray(hash.expected) && hash.expected.length > 0) {
      lines.push(`expected: ${hash.expected.map((item) => formatValue(item)).join(", ")}`);
    }

    if (typeof hash.text === "string" && hash.text.trim()) {
      lines.push(`text: ${hash.text}`);
    }

    if (typeof hash.token === "string" && hash.token.trim()) {
      lines.push(`token: ${hash.token}`);
    }

    const loc = getObjectRecord(hash.loc);
    const firstLine = typeof loc?.first_line === "number" ? loc.first_line : undefined;
    const firstColumn = typeof loc?.first_column === "number" ? loc.first_column : undefined;
    const lastLine = typeof loc?.last_line === "number" ? loc.last_line : undefined;
    const lastColumn = typeof loc?.last_column === "number" ? loc.last_column : undefined;

    if (firstLine !== undefined) {
      const location = [`line ${firstLine}`];
      if (firstColumn !== undefined) {
        location.push(`column ${firstColumn}`);
      }
      if (lastLine !== undefined && lastColumn !== undefined) {
        location.push(`to line ${lastLine} column ${lastColumn}`);
      }
      lines.push(`location: ${location.join(" ")}`);
    }
  }

  if (record?.cause !== undefined) {
    lines.push(`cause: ${formatValue(record.cause)}`);
  }

  if (cause instanceof Error && cause.stack) {
    lines.push("stack:");
    lines.push(cause.stack);
  } else if (typeof record?.stack === "string" && record.stack.trim()) {
    lines.push("stack:");
    lines.push(record.stack);
  }

  const ownEntries = record
    ? Object.entries(record).filter(([key]) => !["message", "name", "stack", "cause", "hash", "str", "line", "token"].includes(key))
    : [];

  if (ownEntries.length > 0) {
    lines.push("raw:");
    for (const [key, value] of ownEntries) {
      lines.push(`${key}: ${formatValue(value)}`);
    }
  }

  const sourceBlock = formatSourceWithLineNumbers(chart);
  const diagnosticText = [
    `summary: ${summary}`,
    ...lines,
    "source:",
    sourceBlock,
  ].join("\n");

  return {
    summary,
    details: lines,
    diagnosticText,
  };
}

function ErrorSource({ chart }: { chart: string }) {
  return (
    <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre rounded-lg bg-bg-200 p-3 text-text-200">
      <code className="font-mono">{formatSourceWithLineNumbers(chart)}</code>
    </pre>
  );
}

function MermaidErrorPanel({ error, chart }: { error: MermaidErrorInfo; chart: string }) {
  const { copied, copyText } = useCopyAction();
  const { t } = useLocale();

  async function handleCopyDetails() {
    await copyText(error.diagnosticText);
  }

  return (
    <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{t("diagram.renderFailed")}</div>
        <button
          type="button"
          onClick={() => {
            void handleCopyDetails();
          }}
          className="rounded-md border border-danger/30 bg-bg-000/70 px-2 py-1 text-xs text-danger transition hover:bg-bg-000"
        >
          {copied ? t("diagram.copied") : t("diagram.copyDiagnostics")}
        </button>
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-xs text-danger/90">{error.summary}</div>
      {error.details.length > 0 ? (
        <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-bg-000/70 p-3 text-xs text-danger/90">
          <code className="font-mono">{error.details.join("\n")}</code>
        </pre>
      ) : null}
      <ErrorSource chart={chart} />
    </div>
  );
}

export function SvgPreview({ markup }: { markup: string }) {
  const { copied, copyText } = useCopyAction();
  const { t } = useLocale();
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  if (!looksLikeSvg(markup)) {
    return (
      <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap rounded-xl bg-bg-200 p-3 text-sm text-text-200">
        <code className="font-mono">{markup}</code>
      </pre>
    );
  }

  return (
    <>
      <DiagramCard
        title={t("diagram.svgPreview")}
        subtitle={t("diagram.svgPreviewSubtitle")}
        actions={(
          <>
            <DiagramActionButton
              label={copied ? t("diagram.sourceCopied") : t("diagram.copySource")}
              onClick={() => {
                void copyText(markup);
              }}
            />
            <DiagramActionButton
              label={t("diagram.downloadSvg")}
              onClick={() => {
                downloadTextFile(`diagram-${getTimestampLabel()}.svg`, markup, "image/svg+xml;charset=utf-8");
              }}
            />
          </>
        )}
      >
        <DiagramPreviewSurface onOpen={() => setIsFullscreenOpen(true)}>
          <div dangerouslySetInnerHTML={{ __html: markup }} />
        </DiagramPreviewSurface>
      </DiagramCard>
      <DiagramLightbox
        open={isFullscreenOpen}
        title={t("diagram.svgFullscreen")}
        subtitle={t("diagram.fullscreenCloseHint")}
        markup={markup}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </>
  );
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const renderId = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<MermaidErrorInfo | null>(null);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const { copied, copyText } = useCopyAction();
  const { t } = useLocale();

  useEffect(() => {
    let disposed = false;

    async function renderChart() {
      try {
        const mermaid = await getMermaid();
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "loose",
            theme: "neutral",
          });
          mermaidInitialized = true;
        }

        if (mermaid.parse) {
          await mermaid.parse(chart, { suppressErrors: false });
        }

        const { svg: renderedSvg } = await mermaid.render(renderId.current, chart);

        if (!disposed) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (cause) {
        if (!disposed) {
          setSvg("");
          setError(buildMermaidErrorInfo(cause, chart));
        }
      }
    }

    void renderChart();

    return () => {
      disposed = true;
    };
  }, [chart]);

  if (error) {
    return <MermaidErrorPanel error={error} chart={chart} />;
  }

  if (!svg) {
    return (
      <DiagramCard title={t("diagram.mermaidTitle")} subtitle={t("diagram.mermaidRendering")}>
        <div className="rounded-xl border border-dashed border-border-300 bg-bg-100 px-4 py-10 text-center text-sm text-text-400">
          {t("diagram.mermaidRenderingBody")}
        </div>
      </DiagramCard>
    );
  }

  return (
    <>
      <DiagramCard
        title={t("diagram.mermaidTitle")}
        subtitle={t("diagram.mermaidSubtitle")}
        actions={(
          <>
            <DiagramActionButton
              label={copied ? t("diagram.sourceCopied") : t("diagram.copySource")}
              onClick={() => {
                void copyText(chart);
              }}
            />
            <DiagramActionButton
              label={t("diagram.downloadSvg")}
              onClick={() => {
                downloadTextFile(`mermaid-${getTimestampLabel()}.svg`, svg, "image/svg+xml;charset=utf-8");
              }}
            />
          </>
        )}
      >
        <DiagramPreviewSurface onOpen={() => setIsFullscreenOpen(true)}>
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </DiagramPreviewSurface>
      </DiagramCard>
      <DiagramLightbox
        open={isFullscreenOpen}
        title={t("diagram.mermaidFullscreen")}
        subtitle={t("diagram.fullscreenCloseHint")}
        markup={svg}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </>
  );
}

export function isSvgMarkup(markup: string): boolean {
  return looksLikeSvg(markup);
}
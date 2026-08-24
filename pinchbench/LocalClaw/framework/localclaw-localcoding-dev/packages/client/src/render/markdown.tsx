import React, { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { MermaidDiagram, SvgPreview, isSvgMarkup } from "./DiagramBlock.js";
import { openBrowserPreview, getBrowserPreviewUrl } from "../utils/browserPreview";
import { useAppStore } from "../store/useAppStore";

function getNodeText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child);
    }
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return getNodeText(child.props.children ?? null);
    }
    return "";
  }).join("");
}

// Inline styles for printable (PDF) mode — avoids oklch() colors that html2canvas cannot parse.
const printStyles = {
  tableWrap: { overflow: "hidden", marginTop: 16, borderRadius: 16, border: "1px solid #e2e8f0", background: "rgba(255,255,255,0.85)", boxShadow: "0 10px 30px rgba(15,23,42,0.06)" } as const,
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 14, color: "#3b3b3b", tableLayout: "fixed" as const },
  thead: { backgroundColor: "#f8fafc" } as const,
  tbody: { backgroundColor: "rgba(255,255,255,0.8)" } as const,
  tr: {} as const,
  th: { borderBottom: "1px solid #e2e8f0", padding: "12px 16px", textAlign: "left" as const, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "#475569", textTransform: "uppercase" as const, overflowWrap: "anywhere" as const, wordBreak: "break-word" as const },
  td: { padding: "12px 16px", verticalAlign: "top" as const, lineHeight: "24px", color: "#3b3b3b", borderBottom: "1px solid #e2e8f0", overflowWrap: "anywhere" as const, wordBreak: "break-word" as const },
  pre: { overflow: "hidden", wordBreak: "break-word" as const, overflowWrap: "anywhere" as const, whiteSpace: "pre-wrap" as const, marginTop: 12, maxWidth: "100%", borderRadius: 12, backgroundColor: "#f1f5f9", padding: 12, fontSize: 14, color: "#3b3b3b" },
  code: { fontFamily: "monospace", whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const, overflowWrap: "anywhere" as const },
};

export default React.memo(
  function MDContent(
    { text, printable = false, streaming = false, openInBrowser, workDir }: {
      text: string;
      printable?: boolean;
      streaming?: boolean;
      openInBrowser?: (url: string) => void;
      workDir?: string;
    },
  ) {
    // 兜底 workDir：调用方（文件预览/审查面板）通常不传，从全局 store 取当前会话目录，
    // 让正文里的本地 HTML 路径点击即可在右侧浏览器预览。hook 须在任何提前 return 之前调用。
    const storeWorkDir = useAppStore((s) => {
      const sess = s.activeSessionId ? s.sessions[s.activeSessionId] : undefined;
      return sess?.cwd || sess?.generatedFilesDir || "";
    });
    const effectiveWorkDir = workDir || storeWorkDir;

    // During streaming, skip full Markdown parsing (no rehypeHighlight, no mermaid) for performance.
    // Render as plain preformatted text; full render happens after block_stop clears streaming flag.
    if (streaming) {
      return (
        <pre className="whitespace-pre-wrap break-words font-sans text-base leading-relaxed text-text-200 m-0 p-0 bg-transparent">
          {String(text ?? "")}
        </pre>
      );
    }

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          h1: (props) => <h1 className="mt-4 text-xl font-semibold text-text-000" {...props} />,
          h2: (props) => <h2 className="mt-4 text-lg font-semibold text-text-000" {...props} />,
          h3: (props) => <h3 className="mt-3 text-base font-semibold text-text-100" {...props} />,
          p: (props) => <p className="mt-2 text-base leading-relaxed text-text-200" {...props} />,
          ul: (props) => <ul className="mt-2 ml-4 grid list-disc gap-1" {...props} />,
          ol: (props) => <ol className="mt-2 ml-4 grid list-decimal gap-1" {...props} />,
          li: (props) => <li className="min-w-0 text-text-200" {...props} />,
          strong: (props) => <strong className="text-text-000 font-semibold" {...props} />,
          em: (props) => <em className="text-text-100" {...props} />,
          table: (props) => printable ? (
            <div style={printStyles.tableWrap}>
              <table style={printStyles.table} {...props} />
            </div>
          ) : (
            <div className="md-table overflow-x-auto mt-4 rounded-2xl bg-bg-000/85 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <table className="min-w-full text-sm text-text-200" {...props} />
            </div>
          ),
          thead: (props) => printable
            ? <thead style={printStyles.thead} {...props} />
            : <thead className="bg-bg-100/90" {...props} />,
          tbody: (props) => printable
            ? <tbody style={printStyles.tbody} {...props} />
            : <tbody className="bg-bg-000/80" {...props} />,
          tr: (props) => printable
            ? <tr style={printStyles.tr} {...props} />
            : <tr className="transition-colors hover:bg-bg-100/80" {...props} />,
          th: (props) => printable
            ? <th style={printStyles.th} {...props} />
            : <th className="px-4 py-3 text-left text-xs font-semibold tracking-[0.08em] text-text-300 uppercase" {...props} />,
          td: (props) => printable
            ? <td style={printStyles.td} {...props} />
            : <td className="px-4 py-3 align-top leading-6 text-text-200 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0" {...props} />,
          pre: (props) => printable ? (
            <pre style={printStyles.pre} {...props} />
          ) : (
            <pre className="overflow-x-auto mt-3 max-w-full whitespace-pre-wrap rounded-xl bg-bg-200 p-3 text-sm text-text-200" {...props} />
          ),
          a: (props) => {
            const href = props.href;
            const previewUrl = getBrowserPreviewUrl(href, effectiveWorkDir);
            const handleClick = (e: React.MouseEvent) => {
              if (openBrowserPreview(href, openInBrowser, effectiveWorkDir)) {
                e.preventDefault();
              }
            };
            const link = (
              <a className="text-accent-brand underline hover:opacity-80" {...props} href={href} onClick={handleClick} target="_blank" rel="noopener noreferrer" />
            );
            if (!previewUrl) return link;
            return (
              <span className="inline-flex items-baseline gap-1">
                {link}
                <button
                  type="button"
                  title="在右侧浏览器预览"
                  onClick={() => openBrowserPreview(href, openInBrowser, effectiveWorkDir)}
                  className="relative -top-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-400 transition-colors hover:bg-bg-200 hover:text-accent-brand"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                </button>
              </span>
            );
          },
          img: (props) => <img className="mt-2 max-w-full max-h-80 rounded-xl" {...props} />,
          svg: (props) => <svg className={`mt-3 h-auto max-w-full ${props.className ?? ""}`.trim()} {...props} />,
          code: (props) => {
            const { children, className, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const language = match?.[1]?.toLowerCase();
            const rawText = getNodeText(children);
            const codeText = rawText.replace(/\n$/, "");
            const isInline = !match && !rawText.includes("\n");

            if (!isInline && language === "mermaid") {
              if (streaming) {
                return (
                  <pre className="mt-3 max-w-full whitespace-pre-wrap rounded-xl bg-bg-200 p-3 text-sm text-text-200">
                    <code className="font-mono">{codeText}</code>
                  </pre>
                );
              }
              return <MermaidDiagram chart={codeText} />;
            }

            if (!isInline && (language === "svg" || isSvgMarkup(codeText))) {
              return <SvgPreview markup={codeText} />;
            }

            return isInline ? (
              getBrowserPreviewUrl(codeText.trim(), effectiveWorkDir) ? (
                <code
                  role="link"
                  tabIndex={0}
                  onClick={() => openBrowserPreview(codeText.trim(), openInBrowser, effectiveWorkDir)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBrowserPreview(codeText.trim(), openInBrowser, effectiveWorkDir); } }}
                  className="cursor-pointer rounded bg-purple-light2 px-1.5 py-0.5 text-accent-brand underline decoration-dotted font-mono text-base hover:opacity-80"
                  {...rest}
                >
                  {children}
                </code>
              ) : (
                <code className="rounded bg-purple-light2 px-1.5 py-0.5 text-accent-brand font-mono text-base" {...rest}>
                  {children}
                </code>
              )
            ) : (
              printable
                ? <code style={printStyles.code} className={className ?? ""} {...rest}>{children}</code>
                : <code className={`${className ?? ""} font-mono`} {...rest}>{children}</code>
            );
          }
        }}
      >
        {String(text ?? "")}
      </ReactMarkdown>
    );
  },
  (prev, next) => prev.text === next.text && prev.printable === next.printable && prev.streaming === next.streaming
);

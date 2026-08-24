// PoC 用的 markdown 渲染：react-markdown + GFM + 代码高亮
// 与现有 render/markdown.tsx 解耦——后者用 LocalClaw 紫色 token，PoC 用 shadcn zinc

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { openBrowserPreview, getBrowserPreviewUrl } from "../../utils/browserPreview";
import { useAppStore } from "../../store/useAppStore";

// 从 href 提取展示用标签：http(s) 取 host(:port)，file:// 取文件名，兜底原串
function hostLabel(href?: string): string {
  if (!href) return "链接";
  try {
    const u = new URL(href);
    if (u.protocol === "file:") {
      const name = u.pathname.split("/").filter(Boolean).pop();
      return name ? decodeURIComponent(name) : href;
    }
    return u.host || href;
  } catch {
    return href;
  }
}

interface Props {
  text: string;
  openInBrowser?: (url: string) => void;
  workDir?: string;
}

// 从 react-markdown 的 children 中提取纯文本（inline code 通常是字符串或字符串数组）
function extractText(children: any): string {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (typeof children === "object" && "props" in children) return extractText(children.props?.children);
  return "";
}

const MarkdownView = React.memo(function MarkdownView({ text, openInBrowser, workDir }: Props) {
  // 消息渲染链路通常不传 openInBrowser/workDir：从全局 store 兜底，
  // 让正文里的本地 HTML 路径（含绝对/相对路径）点击即可在右侧浏览器预览。
  const storeWorkDir = useAppStore((s) => {
    const sess = s.activeSessionId ? s.sessions[s.activeSessionId] : undefined;
    return sess?.cwd || sess?.generatedFilesDir || "";
  });
  const effectiveWorkDir = workDir || storeWorkDir;
  return (
    <div className="max-w-none text-zinc-900 dark:text-zinc-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: (props) => <p className="my-2 leading-relaxed" {...props} />,
          h1: (props) => <h1 className="mt-4 mb-2 text-xl font-semibold" {...props} />,
          h2: (props) => <h2 className="mt-4 mb-2 text-lg font-semibold" {...props} />,
          h3: (props) => <h3 className="mt-3 mb-1 text-base font-semibold" {...props} />,
          ul: (props) => <ul className="my-2 ml-5 list-disc space-y-1" {...props} />,
          ol: (props) => <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          a: (props) => {
            const href = props.href;
            const previewUrl = getBrowserPreviewUrl(href, effectiveWorkDir);
            // 可预览链接（本地 HTML / http 服务）渲染成卡片：地球图标 + 「打开方式」下拉。
            if (previewUrl) {
              const label = extractText(props.children).trim() || hostLabel(href);
              return (
                <LinkPreviewCard href={href!} label={label} openInBrowser={openInBrowser} workDir={effectiveWorkDir} />
              );
            }
            const handleClick = (e: React.MouseEvent) => {
              if (openBrowserPreview(href, openInBrowser, effectiveWorkDir)) {
                e.preventDefault();
              }
            };
            return (
              <a className="text-blue-600 underline hover:text-blue-700" {...props} href={href} onClick={handleClick} target="_blank" rel="noreferrer">
                {props.children}
              </a>
            );
          },
          strong: (props) => <strong className="font-semibold" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          blockquote: (props) => (
            <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400" {...props} />
          ),
          hr: () => <hr className="my-3 border-zinc-200 dark:border-zinc-800" />,
          table: (props) => (
            <div className="my-2 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-500">
              <table className="min-w-full border-collapse text-sm" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-zinc-50 dark:bg-zinc-900" {...props} />,
          th: (props) => <th className="border-b border-zinc-200 px-3 py-1.5 text-left font-medium dark:border-zinc-500" {...props} />,
          td: (props) => <td className="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-500" {...props} />,
          code: ({ className, children, ...rest }: any) => {
            const inline = !className;
            if (inline) {
              const raw = extractText(children).trim();
              // 行内代码若是本地 HTML 文件引用，则做成可点击 → 右侧浏览器预览
              if (getBrowserPreviewUrl(raw, effectiveWorkDir)) {
                return (
                  <code
                    role="link"
                    tabIndex={0}
                    onClick={() => openBrowserPreview(raw, openInBrowser, effectiveWorkDir)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBrowserPreview(raw, openInBrowser, effectiveWorkDir); } }}
                    className="cursor-pointer rounded bg-blue-50 px-1 py-0.5 font-mono text-[0.875em] text-blue-600 underline decoration-dotted hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
                    {...rest}
                  >
                    {children}
                  </code>
                );
              }
              return (
                <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.875em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" {...rest}>
                  {children}
                </code>
              );
            }
            return <code className={className} {...rest}>{children}</code>;
          },
          pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownView;

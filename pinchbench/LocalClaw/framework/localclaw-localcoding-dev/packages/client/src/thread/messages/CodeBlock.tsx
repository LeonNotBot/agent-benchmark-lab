// 代码块容器：右上角浮一个复制按钮，配 hljs 主题色
import { useState, type ReactNode } from "react";

export function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    const pre = (e.currentTarget as HTMLElement).parentElement?.querySelector("pre");
    const text = pre?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  // children 是 <code>，提取 language-xxx
  const codeEl: any = Array.isArray(children) ? children[0] : children;
  const className: string = codeEl?.props?.className ?? "";
  const lang = className.match(/language-(\w+)/)?.[1];

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-border-300 bg-bg-200">
      <div className="flex items-center justify-between border-b border-border-300 bg-bg-100 px-3 py-1 text-[11px]">
        <span className="font-mono text-text-400">{lang ?? "code"}</span>
        <button
          onClick={handleCopy}
          className="rounded px-1.5 py-0.5 text-text-400 transition-colors hover:bg-bg-300 hover:text-text-200"
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed text-text-200">
        {children}
      </pre>
    </div>
  );
}
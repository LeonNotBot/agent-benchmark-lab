// 共享代码高亮预览：合并 FileBrowserTab / ReviewSource 两处重复的 highlight.js 逻辑。
// 扩展名 → highlight.js 语言的映射也统一收口在此。
// 逐行渲染：每一逻辑行 = 行号 + 该行代码（flex 一行），代码列自动换行；
// 长行折行时行号顶部对齐、不错位。
import hljs from "highlight.js";

// 扩展名 → highlight.js 语言标识
export const CODE_LANGS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", go: "go", java: "java", rs: "rust", c: "c", cpp: "cpp",
  sh: "bash", bash: "bash", css: "css", json: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", rb: "ruby", php: "php",
  swift: "swift", kt: "kotlin", sql: "sql", md: "markdown",
};

/** 取文件名扩展名（小写）。 */
export function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

interface Props {
  content: string;
  /** highlight.js 语言标识；缺省时按纯文本渲染 */
  language?: string;
  /** 关闭自动换行（保留以兼容调用方；逐行渲染下代码列始终自动换行，此项不再生效） */
  noWrap?: boolean;
}

// 行高与字号统一常量。
const LINE_CLS = "text-[13px] font-code leading-6";

// HTML 转义（纯文本 fallback 用）。
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 将 highlight.js 输出的整块 HTML 按行切分为逐行 HTML。
// highlight.js 的高亮 <span> 可能跨行（如多行注释/模板字符串），直接按 \n 切会截断标签，
// 故在行尾补齐未闭合的 <span>、下一行头部按栈重开，保证每行都是自包含的合法 HTML。
function splitHighlightedToLines(html: string): string[] {
  const lines: string[] = [];
  const openStack: string[] = []; // 存每个未闭合 <span ...> 的完整开标签
  let cur = "";
  let i = 0;
  const flush = () => {
    // 行尾：闭合当前所有打开的 span
    let line = cur;
    for (let k = 0; k < openStack.length; k++) line += "</span>";
    lines.push(line);
    // 下一行：按栈顺序重开
    cur = openStack.join("");
  };
  while (i < html.length) {
    if (html[i] === "\n") {
      flush();
      i += 1;
      continue;
    }
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) { cur += html.slice(i); break; }
      const tag = html.slice(i, end + 1);
      if (/^<\/span>/i.test(tag)) {
        openStack.pop();
      } else if (/^<span/i.test(tag)) {
        openStack.push(tag);
      }
      cur += tag;
      i = end + 1;
      continue;
    }
    // 普通字符：累加到下一个 < 或 \n 之前，减少循环次数
    let next = i;
    while (next < html.length && html[next] !== "<" && html[next] !== "\n") next += 1;
    cur += html.slice(i, next);
    i = next;
  }
  cur += openStack.map(() => "</span>").join("");
  lines.push(cur);
  return lines;
}

export function CodePreview({ content, language }: Props) {
  let lineHtml: string[];
  if (language && hljs.getLanguage(language)) {
    try {
      const highlighted = hljs.highlight(content, { language, ignoreIllegals: true }).value;
      lineHtml = splitHighlightedToLines(highlighted);
    } catch {
      lineHtml = content.split("\n").map(escapeHtml);
    }
  } else {
    lineHtml = content.split("\n").map(escapeHtml);
  }

  return (
    <div className={`${LINE_CLS} hljs bg-transparent`}>
      {lineHtml.map((html, idx) => (
        <div key={idx} className="flex">
          {/* 行号：固定宽度、右对齐、顶部对齐（长行折行时行号贴顶不错位） */}
          <span
            aria-hidden="true"
            className="shrink-0 select-none pr-3 pl-1 text-right text-text-400/60"
            style={{ minWidth: "3ch" }}
          >
            {idx + 1}
          </span>
          {/* 代码：占满剩余宽度，自动换行 */}
          <code
            className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-200"
            dangerouslySetInnerHTML={{ __html: html || "​" }}
          />
        </div>
      ))}
    </div>
  );
}

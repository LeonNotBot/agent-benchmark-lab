// AskUserQuestion 工具卡片：仅渲染「已答历史卡」。
// 待回答时的交互卡已改为覆盖输入框（见 thread/AskUserQuestionCard.tsx + Composer），
// 不再在消息流中间内嵌渲染，故 result==null 时此处不渲染交互面板（返回紧凑占位）。

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCard } from "./ToolCard";
import { getStatus } from "./helpers";

interface Question {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

interface AskArgs {
  questions?: Question[];
  answers?: Record<string, string>;
}

const Icon = (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
  </svg>
);

export const AskUserQuestionToolUI = makeAssistantToolUI<AskArgs, unknown>({
  toolName: "AskUserQuestion",
  render: ({ args, result, status, isError }) => {
    // 待回答（无 result）：交互卡由 Composer 覆盖输入框渲染，消息流这里不重复展示。
    if (result == null) return null;

    // 失败结果：通常是模型误用工具（如 options 不足 2 项被 CLI schema 校验拦下）后会自行
    // 修正重试，属内部噪声，不在消息流展示醒目的失败卡，避免与重试成功的覆盖卡/历史卡并存。
    if (isError || isErrorResult(result)) return null;

    // 已回答/历史 → 静态展示
    const s = getStatus(status, isError);
    // args.questions 可能缺失，或在异常的历史数据里是非数组（字符串/对象）。
    // 必须强制成数组，否则下游 questions.map 会抛 "e.map is not a function" 白屏整个应用。
    const questions = Array.isArray(args?.questions) ? args!.questions : [];
    // 答案优先取自提交结果(result)，args.answers 仅作兜底；两者都可能为空对象
    const fromResult = extractAnswers(result);
    const fromArgs = args?.answers && Object.keys(args.answers).length > 0 ? args.answers : null;
    const answers = fromResult ?? fromArgs;
    const summary = questions[0]?.question ?? "Question";
    const body = questions.length > 0 ? <AnswerList questions={questions} answers={answers} /> : null;
    return <ToolCard icon={Icon} toolName="AskUserQuestion" summary={summary} status={s} body={body} defaultOpen />;
  },
});

// 判断 result 是否为失败/错误结果（兼容 isError prop 在 external store 下不可靠的情况）。
function isErrorResult(result: unknown): boolean {
  if (result && typeof result === "object") {
    const r = result as any;
    if (r.is_error === true || r.isError === true) return true;
    if (typeof r.content === "string" && r.content.includes("tool_use_error")) return true;
    if (r.behavior === "deny") return true;
  }
  if (typeof result === "string" && result.includes("tool_use_error")) return true;
  return false;
}

function extractAnswers(result: unknown): Record<string, string> | null {
  if (result && typeof result === "object") {
    const r = result as any;
    if (r.answers) return r.answers;
    if (r.updatedInput?.answers) return r.updatedInput.answers;
    // tool_result.content 形态：可能是字符串或 [{type:"text",text}]
    if (typeof r.content === "string") return parseAnswerString(r.content);
    if (Array.isArray(r.content)) {
      const text = r.content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("\n");
      return parseAnswerString(text);
    }
  }
  // 后端真实结果是自然语言字符串：User has answered your questions: "问题"="答案". ...
  if (typeof result === "string") return parseAnswerString(result);
  return null;
}

// 从 'User has answered your questions: "Q1"="A1", "Q2"="A2". ...' 解析出 {Q: A}
function parseAnswerString(text: string): Record<string, string> | null {
  if (!text) return null;
  const map: Record<string, string> = {};
  // 匹配所有 "问题"="答案"（问题/答案中可含除引号外的任意字符）
  const re = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map[m[1]] = m[2];
  }
  return Object.keys(map).length > 0 ? map : null;
}

function AnswerList({ questions, answers }: { questions: Question[]; answers: Record<string, string> | null }) {
  const answerVals = answers ? Object.values(answers) : [];
  const list = Array.isArray(questions) ? questions : [];
  return (
    <div className="space-y-2 p-3">
      {list.map((q, i) => {
        // 优先按问题文本匹配；匹配不到时按索引兜底（单/顺序问答场景）
        const ans = answers?.[q.question] ?? answerVals[i] ?? "";
        return (
        <div key={i}>
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{q.question}</p>
          {Array.isArray(q.options) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {q.options.map((opt, j) => {
                const selected = ans.includes(opt.label);
                return (
                  <span
                    key={j}
                    className={`rounded-md border px-2 py-0.5 text-[11px] ${
                      selected
                        ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200"
                        : "border-zinc-200 text-zinc-500 dark:border-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </span>
                );
              })}
            </div>
          )}
          {ans && (
            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              → {ans}
            </p>
          )}
        </div>
        );
      })}
    </div>
  );
}

// User message bubble，支持 text + image part
import { MessagePrimitive, MessagePartPrimitive, useMessage } from "@assistant-ui/react";
import { useLocale } from "../../i18n";

export function UserMessage() {
  const { t } = useLocale();
  // 定时任务续聊自动发送的消息：气泡上方显示「通过自动化发送」徽标。
  const isAutomation = useMessage((m) => (m.metadata?.custom as any)?.source === "automation");
  return (
    // 满宽容器 + justify-end，使气泡右沿贴内容区(x)右侧
    <MessagePrimitive.Root className="my-3 flex w-full flex-col items-end">
      {isAutomation && (
        <div className="mb-1 flex items-center gap-1 text-[11px] text-text-400">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t("thread.sentByAutomation")}</span>
        </div>
      )}
      <div className="max-w-[80%] rounded-2xl rounded-br bg-bg-300 px-4 py-2 text-[15px] leading-[1.6] text-text-100">
        <MessagePrimitive.Parts components={{ Text: TextPart, Image: ImagePart }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function TextPart() {
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      <MessagePartPrimitive.Text />
    </div>
  );
}

function ImagePart() {
  return <MessagePartPrimitive.Image className="my-1 max-h-48 rounded-lg" />;
}
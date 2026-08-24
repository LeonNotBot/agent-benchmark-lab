// 首页空态：居中大标题 + 居中卡片态输入框（不做推荐卡片）
import type { ClientEvent } from "@lenovo/agent-protocol";
import { Composer } from "./Composer";
import { ProjectPicker } from "./ProjectPicker";
import { PromptTemplates } from "./PromptTemplates";
import { useLocale } from "../i18n";

interface Props {
  sendEvent: (event: ClientEvent) => void;
}

export function Homepage({ sendEvent }: Props) {
  const { t } = useLocale();
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="w-full max-w-3xl">
        <h1 className="mb-10 text-center text-3xl font-medium text-text-200">
          {t("thread.homepageTitle")}
        </h1>
        <PromptTemplates />
        <Composer sendEvent={sendEvent} variant="centered" />
        {/* 项目选择条：与输入框等宽、紧贴其下方（负 margin 上移，塞进输入框卡片圆角下） */}
        <div className="-mt-3">
          <ProjectPicker />
        </div>
      </div>
    </div>
  );
}

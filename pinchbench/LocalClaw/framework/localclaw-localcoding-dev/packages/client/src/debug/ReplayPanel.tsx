// 回放面板：把录制的状态快照按时序喂给独立 assistant-ui runtime，用真实消息组件渲染。
// 内嵌自包含的 AssistantRuntimeProvider —— 不接全局 store，不影响主界面。
// 底部时间轴支持播放/暂停/逐帧/跳转/变速，可慢放重现流式渲染过程。
import { AssistantRuntimeProvider, ThreadPrimitive } from "@assistant-ui/react";
import { UserMessage } from "../thread/messages/UserMessage";
import { AssistantMessage } from "../thread/messages/AssistantMessage";
import MarkdownView from "../thread/messages/MarkdownView";
import type { DebugRecording } from "./types";
import { useReplayRuntime } from "./useReplayRuntime";
import { useReplayEngine } from "./useReplayEngine";
import { ReplayControls } from "./ReplayControls";

interface Props {
  recording: DebugRecording;
}

export function ReplayPanel({ recording }: Props) {
  const engine = useReplayEngine(recording);
  const step = engine.current;
  const runtime = useReplayRuntime(
    step?.messages ?? [],
    step?.sessionStatus === "error",
  );

  return (
    <div className="flex h-full flex-col">
      {/* 消息渲染区：独立 runtime + 真实消息组件 */}
      <div className="flex-1 overflow-hidden">
        {engine.total === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-400">
            该录制没有可回放的快照帧
          </div>
        ) : (
          <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root className="flex h-full flex-col overflow-hidden">
              <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto py-4 px-5 [scrollbar-gutter:stable]">
                <div className="mx-auto max-w-3xl">
                  <ThreadPrimitive.Messages
                    components={{ UserMessage, AssistantMessage, SystemMessage: () => null }}
                  />
                  {/* 逐字流式文本：仿真实 MessageList 的 partial 段，渲染在已落定消息之后 */}
                  {step?.partialText && (
                    <div className="my-3">
                      {step.partialBlockType === "thinking" ? (
                        <div className="my-1 border-l-2 border-border-300 pl-3 text-xs italic text-text-400">
                          {step.partialText}
                        </div>
                      ) : (
                        <div className="text-sm"><MarkdownView text={step.partialText} /></div>
                      )}
                    </div>
                  )}
                </div>
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
        )}
      </div>

      {/* 底部时间轴控制条 */}
      {engine.total > 0 && <ReplayControls engine={engine} step={step} />}
    </div>
  );
}

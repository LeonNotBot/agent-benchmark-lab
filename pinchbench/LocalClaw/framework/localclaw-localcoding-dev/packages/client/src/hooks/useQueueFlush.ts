// 排队消息的全局自动发送（flush）。
//
// 为什么放在 AppShell 而非 Composer：
//   排队队列按【所属会话】分桶存于 store（queuedBySession）。Composer 只有一个实例，
//   切换会话时不重新挂载，若由它监听「当前会话」的 status 下降沿来 flush，会出现串台 bug：
//   会话 A 跑着时入队 → 切到会话 B → B 跑完触发下降沿 → 把 A 的排队消息发到了 B。
//
// 本 hook 监听【所有会话】的 status，任一会话出现 running → 非running 的下降沿且其队列非空时，
//   取该会话队首消息，用【该会话自己的 sessionId + 入队时快照的 runConfig】发送（FIFO，逐条）。
//   这样切走会话 A 后，A 跑完仍会继续把 A 的排队消息发出去（在 A 里执行），符合预期。
//
// 必须在唯一一个常驻挂载的组件（AppShell）里调用一次，避免多实例重复触发。

import { useEffect, useRef } from "react";
import type { ClientEvent } from "@lenovo/agent-protocol";
import { useAppStore } from "../store/useAppStore";
import { flattenTarget } from "../store/slices/routingSlice";

export function useQueueFlush(sendEvent: (event: ClientEvent) => void) {
  const sessions = useAppStore((s) => s.sessions);
  const dequeueMessage = useAppStore((s) => s.dequeueMessage);
  // 记录每个会话上一次观察到的 status，用于检测下降沿。
  const prevStatusRef = useRef<Record<string, string | undefined>>({});

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next: Record<string, string | undefined> = {};

    for (const id of Object.keys(sessions)) {
      const now = sessions[id]?.status;
      next[id] = now;
      const was = prev[id];
      // running → 非running 下降沿：尝试 flush 该会话队首一条。
      if (was === "running" && now !== "running") {
        const msg = dequeueMessage(id);
        if (msg) {
          // 用入队时快照的 runConfig，而非现取（排队后用户可能已切 model/mode）。
          // 扁平化成线格式；target 为 null（入队时未选）则只发 permissionMode，后端按会话既有配置兜底。
          const wire = msg.runConfig.target
            ? { ...flattenTarget(msg.runConfig.target), permissionMode: msg.runConfig.permissionMode }
            : { permissionMode: msg.runConfig.permissionMode };
          sendEvent({
            type: "session.continue",
            payload: { sessionId: id, prompt: msg.prompt, attachments: msg.attachments, ...wire },
          });
        }
      }
    }

    prevStatusRef.current = next;
  }, [sessions, dequeueMessage, sendEvent]);
}

// Task 系列工具 UI：在消息流里静默（任务清单已由右侧 Workbench 的 tasks 标签展示，无需重复）
import { makeAssistantToolUI } from "@assistant-ui/react";

// TaskCreate/Update/List/Get 都不在消息流里渲染（返回 null）
// 理由：右侧 tasks 标签已实时展示任务清单，消息流里再显示这些工具调用是重复信息
const Silent = () => null;

export const TaskCreateToolUI = makeAssistantToolUI({
  toolName: "TaskCreate",
  render: Silent,
});

export const TaskUpdateToolUI = makeAssistantToolUI({
  toolName: "TaskUpdate",
  render: Silent,
});

export const TaskListToolUI = makeAssistantToolUI({
  toolName: "TaskList",
  render: Silent,
});

export const TaskGetToolUI = makeAssistantToolUI({
  toolName: "TaskGet",
  render: Silent,
});

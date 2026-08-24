// 第三方自动部署系统 SSE 事件 payload 类型（对应接入文档「接口二」）

export type DeployStatus =
  | "pending" | "building" | "running" | "failed" | "stopped" | "deleted" | "idle";

export interface DeployStage {
  stage: string;
  action: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string;
  message: string;
  sequence: number;
  elapsedMs: number;
}

export interface DeployProgress {
  currentStep: number;
  totalSteps: number;
  percent: number;
}

export interface DeployPayload {
  deployId: string;
  status: DeployStatus;
  currentStage?: string;
  currentAction?: string;
  progress?: DeployProgress;
  stage?: DeployStage | null;
  stageHistory?: DeployStage[];
  result?: { url?: string; publishedUrl?: string };
  diagnostics?: {
    failedStage?: string;
    error?: string;
    suggestion?: string;
    repairStatus?: string;
    repairFailureReason?: string;
  };
  repair?: { status?: string; plan?: string; output?: string };
  terminalTail?: string;
  updatedAt?: string;
}

// SSE 事件名
export type DeployEventName =
  | "deployment.progress" | "deployment.heartbeat" | "deployment.completed"
  | "deployment.failed" | "deployment.stopped" | "deployment.deleted";

export const TERMINAL_EVENTS: DeployEventName[] = [
  "deployment.completed", "deployment.failed", "deployment.stopped", "deployment.deleted",
];

export const STATUS_LABELS: Record<DeployStatus, string> = {
  idle: "未开始", pending: "排队中", building: "部署中",
  running: "运行中", failed: "失败", stopped: "已停止", deleted: "已删除",
};

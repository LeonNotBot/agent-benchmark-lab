import { Controller, Get, Post, Put, Delete, Param, Body, Inject, Query, BadRequestException } from "@nestjs/common";
import { isAbsolute } from "path";
import { SCHEDULED_TASK_SERVICE, type IScheduledTaskService, isValidCron, type ScheduleSpec } from "@lenovo/agent-sdk";
import { ScheduledTaskRunnerService } from "./scheduled-task-runner.service";

function assertValidInput(body: {
  name?: string;
  cron?: string;
  prompt?: string;
  cwd?: string;
  status?: string;
  model?: string;
  endpointId?: string;
}): void {
  if (body.name != null && (typeof body.name !== "string" || body.name.length === 0 || body.name.length > 100))
    throw new BadRequestException("invalid_name");
  // cron 走 SDK 单一真相源 isValidCron（逐 piece 解析，强于正则）。仅校验"已提供"的值，
  // 创建时的"必填"由 ScheduledTaskService.create 统一收口（支持结构化 schedule 回退）。
  if (body.cron != null && !isValidCron(body.cron))
    throw new BadRequestException("invalid_cron");
  if (body.prompt != null && (typeof body.prompt !== "string" || body.prompt.length === 0))
    throw new BadRequestException("empty_prompt");
  if (body.cwd != null && body.cwd !== "" && !isAbsolute(body.cwd))
    throw new BadRequestException("cwd_must_be_absolute");
  if (body.status != null && body.status !== "active" && body.status !== "paused")
    throw new BadRequestException("invalid_status");
  if (body.model != null && typeof body.model !== "string")
    throw new BadRequestException("invalid_model");
  if (body.endpointId != null && typeof body.endpointId !== "string")
    throw new BadRequestException("invalid_endpoint");
}

@Controller("api/scheduled-tasks")
export class ScheduledTaskController {
  constructor(
    @Inject(SCHEDULED_TASK_SERVICE) private readonly svc: IScheduledTaskService,
    @Inject(ScheduledTaskRunnerService) private readonly runner: ScheduledTaskRunnerService,
  ) {}

  @Get()
  list() { return { tasks: this.svc.list() }; }

  @Post()
  create(@Body() body: { name: string; cron?: string; prompt: string; cwd?: string; schedule?: ScheduleSpec; model?: string; endpointId?: string; source?: "ui" | "mcp" | "api"; taskType?: "project" | "conversation"; boundSessionId?: string }) {
    assertValidInput(body);
    // cron 必填/合法由 Service.create 统一收口：支持 schedule(结构化) 回退到 cron(裸串)。
    return this.svc.create({
      name: body.name, cron: body.cron, schedule: body.schedule, prompt: body.prompt,
      status: "active", cwd: body.cwd, model: body.model, endpointId: body.endpointId,
      source: body.source ?? "api",
      taskType: body.taskType, boundSessionId: body.boundSessionId,
    });
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() body: Partial<{ name: string; cron: string; prompt: string; status: "active" | "paused"; cwd: string; model: string; endpointId: string; taskType: "project" | "conversation"; boundSessionId: string }>,
  ) {
    assertValidInput(body);
    return this.svc.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) { return { ok: this.svc.delete(id) }; }

  @Get("history")
  history(@Query("taskId") taskId?: string) { return { executions: this.svc.listHistory(taskId) }; }

  @Post(":id/run")
  run(@Param("id") id: string) {
    this.runner.runTask(id).catch(() => { /* fire-and-forget */ });
    return { ok: true };
  }
}

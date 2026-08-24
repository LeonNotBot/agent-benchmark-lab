import { Controller, Get, Query, Inject, BadRequestException } from "@nestjs/common";
import { isAbsolute } from "path";
import { ProjectCapabilityService } from "@lenovo/agent-sdk";

/**
 * 项目能力扫描 REST 桥接（薄层）。
 * 逻辑全在 SDK 的 ProjectCapabilityService，controller 仅做入参校验 + 转发。
 */
@Controller("api/project-capabilities")
export class ProjectCapabilityController {
  constructor(
    @Inject(ProjectCapabilityService)
    private readonly svc: ProjectCapabilityService,
  ) {}

  /** 扫描给定项目根的 .claude 能力。cwd 须为绝对路径。 */
  @Get()
  scan(@Query("cwd") cwd: string) {
    if (!cwd || !isAbsolute(cwd)) {
      throw new BadRequestException("cwd_must_be_absolute");
    }
    return this.svc.scan(cwd);
  }
}

import {
  Controller, Post, Get, Query, Req, Res, Body, Inject, HttpException, HttpStatus,
} from "@nestjs/common";
import { isAbsolute } from "path";
import { PluginService } from "@lenovo/agent-sdk";
import type { PluginScope } from "@lenovo/agent-protocol";

/** 收集 octet-stream 请求体为 Buffer（复用 skill import-zip 的流式模式）。 */
function collectBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseScope(scope?: string): PluginScope {
  return scope === "project" ? "project" : "global";
}

/** 校验 project scope 的 cwd 必填且绝对；global 忽略 cwd。 */
function validate(scope: PluginScope, cwd?: string): void {
  if (scope === "project" && (!cwd || !isAbsolute(cwd))) {
    throw new HttpException("cwd_must_be_absolute", HttpStatus.BAD_REQUEST);
  }
}

/**
 * Plugin(.claude 场景包) 导入桥接（薄层）。
 * 逻辑全在 SDK PluginService；本地导入只有上传流，无远程拉取。
 */
@Controller("api/plugins")
export class PluginController {
  constructor(
    @Inject(PluginService) private readonly svc: PluginService,
  ) {}

  /** 预检：上传 zip，返回 manifest/counts/conflicts，不写盘。 */
  @Post("preflight")
  async preflight(
    @Req() req: any,
    @Query("scope") scopeQ?: string,
    @Query("cwd") cwd?: string,
  ) {
    const scope = parseScope(scopeQ);
    validate(scope, cwd);
    const buf = await collectBody(req);
    if (buf.length === 0) throw new HttpException("empty body", HttpStatus.BAD_REQUEST);
    try {
      return this.svc.preflight(buf, scope, cwd);
    } catch (e) {
      throw new HttpException(
        { message: e instanceof Error ? e.message : String(e) },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** 安装：上传 zip，合并复制到目标。overwrite 由 query 控制。 */
  @Post("install")
  async install(
    @Req() req: any,
    @Query("scope") scopeQ?: string,
    @Query("cwd") cwd?: string,
    @Query("overwrite") overwrite?: string,
    @Query("includeLocalSettings") includeLocalSettings?: string,
  ) {
    const scope = parseScope(scopeQ);
    validate(scope, cwd);
    const buf = await collectBody(req);
    if (buf.length === 0) throw new HttpException("empty body", HttpStatus.BAD_REQUEST);
    const result = this.svc.install(buf, scope, cwd, {
      overwrite: overwrite === "1" || overwrite === "true",
      includeLocalSettings: includeLocalSettings === "1" || includeLocalSettings === "true",
    });
    if (!result.ok) {
      throw new HttpException({ message: result.error ?? "install_failed" }, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  /** 脚手架：在目标项目生成 .claude 骨架。 */
  @Post("scaffold")
  scaffold(@Body() body: { cwd?: string; name?: string; includeExamples?: boolean }) {
    const cwd = body?.cwd;
    if (!cwd || !isAbsolute(cwd)) {
      throw new HttpException("cwd_must_be_absolute", HttpStatus.BAD_REQUEST);
    }
    const result = this.svc.scaffold({ cwd, name: body.name, includeExamples: body.includeExamples });
    if (!result.ok) {
      throw new HttpException({ message: result.error ?? "scaffold_failed" }, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  /** 导出：把项目 .claude 打成场景包 zip 下载。 */
  @Get("export")
  exportProject(@Query("cwd") cwd: string, @Res() res: any) {
    if (!cwd || !isAbsolute(cwd)) {
      throw new HttpException("cwd_must_be_absolute", HttpStatus.BAD_REQUEST);
    }
    try {
      const { zipBuffer, fileName } = this.svc.exportProject(cwd);
      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      });
      res.send(zipBuffer);
    } catch (e) {
      throw new HttpException(String(e instanceof Error ? e.message : e), HttpStatus.BAD_REQUEST);
    }
  }
}

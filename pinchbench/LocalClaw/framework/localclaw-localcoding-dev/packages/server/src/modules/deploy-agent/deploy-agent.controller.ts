import { Controller, Post, Get, Body, Param, Req, Res, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import { DeployAgentService } from "./deploy-agent.service";

interface SubmitBody {
  packagePath: string;
  deployId: string;
  name: string;
  runtime?: string;
  start?: string;
  port?: string | number;
}

@Controller("api/deploy-agent")
export class DeployAgentController {
  constructor(
    @Inject(DeployAgentService) private readonly agent: DeployAgentService,
  ) {}

  // 提交部署：本地 server 读取代码包并转发到第三方，回传第三方原始状态码与响应体
  @Post("submit")
  async submit(@Body() body: SubmitBody, @Res() res: Response): Promise<void> {
    if (!body?.packagePath || !body?.deployId || !body?.name) {
      res.status(400).json({ error: "packagePath、deployId、name 均为必填" });
      return;
    }
    try {
      const result = await this.agent.submit(body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      res.status(502).json({ error: `转发部署请求失败: ${e?.message ?? e}` });
    }
  }

  // 订阅部署事件：把第三方 SSE 流原样转发给前端
  @Get("events/:deployId")
  async events(@Param("deployId") deployId: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const controller = new AbortController();
    req.on("close", () => controller.abort());

    let upstream: globalThis.Response;
    try {
      upstream = await this.agent.openEvents(deployId, controller.signal);
    } catch (e: any) {
      res.status(502).json({ error: `连接部署事件流失败: ${e?.message ?? e}` });
      return;
    }

    if (!upstream.ok || !upstream.body) {
      const text = upstream.body ? await upstream.text() : "";
      res.status(upstream.status || 502).json({ error: `事件流不可用: ${text || upstream.statusText}` });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    (res as any).flushHeaders?.();

    const reader = (upstream.body as any).getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {
      // 客户端断开或上游中止，正常结束
    } finally {
      res.end();
    }
  }
}

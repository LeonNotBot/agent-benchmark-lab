import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

/** 显式回环地址（非 127.0.0.0/8 段的特例）。 */
const LOOPBACK_EXACT = new Set(["::1", "::ffff:127.0.0.1"]);

/**
 * 对端地址是否本机回环。空地址（socket 已销毁）按非回环处理 → 拒绝。
 * 覆盖 IPv4 整段 127.0.0.0/8（不止 127.0.0.1）、IPv6 ::1、以及 dual-stack 下
 * 的 IPv4-mapped 形式 ::ffff:127.x。
 */
export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  if (addr.startsWith("127.")) return true;
  if (addr.startsWith("::ffff:127.")) return true;
  return LOOPBACK_EXACT.has(addr);
}

/**
 * 网关 /v1/* 只允许本机回环访问。
 *
 * 背景：网关持有各 endpoint 的真实上游 key，仅靠源码内固定常量 token 鉴权；而整个
 * Nest app 绑 0.0.0.0（Web UI 内网多用户需要）。不限制的话，内网任何读过源码的人都能
 * 借本机配置的上游 key 发请求 / 经模型外泄数据。
 *
 * CLI 永远是本机子进程，经 127.0.0.1:10086 打网关（见 buildGatewayEnv），故网关无需
 * 任何非回环可达性。这里在网关模块边界用对端地址（req.socket.remoteAddress，内核级、
 * 不可被 X-Forwarded-For 伪造——本服务未开启 trust proxy）一刀挡掉非本机访问。
 *
 * 与 controller 内的常量 token 校验构成纵深防御两层：网络层（本中间件）+ 应用层（token）。
 * 未来每-endpoint token（多用户隔离）落地后升级应用层，本网络层仍保留。
 */
@Injectable()
export class GatewayLoopbackMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({
        error: { code: "forbidden_non_local", message: "网关仅允许本机访问", type: "auth_error" },
      });
      return;
    }
    next();
  }
}

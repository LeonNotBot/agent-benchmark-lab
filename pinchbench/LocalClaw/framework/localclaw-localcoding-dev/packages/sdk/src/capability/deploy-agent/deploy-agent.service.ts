import { Injectable } from "@nestjs/common";
import { openAsBlob } from "fs";
import { existsSync, statSync } from "fs";
import { basename } from "path";
import { createHash, createHmac, randomBytes } from "crypto";

// 第三方自动部署系统基址；可用环境变量覆盖
const BASE_URL = (process.env.DEPLOY_AGENT_BASE_URL ?? "http://10.103.62.81:5000").replace(/\/+$/, "");

// 请求签名密钥（见 docs/deploy-接口签名规范.md）。缺省则不加签，由服务端决定是否放行。
const SIGN_SECRET = process.env.DEPLOY_AGENT_SIGN_SECRET ?? "";
const SIGN_KEY_ID = process.env.DEPLOY_AGENT_KEY_ID ?? "default";

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// 对 POST /api/deploy 生成 HMAC-SHA256 签名头。configJson 必须是写入 body 的同一份原文。
function buildSignHeaders(deployId: string, configJson: string): Record<string, string> {
  if (!SIGN_SECRET) return {};
  // deployId 直接拼进以 \n 分隔的 canonical 串；含换行/回车会串改字段边界（签名字段注入），
  // 服务端若按 \n 位置解析将解析错位。deployId 正常为 hash/无换行标识，含控制符即视为非法。
  if (/[\r\n]/.test(deployId)) {
    throw new Error("deployId 不能包含换行符（签名 canonical 串以换行分隔字段）");
  }
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const canonical = [
    "POST", "/api/deploy", timestamp, nonce, SIGN_KEY_ID, deployId, sha256Hex(configJson),
  ].join("\n");
  const signature = createHmac("sha256", SIGN_SECRET).update(canonical, "utf8").digest("hex");
  return {
    "X-Deploy-Key-Id": SIGN_KEY_ID,
    "X-Deploy-Timestamp": timestamp,
    "X-Deploy-Nonce": nonce,
    "X-Deploy-Signature": signature,
  };
}

export interface SubmitInput {
  packagePath: string;
  deployId: string;
  name: string;
  runtime?: string;
  start?: string;
  port?: string | number;
}

export interface SubmitResult {
  status: number;
  body: any;
}

@Injectable()
export class DeployAgentService {
  baseUrl(): string {
    return BASE_URL;
  }

  // 读取本地代码包，构造 multipart 转发到第三方 POST /api/deploy
  async submit(input: SubmitInput): Promise<SubmitResult> {
    const { packagePath, deployId, name, runtime, start, port } = input;
    if (!packagePath || !existsSync(packagePath) || !statSync(packagePath).isFile()) {
      return { status: 400, body: { error: `代码包文件不存在: ${packagePath}` } };
    }

    const config: Record<string, unknown> = { deployId, name };
    if (runtime) config.runtime = runtime;
    if (start) config.start = start;
    if (port !== undefined && port !== "") config.port = port;

    // 序列化定稿一次：同一份字符串既用于签名 hash，又写入 multipart，避免双方序列化差异
    const configJson = JSON.stringify(config);

    const blob = await openAsBlob(packagePath);
    const form = new FormData();
    form.append("file", blob, basename(packagePath));
    form.append("config", configJson);

    const resp = await fetch(`${BASE_URL}/api/deploy`, {
      method: "POST",
      body: form,
      headers: buildSignHeaders(deployId, configJson),
    });
    const text = await resp.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: resp.status, body };
  }

  // 打开第三方 SSE 事件流，返回原始可读流与中止器交给 controller 转发
  async openEvents(deployId: string, signal: AbortSignal): Promise<Response> {
    const url = `${BASE_URL}/api/assistant/deployments/${encodeURIComponent(deployId)}/events`;
    return fetch(url, { headers: { Accept: "text/event-stream" }, signal });
  }
}

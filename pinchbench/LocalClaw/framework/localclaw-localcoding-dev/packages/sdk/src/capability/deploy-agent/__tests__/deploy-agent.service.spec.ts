import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash, createHmac } from "crypto";
import { DeployAgentService } from "../deploy-agent.service";

/**
 * DeployAgentService 单测。
 *
 * 重 I/O(fetch 转发到第三方部署系统)。本地无网络可测:
 *  - baseUrl() 规整
 *  - submit() 包文件不存在的早返回校验(零网络)
 *  - submit() 正常路径:mock globalThis.fetch,验证请求构造(multipart / config)
 */

let dir: string;
let svc: DeployAgentService;
let pkg: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-test-"));
  pkg = join(dir, "app.zip");
  writeFileSync(pkg, "PK\x03\x04fake-zip");
  svc = new DeployAgentService();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("DeployAgentService — baseUrl", () => {
  it("去掉尾部斜杠,是合法 http(s) 基址", () => {
    expect(svc.baseUrl()).not.toMatch(/\/$/);
    expect(svc.baseUrl()).toMatch(/^https?:\/\//);
  });
});

describe("DeployAgentService — submit 早返回校验(零网络)", () => {
  it("包文件不存在 → 400,且不发起 fetch", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as never;
    const r = await svc.submit({
      packagePath: join(dir, "missing.zip"),
      deployId: "d1",
      name: "app",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("代码包文件不存在");
    expect(spy).not.toHaveBeenCalled();
  });

  it("packagePath 为空 → 400", async () => {
    const r = await svc.submit({ packagePath: "", deployId: "d1", name: "app" });
    expect(r.status).toBe(400);
  });
});

describe("DeployAgentService — submit 正常路径(mock fetch)", () => {
  it("POST 到 /api/deploy,body 为含 file+config 的 FormData", async () => {
    let captured: { url: string; init: any } | null = null;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as never;

    const r = await svc.submit({
      packagePath: pkg,
      deployId: "d1",
      name: "myapp",
      runtime: "node",
      port: 3000,
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(captured!.url).toBe(`${svc.baseUrl()}/api/deploy`);
    expect(captured!.init.method).toBe("POST");
    const form = captured!.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("file")).toBeInstanceOf(Blob);
    // config 是 JSON 字符串,含可选字段
    const cfg = JSON.parse(form.get("config") as string);
    expect(cfg).toMatchObject({ deployId: "d1", name: "myapp", runtime: "node", port: 3000 });
  });

  it("可选字段缺省时不写入 config(start/port 不出现)", async () => {
    let cfg: any;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      cfg = JSON.parse((init.body as FormData).get("config") as string);
      return new Response("{}", { status: 200 });
    }) as never;
    await svc.submit({ packagePath: pkg, deployId: "d2", name: "app2" });
    expect(cfg).toEqual({ deployId: "d2", name: "app2" }); // 无 runtime/start/port
  });

  it("响应非 JSON 时降级为 { raw }", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("plain text error", { status: 502 }),
    ) as never;
    const r = await svc.submit({ packagePath: pkg, deployId: "d3", name: "app3" });
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ raw: "plain text error" });
  });
});

describe("DeployAgentService — 请求签名", () => {
  const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  let d2: string; let pkg2: string;

  beforeEach(() => {
    d2 = mkdtempSync(join(tmpdir(), "deploy-sign-"));
    pkg2 = join(d2, "app.zip");
    writeFileSync(pkg2, "PK\x03\x04fake-zip");
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.DEPLOY_AGENT_SIGN_SECRET;
    delete process.env.DEPLOY_AGENT_KEY_ID;
    vi.resetModules();
    rmSync(d2, { recursive: true, force: true });
  });

  it("未配置 secret 时不带签名头", async () => {
    // 显式清空 secret 并重载模块：模块级 SIGN_SECRET 在 import 时定格，
    // 若依赖顶层 import 的实例，环境里若已存在该变量会误判——这里主动隔离。
    delete process.env.DEPLOY_AGENT_SIGN_SECRET;
    vi.resetModules();
    const { DeployAgentService: Svc } = await import("../deploy-agent.service");

    let init: any;
    globalThis.fetch = vi.fn(async (_u: any, i: any) => { init = i; return new Response("{}", { status: 200 }); }) as never;
    await new Svc().submit({ packagePath: pkg2, deployId: "d1", name: "app" });
    expect(init.headers?.["X-Deploy-Signature"]).toBeUndefined();
  });

  it("配置 secret 后带齐 4 个签名头，且签名可被同算法复算", async () => {
    process.env.DEPLOY_AGENT_SIGN_SECRET = "s3cr3t";
    process.env.DEPLOY_AGENT_KEY_ID = "k1";
    vi.resetModules();
    const { DeployAgentService: Svc } = await import("../deploy-agent.service");

    let captured: any;
    globalThis.fetch = vi.fn(async (_u: any, i: any) => { captured = i; return new Response("{}", { status: 200 }); }) as never;
    await new Svc().submit({ packagePath: pkg2, deployId: "dep-1", name: "app" });

    const h = captured.headers;
    expect(h["X-Deploy-Key-Id"]).toBe("k1");
    expect(h["X-Deploy-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(Number(h["X-Deploy-Timestamp"])).toBeGreaterThan(0);

    const configJson = (captured.body as FormData).get("config") as string;
    const canonical = ["POST", "/api/deploy", h["X-Deploy-Timestamp"], h["X-Deploy-Nonce"], "k1", "dep-1", sha256Hex(configJson)].join("\n");
    const expected = createHmac("sha256", "s3cr3t").update(canonical, "utf8").digest("hex");
    expect(h["X-Deploy-Signature"]).toBe(expected);
  });

  it("文档测试向量：固定输入算出固定签名", () => {
    const configJson = '{"deployId":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","name":"demo-app"}';
    const canonical = ["POST", "/api/deploy", "1750000000000", "0123456789abcdef0123456789abcdef", "default",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", sha256Hex(configJson)].join("\n");
    const sig = createHmac("sha256", "test-secret-do-not-use-in-prod").update(canonical, "utf8").digest("hex");
    expect(sig).toBe("8cf595d4886c539dc7bf8af25b82b2a559f508f6a41f8a3bf96a286b06ff53d0");
  });
});

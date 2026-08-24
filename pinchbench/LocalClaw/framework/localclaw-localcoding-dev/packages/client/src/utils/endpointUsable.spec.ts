import { describe, it, expect } from "vitest";
import { isEndpointUsable, isLocalEndpoint } from "./endpointUsable";

const ep = (over: Partial<Parameters<typeof isEndpointUsable>[0]> = {}) => ({
  enabled: true,
  models: [{ id: "m1" }],
  hasApiKey: true,
  apiType: "openai-compatible" as const,
  baseUrl: "https://api.example.com/v1",
  ...over,
});

describe("isLocalEndpoint", () => {
  it("127.0.0.1 / localhost(任意大小写) + openai-compatible → true", () => {
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1" })).toBe(true);
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "http://localhost:1234/v1" })).toBe(true);
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "http://LOCALHOST:1234" })).toBe(true);
  });
  it("非本地 host 或 anthropic → false", () => {
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "https://api.openai.com/v1" })).toBe(false);
    expect(isLocalEndpoint({ apiType: "anthropic", baseUrl: "http://127.0.0.1/v1" })).toBe(false);
  });
  it("本地名作子域的远程地址 → false（锚定 host，不裸子串匹配）", () => {
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "https://localhost.evil.com/v1" })).toBe(false);
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "https://mylocalhost.example.com" })).toBe(false);
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: "https://127.0.0.1.attacker.com/v1" })).toBe(false);
  });
  it("baseUrl 缺失不抛错 → false", () => {
    expect(isLocalEndpoint({ apiType: "openai-compatible", baseUrl: undefined as any })).toBe(false);
  });
});

describe("isEndpointUsable", () => {
  it("启用 + 有模型 + 有 key → true", () => {
    expect(isEndpointUsable(ep())).toBe(true);
  });
  it("本地无 key → 仍 true（本地豁免，治此前漏豁免的漂移）", () => {
    expect(isEndpointUsable(ep({ hasApiKey: false, baseUrl: "http://127.0.0.1:11434/v1" }))).toBe(true);
    expect(isEndpointUsable(ep({ hasApiKey: false, baseUrl: "http://localhost:1234/v1" }))).toBe(true);
  });
  it("云端无 key → false", () => {
    expect(isEndpointUsable(ep({ hasApiKey: false }))).toBe(false);
  });
  it("禁用 / 无模型 → false", () => {
    expect(isEndpointUsable(ep({ enabled: false }))).toBe(false);
    expect(isEndpointUsable(ep({ models: [] }))).toBe(false);
  });
});

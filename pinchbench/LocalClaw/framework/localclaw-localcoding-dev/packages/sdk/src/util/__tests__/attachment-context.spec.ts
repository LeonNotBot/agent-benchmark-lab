import { describe, it, expect } from "vitest";
import { isTextFile, buildPromptWithAttachments } from "../attachment-context";
import type { Attachment } from "@lenovo/agent-protocol";

const att = (over: Partial<Attachment> = {}): Attachment => ({
  name: "f.txt", mimeType: "text/plain", size: 10, base64: "", ...over,
});

describe("isTextFile", () => {
  it("text/* 与 application/json 判为文本", () => {
    expect(isTextFile(att({ mimeType: "text/markdown" }))).toBe(true);
    expect(isTextFile(att({ mimeType: "application/json" }))).toBe(true);
  });
  it("按扩展名兜底识别代码/配置文件", () => {
    expect(isTextFile(att({ name: "a.ts", mimeType: "application/octet-stream" }))).toBe(true);
    expect(isTextFile(att({ name: "a.yaml", mimeType: "x/y" }))).toBe(true);
  });
  it("未知二进制判为非文本", () => {
    expect(isTextFile(att({ name: "a.png", mimeType: "image/png" }))).toBe(false);
    expect(isTextFile(att({ name: "a.bin", mimeType: "application/octet-stream" }))).toBe(false);
  });
});

describe("buildPromptWithAttachments", () => {
  it("无附件原样返回 prompt", () => {
    expect(buildPromptWithAttachments("hello")).toBe("hello");
    expect(buildPromptWithAttachments("hello", [])).toBe("hello");
  });

  it("纯图片附件：只追加目录上下文，不内联内容", () => {
    const ctx = { directory: "/up", files: [{ originalName: "i.png", savedPath: "/up/i.png", relativePath: "i.png", mimeType: "image/png", size: 1 }] };
    const out = buildPromptWithAttachments("看图", [att({ name: "i.png", mimeType: "image/png" })], ctx);
    expect(out).toContain("附件目录: /up");
    expect(out).toContain("/up/i.png");
  });

  it("文本附件内联其 base64 解码内容", () => {
    const text = "console.log(1)";
    const b64 = Buffer.from(text, "utf-8").toString("base64");
    const out = buildPromptWithAttachments("看代码", [att({ name: "a.ts", mimeType: "text/plain", base64: b64 })]);
    expect(out).toContain("--- 文件: a.ts");
    expect(out).toContain(text);
  });

  it("二进制非图片附件：列出元信息与文本提取路径", () => {
    const ctx = { directory: "/up", files: [{ originalName: "d.docx", savedPath: "/up/d.docx", relativePath: "d.docx", mimeType: "application/vnd...", size: 99, extractedTextPath: "/up/d.txt" }] };
    const out = buildPromptWithAttachments("读文档", [att({ name: "d.docx", mimeType: "application/vnd...", size: 99 })], ctx);
    expect(out).toContain("已上传文件: d.docx");
    expect(out).toContain("文本提取文件: /up/d.txt");
  });
});

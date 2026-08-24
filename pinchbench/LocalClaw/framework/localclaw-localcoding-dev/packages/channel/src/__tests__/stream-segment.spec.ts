import { describe, it, expect } from "vitest";
import { shouldFlushSegment } from "../utils/stream-segment";

/**
 * 代码块保护逻辑测试。此纯函数是 golembot gateway.js 段落 flush 围栏保护的镜像，
 * patch 中内联了等价的 fenceCount % 2 === 0 判定，两者必须一致。
 */
describe("shouldFlushSegment", () => {
  it("无代码围栏的纯文本可 flush", () => {
    expect(shouldFlushSegment("这是一段普通文本")).toBe(true);
    expect(shouldFlushSegment("")).toBe(true);
  });

  it("成对闭合的完整代码块可 flush", () => {
    const seg = "看代码：\n```python\nprint(1)\n```";
    expect(shouldFlushSegment(seg)).toBe(true);
  });

  it("只含开头 ``` 未闭合时不可 flush", () => {
    const seg = "看代码：\n```python\nprint(1)";
    expect(shouldFlushSegment(seg)).toBe(false);
  });

  it("两个完整代码块（4 个围栏）可 flush", () => {
    const seg = "```js\na\n```\n文字\n```py\nb\n```";
    expect(shouldFlushSegment(seg)).toBe(true);
  });

  it("一个完整 + 一个未闭合（3 个围栏）不可 flush", () => {
    const seg = "```js\na\n```\n再看\n```py\nb";
    expect(shouldFlushSegment(seg)).toBe(false);
  });

  it("行内单个反引号不影响判定", () => {
    const seg = "用 `a` 和 `b` 两个变量";
    expect(shouldFlushSegment(seg)).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";

// 仅验证文本提取纯函数；mock 掉 browserPreview 以免顶层连锁加载 useAppStore（依赖 localStorage）。
// getBrowserPreviewUrl 默认原样返回传入路径，便于 tryAutoPreview 静态文件分支测试守卫。
vi.mock("./browserPreview", () => ({
  getBrowserPreviewUrl: (file: string) => file,
}));

import { extractLocalUrl, extractPreviewFile, tryAutoPreview } from "./autoPreview";

describe("extractLocalUrl", () => {
  it("提取 localhost 地址", () => {
    expect(extractLocalUrl("预览地址：http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("提取 127.0.0.1 地址", () => {
    expect(extractLocalUrl("服务已启动 http://127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
  });

  it("多个地址时取最后一个", () => {
    const text = "旧地址 http://localhost:3000 新地址 http://localhost:5173";
    expect(extractLocalUrl(text)).toBe("http://localhost:5173");
  });

  it("去掉尾部中文标点", () => {
    expect(extractLocalUrl("打开 http://localhost:3000。")).toBe("http://localhost:3000");
  });

  it("无地址返回 null", () => {
    expect(extractLocalUrl("纯静态页面已完成")).toBeNull();
    expect(extractLocalUrl("")).toBeNull();
  });
});

describe("extractPreviewFile", () => {
  it("提取绝对路径 HTML 文件", () => {
    expect(extractPreviewFile("预览文件：D:/proj/index.html")).toBe("D:/proj/index.html");
  });

  it("剥离反引号包裹（preview-guard v3 规则）", () => {
    expect(extractPreviewFile("预览文件：`D:\\temp\\t8\\index.html`")).toBe("D:\\temp\\t8\\index.html");
  });

  it("反引号包裹 + 尾部句号", () => {
    expect(extractPreviewFile("预览文件：`D:/proj/index.html`。")).toBe("D:/proj/index.html");
  });

  it("反引号包裹 + 路径含空格（会话目录名带空格）", () => {
    const text = "预览文件：`C:\\Users\\lsw\\localcoding-workspace\\sessions\\2026-07-02_帮我对一份 AI 大_8386ea\\report.html`";
    expect(extractPreviewFile(text)).toBe(
      "C:\\Users\\lsw\\localcoding-workspace\\sessions\\2026-07-02_帮我对一份 AI 大_8386ea\\report.html",
    );
  });

  it("提取 Windows 反斜杠路径", () => {
    expect(extractPreviewFile("预览文件：D:\\proj\\index.html")).toBe("D:\\proj\\index.html");
  });

  it("支持英文冒号", () => {
    expect(extractPreviewFile("预览文件: /home/u/app/page.html")).toBe("/home/u/app/page.html");
  });

  it("匹配 .htm 后缀", () => {
    expect(extractPreviewFile("预览文件：./index.htm")).toBe("./index.htm");
  });

  it("多个时取最后一个", () => {
    const text = "预览文件：a.html\n预览文件：b.html";
    expect(extractPreviewFile(text)).toBe("b.html");
  });

  it("去掉尾部中文标点", () => {
    expect(extractPreviewFile("预览文件：index.html。")).toBe("index.html");
  });

  it("无匹配返回 null", () => {
    expect(extractPreviewFile("预览地址：http://localhost:3000")).toBeNull();
    expect(extractPreviewFile("")).toBeNull();
  });
});

describe("tryAutoPreview shouldOpen 守卫", () => {
  it("守卫返回 false 时不打开、返回 null（用户已切到别的会话）", async () => {
    const openInBrowser = vi.fn();
    const url = await tryAutoPreview(
      "预览文件：D:/proj/index.html",
      openInBrowser,
      undefined,
      () => false,
    );
    expect(url).toBeNull();
    expect(openInBrowser).not.toHaveBeenCalled();
  });

  it("守卫返回 true 时正常打开静态文件", async () => {
    const openInBrowser = vi.fn();
    const url = await tryAutoPreview(
      "预览文件：D:/proj/index.html",
      openInBrowser,
      undefined,
      () => true,
    );
    expect(url).toBe("D:/proj/index.html");
    expect(openInBrowser).toHaveBeenCalledWith("D:/proj/index.html");
  });

  it("不传守卫时默认放行（向后兼容）", async () => {
    const openInBrowser = vi.fn();
    const url = await tryAutoPreview("预览文件：D:/proj/index.html", openInBrowser);
    expect(url).toBe("D:/proj/index.html");
    expect(openInBrowser).toHaveBeenCalledTimes(1);
  });
});

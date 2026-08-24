import { describe, it, expect } from "vitest";
import { isPlanForbiddenTool, PLAN_FORBIDDEN_TOOLS } from "../runner-spawn.service";

describe("isPlanForbiddenTool（plan 模式写保护，SDK 自实现）", () => {
  it("plan 模式下写类工具被拦截", () => {
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]) {
      expect(isPlanForbiddenTool("plan", tool)).toBe(true);
    }
  });

  it("plan 模式下读类工具放行", () => {
    for (const tool of ["Read", "Grep", "Glob", "WebFetch"]) {
      expect(isPlanForbiddenTool("plan", tool)).toBe(false);
    }
  });

  it("plan 模式下 ExitPlanMode 放行（须能提交计划）", () => {
    expect(isPlanForbiddenTool("plan", "ExitPlanMode")).toBe(false);
    expect(isPlanForbiddenTool("plan", "exit_plan_mode")).toBe(false);
  });

  it("非 plan 模式不拦截任何工具", () => {
    for (const mode of ["default", "acceptEdits", "bypassPermissions"]) {
      expect(isPlanForbiddenTool(mode, "Write")).toBe(false);
      expect(isPlanForbiddenTool(mode, "Bash")).toBe(false);
    }
  });

  it("禁止集合内容稳定（防误改）", () => {
    expect([...PLAN_FORBIDDEN_TOOLS].sort()).toEqual(
      ["Bash", "Edit", "MultiEdit", "NotebookEdit", "Write"],
    );
  });
});

import { describe, it, expect } from "vitest";
import { buildFingerprint, fingerprintsEqual } from "../runner-spawn.service";

describe("buildFingerprint / fingerprintsEqual", () => {
  // ── A2 核心：resumeSessionId 不参与复用判定 ──────────────────────
  // turn1 拿到 claudeSessionId 后，turn2 的 resumeSessionId 从 "" 变为该 id。
  // 这不应触发进程重建——被复用的就是 turn1 那个活进程，上下文在它内存里。
  it("turn1→turn2 仅 resumeSessionId 变化时，指纹仍相等（不重建）", () => {
    const turn1 = buildFingerprint({ cwd: "/proj", envHash: "ENV" });
    const turn2 = buildFingerprint({ cwd: "/proj", envHash: "ENV" });
    // resumeSessionId 不是 buildFingerprint 的入参，故两轮指纹天然一致
    expect(fingerprintsEqual(turn1, turn2)).toBe(true);
  });

  // ── 回归保护：真正的 spawn-time 变化仍必须触发重建 ───────────────
  it("cwd 变化 → 指纹不等（重建）", () => {
    const a = buildFingerprint({ cwd: "/proj-a", envHash: "ENV" });
    const b = buildFingerprint({ cwd: "/proj-b", envHash: "ENV" });
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it("envHash 变化（如切模型）→ 指纹不等（重建）", () => {
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV1" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV2" });
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it("permissionMode 不在指纹内：模式变化不影响复用（改走 set_permission_mode 热切）", () => {
    // permissionMode 已不是 buildFingerprint 入参，同 cwd+env 即复用，模式切换由热切处理
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV" });
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it("mcpConfigHash 变化（连接器增/改/删）→ 指纹不等（重建）", () => {
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV", mcpConfigHash: "m1" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV", mcpConfigHash: "m2" });
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it("mcpConfigHash 缺省时归一化为空串（向后兼容）", () => {
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV", mcpConfigHash: "" });
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it("disabledSkillsHash 变化（停用/启用技能）→ 指纹不等（重建）", () => {
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV", disabledSkillsHash: "" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV", disabledSkillsHash: "frontend-design" });
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it("disabledSkillsHash 缺省时归一化为空串（向后兼容）", () => {
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV", disabledSkillsHash: "" });
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it("完全相同的输入 → 指纹相等（复用）", () => {
    const a = buildFingerprint({ cwd: "/proj", envHash: "ENV", mcpConfigHash: "m" });
    const b = buildFingerprint({ cwd: "/proj", envHash: "ENV", mcpConfigHash: "m" });
    expect(fingerprintsEqual(a, b)).toBe(true);
  });
});

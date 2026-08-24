import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { configurePaths, __resetPathsForTest } from "../../../config/paths";
import {
  readDisabledSkills,
  isSkillDisabled,
  disabledSkillDenyRules,
  disabledSkillsHash,
} from "../skill-disabled";

describe("readDisabledSkills", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skill-disabled-"));
    configurePaths({ agentHomeDir: dir });
  });

  afterEach(() => {
    __resetPathsForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty set when file does not exist", () => {
    expect(readDisabledSkills()).toEqual(new Set());
  });

  it("returns parsed set when file is valid", () => {
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["skill-a", "skill-b"]));
    expect(readDisabledSkills()).toEqual(new Set(["skill-a", "skill-b"]));
  });

  it("filters out non-string entries", () => {
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(
      join(dir, "skills", ".disabled.json"),
      JSON.stringify(["skill-a", 42, null, "skill-b", undefined]),
    );
    expect(readDisabledSkills()).toEqual(new Set(["skill-a", "skill-b"]));
  });

  it("returns empty set on malformed JSON", () => {
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(join(dir, "skills", ".disabled.json"), "not json");
    expect(readDisabledSkills()).toEqual(new Set());
  });
});

describe("isSkillDisabled", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skill-disabled-"));
    configurePaths({ agentHomeDir: dir });
  });

  afterEach(() => {
    __resetPathsForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when skill is not in disabled list", () => {
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["skill-a"]));
    expect(isSkillDisabled("skill-b")).toBe(false);
  });

  it("returns true when skill is in disabled list", () => {
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["skill-a", "skill-b"]));
    expect(isSkillDisabled("skill-a")).toBe(true);
  });

  it("returns false for empty / non-string input", () => {
    expect(isSkillDisabled("")).toBe(false);
    expect(isSkillDisabled(null as any)).toBe(false);
    expect(isSkillDisabled(undefined as any)).toBe(false);
  });

  it("returns false for path-traversal attempts (safety)", () => {
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["../etc"]));
    expect(isSkillDisabled("../etc")).toBe(false);
    expect(isSkillDisabled("a/b")).toBe(false);
  });
});

describe("disabledSkillDenyRules", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skill-disabled-"));
    configurePaths({ agentHomeDir: dir });
    mkdirSync(join(dir, "skills"), { recursive: true });
  });

  afterEach(() => {
    __resetPathsForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when no skills disabled", () => {
    expect(disabledSkillDenyRules()).toEqual([]);
  });

  it("maps disabled skills to sorted Skill(<name>) rules", () => {
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["zeta", "alpha"]));
    expect(disabledSkillDenyRules()).toEqual(["Skill(alpha)", "Skill(zeta)"]);
  });

  it("drops unsafe names that could break rule parsing or escape", () => {
    writeFileSync(
      join(dir, "skills", ".disabled.json"),
      JSON.stringify(["good-skill", "bad(name)", "../etc", "a/b", "with space"]),
    );
    expect(disabledSkillDenyRules()).toEqual(["Skill(good-skill)"]);
  });
});

describe("disabledSkillsHash", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skill-disabled-"));
    configurePaths({ agentHomeDir: dir });
    mkdirSync(join(dir, "skills"), { recursive: true });
  });

  afterEach(() => {
    __resetPathsForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty string when none disabled (back-compat fingerprint)", () => {
    expect(disabledSkillsHash()).toBe("");
  });

  it("is order-independent (sorted)", () => {
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["b", "a"]));
    const h1 = disabledSkillsHash();
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["a", "b"]));
    expect(disabledSkillsHash()).toBe(h1);
    expect(h1).toBe("a,b");
  });

  it("changes when the disabled set changes", () => {
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["a"]));
    const h1 = disabledSkillsHash();
    writeFileSync(join(dir, "skills", ".disabled.json"), JSON.stringify(["a", "b"]));
    expect(disabledSkillsHash()).not.toBe(h1);
  });
});

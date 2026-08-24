import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseFrontmatter,
  scanCommands,
  scanAgents,
  scanSkills,
  scanRules,
  scanMemories,
} from "../project-capability.scanners";

let root: string;
let claude: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "projcap-"));
  claude = join(root, ".claude");
  // commands
  mkdirSync(join(claude, "commands"), { recursive: true });
  writeFileSync(join(claude, "commands", "build.md"),
    "---\ndescription: 固件编译\nargument-hint: <target>\n---\n# build\n");
  writeFileSync(join(claude, "commands", "prd.md"), "---\ndescription: 需求分析\n---\nbody");
  writeFileSync(join(claude, "commands", "notes.txt"), "not a command"); // 非 .md 跳过
  // agents
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(join(claude, "agents", "fw-build.md"),
    "---\ndescription: 编译管理\nmodel: claude-sonnet-4\n---\nagent");
  // skills
  mkdirSync(join(claude, "skills", "mcu-flash"), { recursive: true });
  writeFileSync(join(claude, "skills", "mcu-flash", "SKILL.md"),
    "---\nname: MCU Flash\ndescription: 烧录\nuser-invocable: true\n---\ncontent");
  mkdirSync(join(claude, "skills", "internal"), { recursive: true });
  writeFileSync(join(claude, "skills", "internal", "SKILL.md"),
    "---\ndescription: 内部\nuser-invocable: false\n---\nx");
  mkdirSync(join(claude, "skills", "broken"), { recursive: true }); // 无 SKILL.md 跳过
  // rules
  mkdirSync(join(claude, "rules"), { recursive: true });
  writeFileSync(join(claude, "rules", "coding-standard.md"), "# 编码规范\n正文");
  // memories
  mkdirSync(join(claude, "memories"), { recursive: true });
  writeFileSync(join(claude, "memories", "chip-database.yaml"), "a: 1");
  writeFileSync(join(claude, "memories", "notes.json"), "{}");
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("parseFrontmatter", () => {
  it("解析 --- 块的键值、布尔、内联数组", () => {
    const { meta, content } = parseFrontmatter(
      "---\nname: X\nuser-invocable: false\nallowed-tools: [Read, Write]\n---\nbody text",
    );
    expect(meta.name).toBe("X");
    expect(meta["user-invocable"]).toBe(false);
    expect(meta["allowed-tools"]).toEqual(["Read", "Write"]);
    expect(content.trim()).toBe("body text");
  });
  it("无 frontmatter 时返回空 meta + 原文", () => {
    const { meta, content } = parseFrontmatter("just text");
    expect(meta).toEqual({});
    expect(content).toBe("just text");
  });
});

describe("scanCommands", () => {
  it("扫出 .md 命令并解析 description/argument-hint，跳过非 .md", () => {
    const cmds = scanCommands(join(claude, "commands"));
    const names = cmds.map((c) => c.name).sort();
    expect(names).toEqual(["build", "prd"]);
    const build = cmds.find((c) => c.name === "build")!;
    expect(build.description).toBe("固件编译");
    expect(build.argumentHint).toBe("<target>");
  });
  it("目录不存在返回空数组", () => {
    expect(scanCommands(join(claude, "nope"))).toEqual([]);
  });
});

describe("scanAgents", () => {
  it("扫出子代理并解析 description/model", () => {
    const agents = scanAgents(join(claude, "agents"));
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "fw-build", description: "编译管理", model: "claude-sonnet-4",
    });
  });
});

describe("scanSkills", () => {
  it("扫出技能，跳过无 SKILL.md 的目录，保留 userInvocable 标记", () => {
    const skills = scanSkills(join(claude, "skills"));
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual(["internal", "mcu-flash"]);
    expect(byName["mcu-flash"].displayName).toBe("MCU Flash");
    expect(byName["mcu-flash"].userInvocable).toBe(true);
    expect(byName["internal"].userInvocable).toBe(false);
    expect(byName["mcu-flash"].source).toBe("project");
  });
});

describe("scanRules", () => {
  it("扫出规则，取首个 H1 作标题", () => {
    const rules = scanRules(join(claude, "rules"));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: "coding-standard", title: "编码规范" });
  });
});

describe("scanMemories", () => {
  it("扫出知识库条目并识别格式", () => {
    const mems = scanMemories(join(claude, "memories"));
    const byName = Object.fromEntries(mems.map((m) => [m.name, m.format]));
    expect(byName["chip-database.yaml"]).toBe("yaml");
    expect(byName["notes.json"]).toBe("json");
  });
});

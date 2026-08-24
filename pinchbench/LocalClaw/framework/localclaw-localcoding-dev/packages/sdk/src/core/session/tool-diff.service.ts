import { Injectable, Inject } from "@nestjs/common";
import { readFileSync } from "fs";
import { join, relative, isAbsolute, sep } from "path";
import * as diff from "diff";
import type { FileDiff, DiffHunk, DiffLine } from "@lenovo/agent-protocol";
import { SessionService } from "./session.service";

// 单个文件的工具操作（按时间序）
type FileOp =
  | { kind: "write"; content: string; created: boolean; ts: number }
  | { kind: "edit"; oldStr: string; newStr: string; ts: number }
  | { kind: "multiedit"; edits: Array<{ oldStr: string; newStr: string }>; ts: number };

// 单轮编辑的 diff 结果：roundKey 为该轮首条 assistant 消息 uuid（前端卡片稳定 key）
export type SessionRoundDiff = {
  roundKey: string;
  diffs: FileDiff[];
};

@Injectable()
export class ToolDiffService {
  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
  ) {}

  // 基于当前会话的 Write/Edit/MultiEdit 工具调用重建 diff（无需 git）
  buildSessionDiff(sessionId: string): FileDiff[] {
    const history = this.sessionService.getSessionHistory(sessionId);
    if (!history?.session.cwd) return [];
    return this.diffFromMessages(history.session.cwd, history.messages);
  }

  // 按「轮次」拆分并各自重建 diff：以 user_prompt 作为每轮起点，
  // 汇总卡片（1.png）据此展示「本轮编辑的文件」。返回按轮次顺序，
  // 每项含该轮 assistant 消息 uuid（roundKey，前端卡片稳定 key）与文件 diff。
  buildRoundDiffs(sessionId: string): SessionRoundDiff[] {
    const history = this.sessionService.getSessionHistory(sessionId);
    if (!history?.session.cwd) return [];
    const cwd = history.session.cwd;
    const rounds = splitRounds(history.messages);
    const out: SessionRoundDiff[] = [];
    for (const round of rounds) {
      const diffs = this.diffFromMessages(cwd, round.messages);
      if (diffs.length === 0) continue;
      out.push({ roundKey: round.key, diffs });
    }
    return out;
  }

  // 从一批消息重建 diff 的核心（buildSessionDiff / buildRoundDiffs 共用）。
  private diffFromMessages(cwd: string, messages: any[]): FileDiff[] {
    const { opsByFile, createdSet } = this.collectOps(messages);
    const results: FileDiff[] = [];
    // key 为归一化路径（去重同一文件的不同写法）；absPath 为真实路径（读盘用）。
    for (const [key, { absPath, ops }] of opsByFile) {
      const relPath = this.toRel(cwd, absPath);
      const fileDiff = this.buildFileDiff(absPath, relPath, ops, createdSet.has(key));
      if (fileDiff) results.push(fileDiff);
    }
    // collectOps 已按归一化路径（normPathKey）聚合，一文件必只一条，无需再去重。
    results.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
    return results;
  }

  private toRel(cwd: string, absPath: string): string {
    if (!isAbsolute(absPath)) return absPath.split(/[\\/]/).join("/");
    const rel = relative(cwd, absPath);
    return rel.split(sep).join("/");
  }

  // 从消息流提取 Write/Edit/MultiEdit 调用，按「归一化路径」聚合（去重同一文件的不同写法：
  // Windows 分隔符 \ vs /、盘符大小写等，否则同一文件会拆成多条重复 diff）。
  private collectOps(messages: any[]): {
    opsByFile: Map<string, { absPath: string; ops: FileOp[] }>;
    createdSet: Set<string>;
  } {
    const opsByFile = new Map<string, { absPath: string; ops: FileOp[] }>();
    const createdSet = new Set<string>(); // 存归一化 key
    // toolUseId -> { key } 用于关联 tool_result 判断 created/overwrite
    const pending = new Map<string, { key: string }>();
    let order = 0;

    for (const msg of messages) {
      const role = (msg as any)?.message?.role ?? (msg as any)?.type;
      const content = Array.isArray((msg as any)?.message?.content)
        ? (msg as any).message.content
        : [];

      for (const block of content) {
        if (role === "assistant" && block?.type === "tool_use") {
          this.handleToolUse(block, opsByFile, pending, order++);
        } else if (block?.type === "tool_result") {
          this.handleToolResult(block, pending, createdSet);
        }
      }
    }
    return { opsByFile, createdSet };
  }

  private handleToolUse(
    block: any,
    opsByFile: Map<string, { absPath: string; ops: FileOp[] }>,
    pending: Map<string, { key: string }>,
    ts: number,
  ): void {
    const name: string = block.name ?? "";
    const input = block.input ?? {};
    const absPath: string = input.file_path || input.filePath || "";
    if (!absPath) return;
    const key = normPathKey(absPath);

    const push = (op: FileOp) => {
      const entry = opsByFile.get(key) ?? { absPath, ops: [] };
      entry.ops.push(op);
      opsByFile.set(key, entry);
    };

    if (name === "Write") {
      push({ kind: "write", content: String(input.content ?? ""), created: false, ts });
      pending.set(block.id, { key });
    } else if (name === "Edit") {
      push({ kind: "edit", oldStr: String(input.old_string ?? ""), newStr: String(input.new_string ?? ""), ts });
    } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
      const edits = input.edits.map((e: any) => ({
        oldStr: String(e.old_string ?? ""),
        newStr: String(e.new_string ?? ""),
      }));
      push({ kind: "multiedit", edits, ts });
    }
  }

  private handleToolResult(
    block: any,
    pending: Map<string, { key: string }>,
    createdSet: Set<string>,
  ): void {
    const id = block.tool_use_id;
    const info = id ? pending.get(id) : undefined;
    if (!info) return;
    pending.delete(id);
    const text = extractResultText(block.content);
    // Write 工具结果含 "File created" 表示新建，否则为覆盖既有文件
    if (/created successfully|File created/i.test(text)) createdSet.add(info.key);
  }

  // 由操作序列 + 当前磁盘内容重建单文件 diff
  private buildFileDiff(
    absPath: string,
    relPath: string,
    ops: FileOp[],
    created: boolean,
  ): FileDiff | null {
    if (ops.length === 0) return null;
    const ts = ops[ops.length - 1].ts;
    const opCount = ops.reduce((n, o) => n + (o.kind === "multiedit" ? o.edits.length : 1), 0);

    let newContent: string | null = readDisk(absPath);
    const status: "added" | "modified" | "deleted" =
      newContent === null ? "deleted" : created ? "added" : "modified";

    if (newContent === null) {
      // 文件已删除：仅标记，无完整内容
      return { path: relPath, status: "deleted", hunks: [], linesAdded: 0, linesRemoved: 0, opCount, modifiedAt: ts };
    }

    // created（新建文件）→ 原内容为空；否则逆序回滚还原原始内容。
    // Write 覆盖既有文件时无法精确还原其覆盖前内容，rollback 会在遇到 Write 处停止，
    // 得到的是 Write 时刻写入的内容（近似），后续 Edit 仍能精确回滚。
    const oldContent = created ? "" : rollback(newContent, ops);

    if (oldContent === newContent) return null;
    return buildDiffFromContents(relPath, status, oldContent, newContent, opCount, ts);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

// 路径归一化 key：统一分隔符为 /、去末尾斜杠、大小写不敏感文件系统下统一小写。
// 用于按文件聚合去重——避免同一文件因 file_path 写法差异（\ vs /、盘符/大小写）被拆成多条 diff。
function normPathKey(p: string): string {
  let s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows 与 macOS 默认文件系统大小写不敏感（darwin/win32），Windows 盘符亦然：
  // 整体小写化作为 key（仅用于比较，不影响真实读盘路径），否则同一文件大小写不同会拆成两条并误判新建/修改。
  const caseInsensitiveFs = process.platform === "win32" || process.platform === "darwin";
  if (caseInsensitiveFs || /^[a-zA-Z]:\//.test(s)) s = s.toLowerCase();
  return s;
}

// 把消息流按轮次切分：user_prompt（用户发言）作为每轮起点。
// roundKey 取该轮首条 assistant 消息的 uuid（稳定、跨刷新一致）；
// 无 assistant 消息则回退用 user_prompt 的 uuid/序号。首个 user_prompt 前的消息忽略。
function splitRounds(messages: any[]): Array<{ key: string; messages: any[] }> {
  const rounds: Array<{ key: string; messages: any[] }> = [];
  let cur: { key: string; messages: any[] } | null = null;
  let idx = 0;
  for (const msg of messages) {
    if (msg?.type === "user_prompt") {
      // 起始用占位 key，始终被本轮首条 assistant uuid 覆盖 —— 与前端 mapRoundKeyToLastId
      // 「总是取首条 assistant uuid」保持一致，避免 user_prompt 带 uuid 时两边 key 对不上。
      cur = { key: `round-${idx}`, messages: [] };
      rounds.push(cur);
      idx++;
      continue;
    }
    if (!cur) continue;
    cur.messages.push(msg);
    // 首条 assistant 消息 uuid 作为稳定 key（前端据此定位该轮末条 assistant 挂载汇总卡）
    if (msg?.type === "assistant" && (msg.uuid || msg.id) && cur.key.startsWith("round-")) {
      cur.key = msg.uuid ?? msg.id;
    }
  }
  return rounds;
}

function readDisk(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

// 逆序回滚 Edit/MultiEdit：用 newStr→oldStr 还原；Write 操作之前的内容视为空
function rollback(current: string, ops: FileOp[]): string {
  let content = current;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.kind === "write") {
      // 回滚到该 Write 之前：无法还原，返回当前累积（停止回滚）
      return content;
    } else if (op.kind === "edit") {
      content = replaceLast(content, op.newStr, op.oldStr);
    } else {
      for (let j = op.edits.length - 1; j >= 0; j--) {
        content = replaceLast(content, op.edits[j].newStr, op.edits[j].oldStr);
      }
    }
  }
  return content;
}

function replaceLast(haystack: string, find: string, replace: string): string {
  if (!find) return haystack;
  const idx = haystack.lastIndexOf(find);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replace + haystack.slice(idx + find.length);
}

function buildDiffFromContents(
  relPath: string,
  status: "added" | "modified" | "deleted",
  oldContent: string,
  newContent: string,
  opCount: number,
  modifiedAt: number,
): FileDiff {
  const patch = diff.structuredPatch(relPath, relPath, oldContent, newContent, "", "");
  const hunks = convertHunks(patch.hunks);
  const linesAdded = hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0);
  const linesRemoved = hunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "remove").length, 0);
  return { path: relPath, status, oldContent, newContent, hunks, linesAdded, linesRemoved, opCount, modifiedAt };
}

function convertHunks(
  rawHunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }>,
): DiffHunk[] {
  return rawHunks.map((h) => {
    const lines: DiffLine[] = [];
    let oldLine = h.oldStart;
    let newLine = h.newStart;
    for (const line of h.lines) {
      if (line.startsWith("+")) lines.push({ type: "add", content: line.slice(1), newLineNumber: newLine++ });
      else if (line.startsWith("-")) lines.push({ type: "remove", content: line.slice(1), oldLineNumber: oldLine++ });
      else lines.push({ type: "context", content: line.slice(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
    }
    return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines };
  });
}

function extractResultText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join(" ");
  }
  return "";
}

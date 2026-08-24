// buildReviewTree 回归测试：核心防「只有文件的叶目录」里同名文件重复
// （finalize 曾在 children 里既拼 finalize(cur) 又拼 cur.files，导致文件出现两次）。
import { describe, it, expect } from "vitest";
import type { FileDiff } from "@lenovo/agent-protocol";
import { buildReviewTree, type ReviewTreeNode } from "./ReviewFileTree";

function fd(path: string): FileDiff {
  return { path, status: "modified", hunks: [], linesAdded: 1, linesRemoved: 1 } as FileDiff;
}

// 收集树里所有文件节点的 path（深度优先）
function filePaths(nodes: ReviewTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: ReviewTreeNode[]) => {
    for (const n of ns) {
      if (n.isDir) walk(n.children);
      else out.push(n.path);
    }
  };
  walk(nodes);
  return out;
}

describe("buildReviewTree", () => {
  it("叶目录里的文件只出现一次（不因 finalize 二重拼接而重复）", () => {
    const tree = buildReviewTree([fd("index.html"), fd("src/store/globalConfig.ts")]);
    const paths = filePaths(tree);
    expect(paths.filter((p) => p === "src/store/globalConfig.ts")).toHaveLength(1);
    expect(paths.sort()).toEqual(["index.html", "src/store/globalConfig.ts"]);
  });

  it("同一目录多文件各自只出现一次", () => {
    const tree = buildReviewTree([fd("src/a.ts"), fd("src/b.ts")]);
    expect(filePaths(tree).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("嵌套目录 + 单链压缩：文件不丢不重", () => {
    const tree = buildReviewTree([fd("a/b/c/deep.ts"), fd("a/top.ts")]);
    expect(filePaths(tree).sort()).toEqual(["a/b/c/deep.ts", "a/top.ts"]);
  });
});

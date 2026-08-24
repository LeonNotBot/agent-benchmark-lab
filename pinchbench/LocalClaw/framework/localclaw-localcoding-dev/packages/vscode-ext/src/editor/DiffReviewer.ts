import * as vscode from "vscode";
import * as path from "path";
import { computeProposedContent } from "./computeProposed";

/** 提案内容的虚拟文档 scheme,右侧 diff 显示 AI 改动后的内容。 */
const PROPOSED_SCHEME = "localcoding-proposed";

/** 一次待审阅的写操作。 */
export interface ReviewRequest {
  toolUseId: string;
  toolName: string; // Write | Edit | MultiEdit
  input: Record<string, unknown>;
}

/** 审阅结果。approved=true → 放行落盘;false → 拒绝。 */
export interface ReviewResult {
  approved: boolean;
  message?: string;
}

/**
 * 原生 diff 审阅门。收到 Write/Edit 的 permission.request 后,在改动落盘【前】用
 * vscode.diff 弹原生对比(左=磁盘现状,右=AI 提案),用户接受/拒绝后返回决策。
 * 只在 default 权限模式生效(其余模式后端直接放行,不发 permission.request)。
 */
export class DiffReviewer {
  private readonly log: vscode.OutputChannel;
  /** 虚拟文档内容缓存:key=uri.path,value=提案内容。 */
  private readonly proposedContent = new Map<string, string>();
  private disposable: vscode.Disposable;

  constructor(log: vscode.OutputChannel) {
    this.log = log;
    this.disposable = vscode.workspace.registerTextDocumentContentProvider(
      PROPOSED_SCHEME,
      {
        provideTextDocumentContent: (uri) =>
          this.proposedContent.get(uri.path) ?? "",
      },
    );
  }

  dispose(): void {
    this.disposable.dispose();
    this.proposedContent.clear();
  }

  /** 从工具入参解析目标文件绝对路径。无法解析返回空。 */
  private resolveFilePath(input: Record<string, unknown>): string {
    const p = input.file_path ?? input.filePath ?? input.path;
    return typeof p === "string" ? p : "";
  }

  /** 审阅一次写操作:弹原生 diff + 询问决策。 */
  async review(req: ReviewRequest): Promise<ReviewResult> {
    const filePath = this.resolveFilePath(req.input);
    if (!filePath) {
      this.log.appendLine(`[diff] 无法解析文件路径,放行 ${req.toolName}`);
      return { approved: true };
    }
    const oldContent = await this.readDisk(filePath);
    const newContent = computeProposedContent(req.toolName, req.input, oldContent);

    const base = path.basename(filePath);
    const oldKey = `/old/${req.toolUseId}/${base}`;
    const newKey = `/new/${req.toolUseId}/${base}`;
    this.proposedContent.set(oldKey, oldContent);
    this.proposedContent.set(newKey, newContent);
    const left = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: oldKey });
    const right = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: newKey });

    const verb = oldContent ? "改动" : "新建";
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${base} (审阅 AI ${verb})`,
      { preview: true },
    );

    const pick = await vscode.window.showInformationMessage(
      `AI 想${verb} ${base},是否接受?`,
      { modal: true },
      "接受",
      "拒绝",
    );
    // 清理虚拟内容,关闭 diff 编辑器。
    this.proposedContent.delete(oldKey);
    this.proposedContent.delete(newKey);

    if (pick === "接受") return { approved: true };
    return {
      approved: false,
      message: "User declined this action. Do not retry with variations or alternative approaches.",
    };
  }

  /** 读磁盘现状,文件不存在(新建场景)返回空串。 */
  private async readDisk(filePath: string): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return "";
    }
  }
}

export { PROPOSED_SCHEME };

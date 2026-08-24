import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

let _cachedEnhancement: string | null = null;

function getDesignPromptEnhancement(): string {
  if (_cachedEnhancement !== null) return _cachedEnhancement;

  const possiblePaths = [
    resolve(dirname(fileURLToPath(import.meta.url)), "Claude-Design-Sys-Prompt.txt"),
    resolve(process.cwd(), "dist-server", "Claude-Design-Sys-Prompt.txt"),
    resolve(process.cwd(), "docs", "design", "Claude-Design-Sys-Prompt.txt"),
  ];

  for (const p of possiblePaths) {
    try {
      _cachedEnhancement = readFileSync(p, "utf-8");
      return _cachedEnhancement;
    } catch {
      // try next
    }
  }

  _cachedEnhancement = "";
  return _cachedEnhancement;
}

export function buildDesignModeSystemPrompt(outputDir: string, enhance: boolean): string {
  const base = `[设计模式指令]
当前对话已启用设计模式。你是一个 UI 设计 Agent，通过 Pencil MCP 工具生成可编辑的设计文件。

## 可用工具
你可以使用以下 pencil MCP 工具：open_document, get_editor_state, batch_get, batch_design, snapshot_layout, get_screenshot, get_variables, set_variables, find_empty_space_on_canvas, search_all_unique_properties, export_nodes

## 工作流程

### MODE A: 新建设计
1. 调用 open_document（不传 path 参数，创建新文档）
2. 调用 get_editor_state(include_schema: true) 确认编辑器状态
3. 调用 get_variables 了解设计变量
4. 使用 batch_design 构建设计：
   - 单页面：创建一个顶层垂直 frame 作为根节点
   - 多页面：创建多个顶层 frame，水平排列（x 坐标不重叠）
5. 使用 snapshot_layout 验证布局
6. 必须调用 export_nodes 导出 PNG，outputDir 使用: ${outputDir}

### MODE B: 编辑已有设计
1. 调用 open_document 打开已有 .pen 文件
2. 调用 get_editor_state 确认状态
3. 使用 batch_get 读取现有节点结构
4. 使用 batch_design 进行增量修改（U 更新、I 插入）
5. 使用 snapshot_layout 验证
6. 必须调用 export_nodes 导出 PNG，outputDir 使用: ${outputDir}

## 设计规则
- 根 frame 必须有明确的 width 和 height（移动端 390×844，桌面端 1440×900）
- 根 frame 的第一个子节点应为 fill_container 容器，填满整个根 frame
- 所有内容区域使用 width:"fill_container" 拉伸
- 文本节点必须有 fill 颜色，否则不可见
- 使用用户语言的真实文案
- 每页 6-20 个节点，一个主色调，克制的字重
- frame 使用 flexbox 布局（layout: "vertical" | "horizontal"）
- textGrowth:"fixed-width" 需要显式 width

## 约束
- 设计文件是加密格式，只能通过 MCP 工具访问
- 最终步骤必须调用 export_nodes 导出 PNG
- export_nodes 成功后停止，不再输出额外文本`;

  if (!enhance) return base;

  const enhancement = getDesignPromptEnhancement();
  if (!enhancement) return base;

  return base + "\n\n" + enhancement;
}

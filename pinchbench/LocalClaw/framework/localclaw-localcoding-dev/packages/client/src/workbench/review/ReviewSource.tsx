// 源文件视图：纯文本代码展示 / 富文本 markdown 渲染。
// 代码高亮复用共享 CodePreview（扩展名→语言映射统一在 CodePreview 内）。
import MDContent from "../../render/markdown";
import { CodePreview, CODE_LANGS, getExt } from "../CodePreview";

interface Props {
  filePath: string;
  content: string;
  plainText: boolean;
  noWrap: boolean;
}

export function ReviewSource({ filePath, content, plainText, noWrap }: Props) {
  const ext = getExt(filePath);
  const isMarkdown = ext === "md" || ext === "markdown";

  // 富文本 markdown 渲染（plainText 关闭时）
  if (isMarkdown && !plainText) {
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="prose prose-sm max-w-none text-[12px]">
          <MDContent text={content} />
        </div>
      </div>
    );
  }

  // plainText 模式下的 markdown 按纯文本展示，不做语法高亮
  const language = plainText && isMarkdown ? undefined : CODE_LANGS[ext];
  return (
    <div className="flex-1 overflow-auto p-4">
      <CodePreview content={content} language={language} noWrap={noWrap} />
    </div>
  );
}

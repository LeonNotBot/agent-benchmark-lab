// 回放面板错误边界：捕获回放渲染期异常并显示详情，避免崩溃导致查看器无响应。
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ReplayErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    console.error("[ReplayPanel] 渲染异常:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-sm font-medium text-red-500">回放渲染出错</div>
          <pre className="max-w-2xl overflow-auto rounded-lg bg-bg-200 p-3 text-left text-xs text-text-300">
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack?.slice(0, 800)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg border border-border-300 px-4 py-2 text-xs text-text-200 hover:bg-bg-200"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Component, type ReactNode } from "react";
import { trackError } from "./client";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * 顶层错误边界:捕获 React 渲染期异常,上报后展示降级 UI。
 * 包裹 AppShell(见 frontend.tsx)。禁用 telemetry 时 trackError 自动 no-op。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }): void {
    trackError(error.message, {
      stack: sanitize(error.stack),
      componentStack: sanitize(errorInfo.componentStack),
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: "sans-serif" }}>
          <h2>应用出现错误</h2>
          <p>已记录该问题。请尝试重新加载。</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 路径脱敏:去掉绝对路径里的用户名段,避免 PII 外泄。 */
function sanitize(s?: string): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/[A-Za-z]:\\Users\\[^\\]+/g, "C:\\Users\\<user>")
    .replace(/\/(?:home|Users)\/[^/]+/g, "/<home>/<user>");
}

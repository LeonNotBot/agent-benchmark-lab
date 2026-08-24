// Workbench 域 selector hook（S2）。
// 内部指向全局 useAppStore（同一实例），组件通过本 hook 表达
// "我只依赖 workbench 域"——为后续 S4（独立 store 实例）做准备。
import { useAppStore } from "../../store/useAppStore";
import type { WorkbenchSlice } from "./workbenchSlice";

type Selector<T> = (state: WorkbenchSlice) => T;

/**
 * workbench 域的 selector hook。
 * 用法与 useAppStore 一致：
 *   const tabs = useWorkbenchStore(s => s.workbenchTabs);
 */
export function useWorkbenchStore<T>(selector: Selector<T>): T {
  return useAppStore(selector as any);
}

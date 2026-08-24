// Thread 域 selector hook（S2）。
// 内部指向全局 useAppStore（同一实例），组件通过本 hook 表达
// "我只依赖 thread 域"——为后续独立 store（如需要）做准备。
import { useAppStore } from "../../store/useAppStore";
import type { ThreadSlice } from "./threadSlice";

type Selector<T> = (state: ThreadSlice) => T;

/**
 * thread 域的 selector hook。
 * 用法与 useAppStore 一致：
 *   const attachments = useThreadStore(s => s.attachments);
 */
export function useThreadStore<T>(selector: Selector<T>): T {
  return useAppStore(selector as any);
}

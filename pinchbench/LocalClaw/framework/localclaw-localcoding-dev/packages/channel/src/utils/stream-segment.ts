/**
 * 流式分段工具：判断一段「待 flush 的完整段落」是否可以安全发出。
 *
 * 此文件是 golembot gateway.js 段落 flush 代码块保护逻辑的**纯函数镜像**，
 * 供单元测试覆盖。patch 中内联了等价实现（不引外部依赖以避免 bundle 解析问题），
 * 两者逻辑必须保持一致。
 */

/**
 * 判断 segment 内的 Markdown 代码围栏（```）是否全部成对闭合。
 *
 * gateway 按 \n\n 分段实时下发。代码块内部常含空行，会被段落分割切断，
 * 导致拆出「只含开头 ``` 但无闭合」的气泡，微信端渲染为格式错乱。
 *
 * 规则：segment 中 ``` 出现次数为偶数 → 围栏成对闭合，可安全 flush；
 * 奇数 → 代码块跨段未闭合，应暂缓 flush，继续累积到围栏闭合。
 *
 * @returns true 表示可以 flush，false 表示应继续缓冲
 */
export function shouldFlushSegment(segment: string): boolean {
  const fenceCount = (segment.match(/```/g) || []).length;
  return fenceCount % 2 === 0;
}

// 上游请求重试：在向客户端写任何数据前调用，安全可重试。
//
// 背景：sky 等转换型上游存在间歇性故障（实测同一请求体流式失败率约 17%），
// 表现为 5xx，或 400 "Improperly formed request"（与请求格式无关的瞬时错误）。
// 有限次重试可把单轮失败率压到可忽略。

import { logger } from "../../util/logger";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 300;

// 可重试的 400 错误体特征（sky 间歇性转换失败）。普通格式错误不命中，不会被重试。
const RETRYABLE_400_PATTERNS = [/improperly formed request/i];

export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const payload = JSON.stringify(body);
  let last: Response | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const resp = await fetch(url, { method: "POST", headers, body: payload });
    if (resp.ok) return resp;
    const retryable = await isRetryable(resp);
    if (!retryable || attempt === MAX_ATTEMPTS) return resp;
    logger.warn(`[gateway] upstream ${resp.status} attempt ${attempt}/${MAX_ATTEMPTS}, retrying...`);
    last = resp;
    await sleep(BASE_DELAY_MS * attempt);
  }
  return last as Response;
}

// 判断响应是否值得重试。会消费 body，故仅在确定不再使用该 resp 时调用。
async function isRetryable(resp: Response): Promise<boolean> {
  if (resp.status >= 500 || resp.status === 408 || resp.status === 429) return true;
  if (resp.status === 400) {
    try {
      const text = await resp.clone().text();
      return RETRYABLE_400_PATTERNS.some((re) => re.test(text));
    } catch {
      return false;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

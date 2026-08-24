import { Injectable, Logger } from "@nestjs/common";

// RAGFlow 接入配置。凭据与端点一律从环境变量读取，绝不硬编码进源码
// （RAGFLOW_KEY 曾明文提交、随多分支推到 GitLab，现已收口到 .env / .env.example）。
// 两个 base URL 是内网端点（非密钥），保留默认值使现有部署行为不变；
// RAGFLOW_KEY 无默认值——缺失时模块加载即告警一次（见下），避免明文回归。
const RAGFLOW_BASE = process.env.RAGFLOW_BASE || "http://teamai-kb-test.lenovo.com";
// 文件管理接口（上传/列表/解析/删除/下载）直接走 RAG 服务
const RAGFLOW_FILE_BASE = process.env.RAGFLOW_FILE_BASE || "http://10.103.224.175:9980";
const RAGFLOW_KEY = process.env.RAGFLOW_KEY || "";

// 缺 key 在模块加载时告警一次（而非每请求）：getHeaders 每次请求都被调，放那里会刷屏。
if (!RAGFLOW_KEY) {
  new Logger("KnowledgeService").warn(
    "[ragflow] RAGFLOW_KEY 未设置（环境变量缺失）——知识库请求将鉴权失败。" +
      "请在 .env 或部署环境中配置 RAGFLOW_KEY。",
  );
}

interface RAGFlowResponse<T = unknown> {
  code: string;
  msg: string;
  success: boolean;
  data: T;
}

// 文件管理接口的返回格式不同：{ code: 0, message: "success", data: ... }
interface RAGFlowFileResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

interface DatasetItem {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  sourceFrom?: string;
  documentCount?: number;
  updateTime?: string;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAGFLOW_KEY}`,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<RAGFlowResponse<T>> {
    const url = new URL(`${RAGFLOW_BASE}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    const data = (await res.json()) as RAGFlowResponse<T>;
    if (!data.success) {
      this.logger.warn(`[ragflow] ${method} ${path} failed: ${data.msg}`);
    }
    return data;
  }

  async listDatasets(name?: string): Promise<RAGFlowResponse<DatasetItem[]>> {
    return this.request<DatasetItem[]>("GET", "/api/v1/datasets", undefined, { name });
  }

  async createDataset(data: {
    name: string;
    avatar?: string;
    description?: string;
    sourceFrom?: string;
  }): Promise<RAGFlowResponse<{ id: string }>> {
    return this.request<{ id: string }>("POST", "/api/v1/datasets", data);
  }

  async updateDataset(
    id: string,
    data: {
      name: string;
      avatar?: string;
      description?: string;
      sourceFrom?: string;
    },
  ): Promise<RAGFlowResponse<{ id: string }>> {
    return this.request<{ id: string }>("PUT", `/api/v1/datasets/${encodeURIComponent(id)}`, data);
  }

  async deleteDatasets(ids: string[]): Promise<RAGFlowResponse<null>> {
    return this.request<null>("DELETE", "/api/v1/datasets", { ids });
  }

  // ─── 文件管理 ───────────────────────────────────────────

  /** 归一化 RAGFlow 文件接口响应：实际服务可能返回 code:"0" 字符串，message 字段名为 msg。 */
  private normalizeFileResponse<T>(
    raw: any,
    httpStatus: number,
    fallbackText?: string,
  ): RAGFlowFileResponse<T> {
    const codeRaw = raw?.code;
    const code =
      typeof codeRaw === "number"
        ? codeRaw
        : typeof codeRaw === "string" && /^-?\d+$/.test(codeRaw)
          ? Number(codeRaw)
          : codeRaw === undefined
            ? httpStatus >= 200 && httpStatus < 300
              ? 0
              : httpStatus
            : -1;
    const message =
      raw?.message ?? raw?.msg ?? raw?.error ?? (fallbackText ? fallbackText.slice(0, 500) : "");
    return { code, message: String(message ?? ""), data: raw?.data ?? (null as unknown as T) };
  }

  /** 文件管理接口的响应格式与 dataset 不同：{ code: 0, message, data } */
  private async fileRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<RAGFlowFileResponse<T>> {
    const url = new URL(`${RAGFLOW_FILE_BASE}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`[ragflow-file] ${method} ${path} network error: ${msg}`);
      return { code: -1, message: `network error: ${msg}`, data: null as unknown as T };
    }
    const text = await res.text();
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn(`[ragflow-file] ${method} ${path} non-JSON (status=${res.status}): ${text.slice(0, 500)}`);
      return { code: res.status, message: text.slice(0, 500) || "non-json response", data: null as unknown as T };
    }
    const data = this.normalizeFileResponse<T>(raw, res.status, text);
    if (data.code !== 0) {
      this.logger.warn(`[ragflow-file] ${method} ${path} failed (httpStatus=${res.status} code=${data.code}): ${data.message}`);
    }
    return data;
  }

  async listDocuments(
    datasetId: string,
    query: { page?: number; page_size?: number; orderby?: string; keywords?: string },
  ): Promise<RAGFlowFileResponse<{ docs: unknown[]; total: number }>> {
    return this.fileRequest<{ docs: unknown[]; total: number }>(
      "GET",
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`,
      undefined,
      query,
    );
  }

  async parseDocuments(
    datasetId: string,
    documentIds: string[],
  ): Promise<RAGFlowFileResponse<null>> {
    if (!documentIds?.length) {
      return { code: 400, message: "document_ids is empty", data: null };
    }
    this.logger.log(
      `[ragflow-file] POST parse datasetId=${datasetId} ids=${documentIds.join(",")}`,
    );
    const res = await this.fileRequest<null>(
      "POST",
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/chunks`,
      { document_ids: documentIds },
    );
    if (res.code === 0) {
      this.logger.log(`[ragflow-file] parse triggered ok (code=0)`);
    } else {
      this.logger.warn(`[ragflow-file] parse failed (code=${res.code}): ${res.message}`);
    }
    return res;
  }

  async deleteDocuments(
    datasetId: string,
    ids: string[],
  ): Promise<RAGFlowFileResponse<null>> {
    return this.fileRequest<null>(
      "DELETE",
      `/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`,
      { ids },
    );
  }

  /** 上传文件：直接转发原始请求体（multipart/form-data），返回 RAGFlow 响应 */
  async uploadDocument(
    datasetId: string,
    type: string | undefined,
    contentType: string,
    body: Buffer,
  ): Promise<RAGFlowFileResponse<{ id: string } | null>> {
    const url = new URL(`${RAGFLOW_FILE_BASE}/api/v1/datasets/${encodeURIComponent(datasetId)}/documents`);
    if (type) url.searchParams.set("type", type);

    this.logger.log(
      `[ragflow-file] POST upload datasetId=${datasetId} bytes=${body.length} contentType=${contentType}`,
    );
    this.logger.log(
      `[ragflow-file] body head: ${body.slice(0, 200).toString("utf8").replace(/\r\n/g, "\\r\\n")}`,
    );

    if (!body.length) {
      return {
        code: 400,
        message: "empty request body (multipart not received)",
        data: null,
      };
    }

    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType || "")) {
      this.logger.warn(
        `[ragflow-file] POST upload missing or invalid multipart Content-Type: ${contentType}`,
      );
      return {
        code: 400,
        message: `invalid content-type for multipart: ${contentType}`,
        data: null,
      };
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Authorization: `Bearer ${RAGFLOW_KEY}`,
        },
        // Buffer 在 Node 18+ undici fetch 中可用，TS lib.dom 类型未涵盖
        body: body as unknown as BodyInit,
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      this.logger.error(`[ragflow-file] POST upload network error: ${(e as Error).message}`);
      return { code: -1, message: `network error: ${(e as Error).message}`, data: null };
    }

    const text = await res.text();
    this.logger.log(
      `[ragflow-file] POST upload response httpStatus=${res.status} body=${text.slice(0, 1000)}`,
    );
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn(`[ragflow-file] POST upload non-JSON response (status=${res.status}): ${text.slice(0, 500)}`);
      return { code: res.status, message: text.slice(0, 500) || "non-json response", data: null };
    }

    const norm = this.normalizeFileResponse<any>(raw, res.status, text);

    // RAGFlow 上传接口的 data 形态可能是数组 [{id,...}] 或单对象 {id,...}
    let id: string | null = null;
    if (Array.isArray(norm.data) && norm.data.length > 0) {
      id = norm.data[0]?.id ?? null;
    } else if (norm.data && typeof norm.data === "object") {
      id = norm.data.id ?? null;
    }

    if (norm.code !== 0 || !id) {
      const reason = norm.message || `upload failed (httpStatus=${res.status} code=${norm.code})`;
      this.logger.warn(
        `[ragflow-file] POST upload failed (httpStatus=${res.status} code=${norm.code}): ${reason}`,
      );
      return {
        code: norm.code === 0 ? -1 : norm.code,
        message: reason,
        data: null,
      };
    }

    return { code: 0, message: norm.message || "success", data: { id } };
  }

  /** 下载文件：返回 RAGFlow 响应（用于流式转发） */
  async downloadDocument(datasetId: string, documentId: string): Promise<Response> {
    const url = `${RAGFLOW_FILE_BASE}/api/v1/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`;
    return fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${RAGFLOW_KEY}` },
      signal: AbortSignal.timeout(120000),
    });
  }
}

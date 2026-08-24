import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  HttpCode,
  Req,
  Res,
  Headers,
} from "@nestjs/common";
// @ts-ignore - express 类型声明缺失，运行时由 @nestjs/platform-express 提供
import type { Request, Response } from "express";
import { KnowledgeService } from "./knowledge.service";

// 拡張子 → Content-Type。上流(RAGFlow)は全ファイルを application/octet-stream で返すため、
// ブラウザがインライン表示(PDF/画像)できるよう正しい MIME に補正する。
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
};
// インライン表示する拡張子（それ以外はダウンロード扱いのまま）
const INLINE_EXTS = new Set(Object.keys(MIME_BY_EXT));

/** Content-Disposition ヘッダから filename を抽出する */
function filenameFromDisposition(cd: string | null): string | undefined {
  if (!cd) return undefined;
  const star = /filename\*\s*=\s*(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename\s*=\s*["']?([^"';]+)["']?/i.exec(cd);
  return plain?.[1];
}

/** ファイル名から小文字の拡張子を取得 */
function extOf(name?: string): string {
  if (!name) return "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

@Controller("api")
export class KnowledgeController {
  constructor(
    @Inject(KnowledgeService)
    private readonly knowledgeService: KnowledgeService,
  ) {}

  @Get("datasets")
  async list(@Query("name") name?: string) {
    const res = await this.knowledgeService.listDatasets(name);
    return res;
  }

  @Post("datasets")
  async create(
    @Body() body: { name: string; avatar?: string; description?: string; sourceFrom?: string },
  ) {
    const res = await this.knowledgeService.createDataset(body);
    return res;
  }

  @Put("datasets/:id")
  async update(
    @Param("id") id: string,
    @Body() body: { name: string; avatar?: string; description?: string; sourceFrom?: string },
  ) {
    const res = await this.knowledgeService.updateDataset(id, body);
    return res;
  }

  @Delete("datasets")
  @HttpCode(200)
  async delete(@Body() body: { ids: string[] }) {
    const res = await this.knowledgeService.deleteDatasets(body.ids);
    return res;
  }

  // ─── 文件管理 ───────────────────────────────────────────

  @Get("datasets/:id/documents")
  async listDocuments(
    @Param("id") datasetId: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("orderby") orderby?: string,
    @Query("keywords") keywords?: string,
  ) {
    return this.knowledgeService.listDocuments(datasetId, {
      page: page ? Number(page) : undefined,
      page_size: pageSize ? Number(pageSize) : undefined,
      orderby,
      keywords,
    });
  }

  @Post("datasets/:id/documents")
  async uploadDocument(
    @Param("id") datasetId: string,
    @Query("type") type: string | undefined,
    @Headers("content-type") contentType: string,
    @Req() req: Request,
  ) {
    // 收集原始 multipart 请求体（项目未引入 multer，直接流转发）
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve());
      req.on("error", reject);
    });
    const body = Buffer.concat(chunks);
    return this.knowledgeService.uploadDocument(datasetId, type, contentType, body);
  }

  @Post("datasets/:id/chunks")
  async parseDocuments(
    @Param("id") datasetId: string,
    @Body() body: { document_ids: string[] },
  ) {
    return this.knowledgeService.parseDocuments(datasetId, body.document_ids);
  }

  @Delete("datasets/:id/documents")
  @HttpCode(200)
  async deleteDocuments(
    @Param("id") datasetId: string,
    @Body() body: { ids: string[] },
  ) {
    return this.knowledgeService.deleteDocuments(datasetId, body.ids);
  }

  @Get("datasets/:id/documents/:docId")
  async downloadDocument(
    @Param("id") datasetId: string,
    @Param("docId") documentId: string,
    @Query("name") nameHint: string | undefined,
    @Query("download") download: string | undefined,
    @Res() res: Response,
  ) {
    const upstream = await this.knowledgeService.downloadDocument(datasetId, documentId);
    const upstreamCd = upstream.headers.get("content-disposition");
    const upstreamCt = upstream.headers.get("content-type");
    const cl = upstream.headers.get("content-length");

    // 拡張子はクライアントヒント優先、無ければ上流の Content-Disposition から取得
    const fileName = nameHint || filenameFromDisposition(upstreamCd);
    const ext = extOf(fileName);

    // 上流は基本 application/octet-stream を返すので、既知拡張子なら正しい MIME に補正。
    // 上流が octet-stream 以外の具体的な type を返している場合はそれを尊重。
    let contentType = upstreamCt || "application/octet-stream";
    if ((!upstreamCt || /octet-stream/i.test(upstreamCt)) && MIME_BY_EXT[ext]) {
      contentType = MIME_BY_EXT[ext];
    }
    res.setHeader("Content-Type", contentType);

    // ?download=1 のときのみ強制ダウンロード。それ以外はインライン表示可能な型は inline に。
    const forceDownload = download === "1" || download === "true";
    const disposition = !forceDownload && INLINE_EXTS.has(ext) ? "inline" : "attachment";
    if (fileName) {
      const encoded = encodeURIComponent(fileName);
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${fileName.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encoded}`,
      );
    } else if (upstreamCd && forceDownload) {
      res.setHeader("Content-Disposition", upstreamCd);
    }

    if (cl) res.setHeader("Content-Length", cl);
    res.status(upstream.status);
    if (!upstream.body) {
      res.end();
      return;
    }
    // 使用 pipeline 进行流式传输，确保二进制数据正确传输
    const { pipeline } = require("stream/promises");
    const { Readable } = require("stream");
    const stream = Readable.fromWeb(upstream.body);
    await pipeline(stream, res);
  }
}

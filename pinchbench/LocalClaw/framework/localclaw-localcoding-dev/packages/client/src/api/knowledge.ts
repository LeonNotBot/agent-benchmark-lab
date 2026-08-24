export interface DatasetItem {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  sourceFrom?: string;
  documentCount?: number;
  updateTime?: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  size?: number;
  suffix?: string;
  run?: string;
  status?: string;
  chunk_count?: number;
  create_date?: string;
  update_date?: string;
  process_duration?: number;
  progress?: number;
  progress_msg?: string;
  thumbnail?: string;
  type?: string;
  source_type?: string;
}

export async function apiListDatasets(query?: {
  name?: string;
}): Promise<{ code: string; msg: string; success: boolean; data: DatasetItem[] }> {
  const url = new URL("/api/datasets", window.location.origin);
  if (query?.name) url.searchParams.set("name", query.name);
  const r = await fetch(url.toString());
  return r.json();
}

export async function apiCreateDataset(data: {
  name: string;
  avatar?: string;
  description?: string;
  sourceFrom?: string;
}): Promise<{ code: string; msg: string; success: boolean; data: { id: string } }> {
  const r = await fetch("/api/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function apiUpdateDataset(
  id: string,
  data: { name: string; avatar?: string; description?: string; sourceFrom?: string },
): Promise<{ code: string; msg: string; success: boolean; data: { id: string } }> {
  const r = await fetch(`/api/datasets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function apiDeleteDatasets(
  ids: string[],
): Promise<{ code: string; msg: string; success: boolean; data: null }> {
  const r = await fetch("/api/datasets", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return r.json();
}

export async function apiListDocuments(
  datasetId: string,
  query?: { page?: number; page_size?: number; orderby?: string; keywords?: string },
): Promise<{ code: number; message: string; data: { docs: DocumentItem[]; total: number } }> {
  const url = new URL(`/api/datasets/${encodeURIComponent(datasetId)}/documents`, window.location.origin);
  if (query?.page !== undefined) url.searchParams.set("page", String(query.page));
  if (query?.page_size !== undefined) url.searchParams.set("page_size", String(query.page_size));
  if (query?.orderby) url.searchParams.set("orderby", query.orderby);
  if (query?.keywords) url.searchParams.set("keywords", query.keywords);
  const r = await fetch(url.toString());
  return r.json();
}

export async function apiUploadDocument(
  datasetId: string,
  file: File,
  type: "local" | "web" = "local",
): Promise<{ code: number; message: string; data: { id: string } | null }> {
  const fd = new FormData();
  fd.append("file", file);
  const url = new URL(`/api/datasets/${encodeURIComponent(datasetId)}/documents`, window.location.origin);
  url.searchParams.set("type", type);
  const r = await fetch(url.toString(), { method: "POST", body: fd });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: r.status || -1, message: text.slice(0, 500) || `HTTP ${r.status}`, data: null };
  }
}

export async function apiParseDocuments(
  datasetId: string,
  documentIds: string[],
): Promise<{ code: number; message: string; data: null }> {
  const r = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_ids: documentIds }),
  });
  return r.json();
}

export async function apiDeleteDocuments(
  datasetId: string,
  ids: string[],
): Promise<{ code: number; message: string; data: null }> {
  const r = await fetch(`/api/datasets/${encodeURIComponent(datasetId)}/documents`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return r.json();
}

export function apiDownloadDocumentUrl(datasetId: string, documentId: string, name?: string): string {
  const base = `/api/datasets/${encodeURIComponent(datasetId)}/documents/${encodeURIComponent(documentId)}`;
  return name ? `${base}?name=${encodeURIComponent(name)}` : base;
}

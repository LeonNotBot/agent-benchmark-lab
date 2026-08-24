async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return r.json();
}

async function putJson<T>(url: string, body: unknown): Promise<T | null> {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return r.json();
}

async function patchJson<T>(url: string, body: unknown): Promise<T | null> {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return r.json();
}

async function deleteJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) return null;
  return r.json();
}

export { getJson, postJson, putJson, patchJson, deleteJson };

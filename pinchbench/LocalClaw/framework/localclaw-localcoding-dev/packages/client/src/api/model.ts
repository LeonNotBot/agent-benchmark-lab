import type { EndpointInfo } from "@lenovo/agent-protocol";
import { getJson } from "./_fetch";

export async function apiListEndpoints(): Promise<EndpointInfo[]> {
  return await getJson<EndpointInfo[]>("/api/endpoints") ?? [];
}

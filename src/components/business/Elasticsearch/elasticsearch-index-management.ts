import { api } from "@/services/api";

export type ElasticsearchIndexAction = "refresh" | "open" | "close" | "delete";

export const DEFAULT_ELASTICSEARCH_INDEX_BODY =
  '{\n  "settings": {},\n  "mappings": {}\n}';

export function parseElasticsearchIndexBody(raw: string): {
  body?: unknown;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  try {
    const body = JSON.parse(trimmed);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { error: "Index body must be a JSON object." };
    }
    return { body };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function elasticsearchIndexActionSuccessMessage(
  action: ElasticsearchIndexAction,
  index: string,
) {
  return action === "delete"
    ? `Index deleted · ${index}`
    : `Index ${action} complete · ${index}`;
}

export async function executeElasticsearchIndexAction(
  connectionId: number,
  index: string,
  action: ElasticsearchIndexAction,
) {
  if (action === "refresh") {
    await api.elasticsearch.refreshIndex(connectionId, index);
  } else if (action === "open") {
    await api.elasticsearch.openIndex(connectionId, index);
  } else if (action === "close") {
    await api.elasticsearch.closeIndex(connectionId, index);
  } else {
    await api.elasticsearch.deleteIndex(connectionId, index);
  }
}

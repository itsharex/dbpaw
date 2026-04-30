import type { RedisValue } from "@/services/api";

export function parseRedisTtlSeconds(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
    throw new Error("TTL must be a positive integer (1-2147483647)");
  }
  return n;
}

export function parseRedisZSetScore(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Score is required");
  }
  const score = Number(trimmed);
  if (!Number.isFinite(score)) {
    throw new Error("Score must be a finite number");
  }
  return score;
}

export function isRedisClusterDatabaseList(
  databases: Array<{ name: string }>,
): boolean {
  return databases.length === 1 && databases[0]?.name === "db0";
}

export function countRedisValueItems(value: RedisValue): number {
  if (value.kind === "string" || value.kind === "json" || value.kind === "none") return 0;
  if (value.kind === "hash") return Object.keys(value.value).length;
  return value.value.length;
}

/**
 * Parse MSET import text into a key-value record.
 * Accepts either a JSON object or line-based "key: value" format.
 * Returns null if the input cannot be parsed.
 */
export function parseMsetInput(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try JSON first
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as Record<string, string>;
    }
  } catch {
    // not JSON — fall through to line-based
  }

  // Line-based: "key: value" per line, # for comments
  const entries: Record<string, string> = {};
  let valid = false;
  for (const line of trimmed.split("\n")) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed || lineTrimmed.startsWith("#")) continue;
    const idx = lineTrimmed.indexOf(":");
    if (idx === -1) continue;
    entries[lineTrimmed.slice(0, idx).trim()] = lineTrimmed.slice(idx + 1).trim();
    valid = true;
  }
  return valid ? entries : null;
}

export function isRedisValuePagePartial(
  value: RedisValue,
  totalLen: number | null,
  nextPageToken: number,
  loadedCount: number,
): boolean {
  if (value.kind === "hash" || value.kind === "set") {
    return nextPageToken !== 0;
  }
  if (value.kind === "stream") {
    // Stream uses its own pagination mechanism; rely on totalLen
    return totalLen !== null && totalLen > loadedCount;
  }
  return totalLen !== null && totalLen > loadedCount;
}

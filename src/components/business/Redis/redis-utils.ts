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
  if (value.kind === "string" || value.kind === "none") return 0;
  if (value.kind === "hash") return Object.keys(value.value).length;
  return value.value.length;
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
  return totalLen !== null && totalLen > loadedCount;
}

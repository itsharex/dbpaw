import { describe, expect, test } from "bun:test";
import {
  countRedisValueItems,
  isRedisClusterDatabaseList,
  isRedisValuePagePartial,
  parseRedisTtlSeconds,
  parseRedisZSetScore,
} from "./redis-utils";

describe("parseRedisTtlSeconds", () => {
  test("accepts empty input as persist", () => {
    expect(parseRedisTtlSeconds("")).toBeNull();
    expect(parseRedisTtlSeconds("   ")).toBeNull();
  });

  test("accepts positive integers", () => {
    expect(parseRedisTtlSeconds("1")).toBe(1);
    expect(parseRedisTtlSeconds("3600")).toBe(3600);
  });

  test("rejects zero negative and decimal values", () => {
    expect(() => parseRedisTtlSeconds("0")).toThrow(
      "TTL must be a positive integer",
    );
    expect(() => parseRedisTtlSeconds("-1")).toThrow(
      "TTL must be a positive integer",
    );
    expect(() => parseRedisTtlSeconds("1.5")).toThrow(
      "TTL must be a positive integer",
    );
  });
});

describe("parseRedisZSetScore", () => {
  test("accepts finite numeric values", () => {
    expect(parseRedisZSetScore("1")).toBe(1);
    expect(parseRedisZSetScore("-2.5")).toBe(-2.5);
  });

  test("rejects empty and non-finite values", () => {
    expect(() => parseRedisZSetScore("")).toThrow("Score is required");
    expect(() => parseRedisZSetScore("NaN")).toThrow(
      "Score must be a finite number",
    );
    expect(() => parseRedisZSetScore("Infinity")).toThrow(
      "Score must be a finite number",
    );
  });
});

describe("isRedisClusterDatabaseList", () => {
  test("detects the synthetic cluster db list", () => {
    expect(isRedisClusterDatabaseList([{ name: "db0" }])).toBe(true);
  });

  test("does not misclassify standalone db lists", () => {
    expect(isRedisClusterDatabaseList([{ name: "db0" }, { name: "db1" }])).toBe(
      false,
    );
  });
});

describe("redis value helpers", () => {
  test("counts items for each collection type", () => {
    expect(
      countRedisValueItems({ kind: "hash", value: { a: "1", b: "2" } }),
    ).toBe(2);
    expect(countRedisValueItems({ kind: "list", value: ["a", "b"] })).toBe(2);
    expect(countRedisValueItems({ kind: "string", value: "x" })).toBe(0);
  });

  test("uses cursor semantics for hash and set pagination", () => {
    expect(
      isRedisValuePagePartial({ kind: "hash", value: { a: "1" } }, 10, 42, 1),
    ).toBe(true);
    expect(
      isRedisValuePagePartial({ kind: "set", value: ["a"] }, 10, 0, 10),
    ).toBe(false);
  });

  test("uses total-length semantics for list and zset pagination", () => {
    expect(
      isRedisValuePagePartial({ kind: "list", value: ["a"] }, 2, 0, 1),
    ).toBe(true);
    expect(
      isRedisValuePagePartial(
        { kind: "zSet", value: [{ member: "a", score: 1 }] },
        1,
        1,
        1,
      ),
    ).toBe(false);
  });
});

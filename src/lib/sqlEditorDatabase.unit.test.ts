import { describe, expect, test } from "bun:test";

import {
  normalizeDatabaseOptions,
  resolvePreferredDatabase,
} from "./sqlEditorDatabase";

describe("normalizeDatabaseOptions", () => {
  test("deduplicates database names and keeps fallback when missing", () => {
    expect(
      normalizeDatabaseOptions([" app ", "analytics", "app"], "archive"),
    ).toEqual(["archive", "app", "analytics"]);
  });

  test("returns empty array for empty input and no fallback", () => {
    expect(normalizeDatabaseOptions([])).toEqual([]);
  });

  test("filters out blank names", () => {
    expect(normalizeDatabaseOptions(["", "  ", "app"])).toEqual(["app"]);
  });

  test("does not prepend fallback if it already exists in list", () => {
    expect(normalizeDatabaseOptions(["app", "analytics"], "app")).toEqual([
      "app",
      "analytics",
    ]);
  });

  test("does not prepend blank fallback", () => {
    expect(normalizeDatabaseOptions(["app"], "")).toEqual(["app"]);
    expect(normalizeDatabaseOptions(["app"], "  ")).toEqual(["app"]);
  });
});

describe("resolvePreferredDatabase", () => {
  test("prefers the saved database when it still exists", () => {
    expect(
      resolvePreferredDatabase({
        preferredDatabase: "analytics",
        connectionDatabase: "app",
        availableDatabases: ["app", "analytics"],
      }),
    ).toBe("analytics");
  });

  test("falls back to the connection database when saved database is gone", () => {
    expect(
      resolvePreferredDatabase({
        preferredDatabase: "archive",
        connectionDatabase: "app",
        availableDatabases: ["app", "analytics"],
      }),
    ).toBe("app");
  });

  test("falls back to the first available database when connection default is empty", () => {
    expect(
      resolvePreferredDatabase({
        preferredDatabase: "archive",
        connectionDatabase: "",
        availableDatabases: ["analytics", "app"],
      }),
    ).toBe("analytics");
  });

  test("returns preferred when no available databases list provided", () => {
    expect(
      resolvePreferredDatabase({
        preferredDatabase: "mydb",
      }),
    ).toBe("mydb");
  });

  test("returns connectionDatabase when no preferred and no available list", () => {
    expect(
      resolvePreferredDatabase({
        connectionDatabase: "defaultdb",
      }),
    ).toBe("defaultdb");
  });

  test("returns undefined when everything is empty", () => {
    expect(resolvePreferredDatabase({})).toBeUndefined();
  });
});

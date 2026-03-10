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
});

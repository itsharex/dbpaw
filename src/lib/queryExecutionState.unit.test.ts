import { describe, expect, test } from "bun:test";

import {
  applyQueryCompletionToTab,
  type QueryResultsState,
} from "./queryExecutionState";

const successResult: QueryResultsState = {
  data: [{ id: 1 }],
  columns: ["id"],
  executionTime: "12ms",
};

describe("applyQueryCompletionToTab", () => {
  test("clears activeQueryId when the completed query matches the active one", () => {
    const tab = {
      id: "tab-1",
      activeQueryId: "query-1",
      queryResults: null,
    };

    expect(
      applyQueryCompletionToTab(tab, "tab-1", "query-1", successResult),
    ).toEqual({
      id: "tab-1",
      activeQueryId: undefined,
      queryResults: successResult,
    });
  });

  test("preserves a newer activeQueryId when an older query completes later", () => {
    const tab = {
      id: "tab-1",
      activeQueryId: "query-2",
      queryResults: null,
    };

    expect(
      applyQueryCompletionToTab(tab, "tab-1", "query-1", successResult),
    ).toEqual({
      id: "tab-1",
      activeQueryId: "query-2",
      queryResults: successResult,
    });
  });

  test("leaves other tabs unchanged", () => {
    const tab = {
      id: "tab-2",
      activeQueryId: "query-2",
      queryResults: null,
    };

    expect(
      applyQueryCompletionToTab(tab, "tab-1", "query-1", successResult),
    ).toBe(tab);
  });
});

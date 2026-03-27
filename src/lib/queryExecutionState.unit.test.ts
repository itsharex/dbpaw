import { describe, it, expect } from "bun:test";
import {
  applyQueryCompletionToTab,
  QueryResultsState,
} from "./queryExecutionState";

// Mock Tab type
interface TestTab {
  id: string;
  activeQueryId?: string;
  lastQueryId?: string;
  queryResults?: QueryResultsState | null;
}

describe("applyQueryCompletionToTab", () => {
  const mockResults: QueryResultsState = {
    data: [{ id: 1, name: "test" }],
    columns: ["id", "name"],
    executionTime: "100ms",
  };

  it("should update results when the query is the latest", () => {
    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-A",
      lastQueryId: "query-A",
    };

    const result = applyQueryCompletionToTab(
      tab,
      "tab-1",
      "query-A",
      mockResults,
    );

    expect(result.queryResults).toEqual(mockResults);
    expect(result.activeQueryId).toBeUndefined();
    expect(result.lastQueryId).toBeUndefined();
  });

  it("should ignore stale query results (race condition scenario)", () => {
    // Scenario: query-A was sent first, then query-B
    // query-B updated lastQueryId to B
    // now query-A returns and should be ignored
    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-B",
      lastQueryId: "query-B", // B is already the latest
      queryResults: undefined,
    };

    // query-A response returns
    const result = applyQueryCompletionToTab(
      tab,
      "tab-1",
      "query-A",
      mockResults,
    );

    // should remain unchanged
    expect(result.queryResults).toBeUndefined();
    expect(result.activeQueryId).toBe("query-B");
    expect(result.lastQueryId).toBe("query-B");
    // ensure the same object reference is returned (no changes)
    expect(result).toBe(tab);
  });

  it("should ignore query results from another tab", () => {
    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-A",
      lastQueryId: "query-A",
    };

    const result = applyQueryCompletionToTab(
      tab,
      "tab-2",
      "query-A",
      mockResults,
    );

    // should remain unchanged
    expect(result.queryResults).toBeUndefined();
    expect(result.activeQueryId).toBe("query-A");
    expect(result).toBe(tab);
  });

  it("should correctly handle error results", () => {
    const errorResults: QueryResultsState = {
      data: [],
      columns: [],
      executionTime: "0ms",
      error: "Connection timeout",
    };

    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-A",
      lastQueryId: "query-A",
    };

    const result = applyQueryCompletionToTab(
      tab,
      "tab-1",
      "query-A",
      errorResults,
    );

    expect(result.queryResults).toEqual(errorResults);
    expect(result.queryResults?.error).toBe("Connection timeout");
  });

  it("complex case: only the last of rapid queries should apply", () => {
    let tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-1",
      lastQueryId: "query-1",
    };

    // Simulate a user executing 3 queries rapidly
    // First query
    tab = { ...tab, activeQueryId: "query-1", lastQueryId: "query-1" };
    // Second query (overrides the first)
    tab = { ...tab, activeQueryId: "query-2", lastQueryId: "query-2" };
    // Third query (overrides the second)
    tab = { ...tab, activeQueryId: "query-3", lastQueryId: "query-3" };

    // query-2 completes first (already stale)
    const resultFromQuery2 = applyQueryCompletionToTab(
      tab,
      "tab-1",
      "query-2",
      {
        ...mockResults,
        data: [{ id: 2 }],
      },
    );

    // should be ignored
    expect(resultFromQuery2.queryResults).toBeUndefined();
    expect(resultFromQuery2.lastQueryId).toBe("query-3");

    // then query-3 completes (latest)
    const resultFromQuery3 = applyQueryCompletionToTab(
      tab,
      "tab-1",
      "query-3",
      {
        ...mockResults,
        data: [{ id: 3 }],
      },
    );

    // should be accepted
    expect(resultFromQuery3.queryResults?.data).toEqual([{ id: 3 }]);
    expect(resultFromQuery3.lastQueryId).toBeUndefined();

    // finally query-1 completes (even more stale)
    const resultFromQuery1 = applyQueryCompletionToTab(
      resultFromQuery3,
      "tab-1",
      "query-1",
      {
        ...mockResults,
        data: [{ id: 1 }],
      },
    );

    // should be ignored, keep query-3 results
    expect(resultFromQuery1.queryResults?.data).toEqual([{ id: 3 }]);
  });
});

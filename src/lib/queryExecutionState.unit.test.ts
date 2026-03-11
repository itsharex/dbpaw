import { describe, it, expect } from "bun:test";
import { applyQueryCompletionToTab, QueryResultsState } from "./queryExecutionState";

// 模拟 Tab 类型
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

  it("应该更新结果当查询是最新的", () => {
    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-A",
      lastQueryId: "query-A",
    };

    const result = applyQueryCompletionToTab(tab, "tab-1", "query-A", mockResults);

    expect(result.queryResults).toEqual(mockResults);
    expect(result.activeQueryId).toBeUndefined();
    expect(result.lastQueryId).toBeUndefined();
  });

  it("应该忽略过期查询的结果（竞态条件场景）", () => {
    // 场景：先发了 query-A，然后发了 query-B
    // query-B 把 lastQueryId 改成了 B
    // 现在 query-A 的响应回来了，应该被忽略
    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-B",
      lastQueryId: "query-B", // 最新的已经是 B 了
      queryResults: undefined,
    };

    // query-A 的响应回来了
    const result = applyQueryCompletionToTab(tab, "tab-1", "query-A", mockResults);

    // 应该保持原样，不更新
    expect(result.queryResults).toBeUndefined();
    expect(result.activeQueryId).toBe("query-B");
    expect(result.lastQueryId).toBe("query-B");
    // 确保返回的是同一个对象引用（没有变化）
    expect(result).toBe(tab);
  });

  it("应该忽略非本 tab 的查询结果", () => {
    const tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-A",
      lastQueryId: "query-A",
    };

    const result = applyQueryCompletionToTab(tab, "tab-2", "query-A", mockResults);

    // 应该保持原样
    expect(result.queryResults).toBeUndefined();
    expect(result.activeQueryId).toBe("query-A");
    expect(result).toBe(tab);
  });

  it("应该正确处理错误结果", () => {
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

    const result = applyQueryCompletionToTab(tab, "tab-1", "query-A", errorResults);

    expect(result.queryResults).toEqual(errorResults);
    expect(result.queryResults?.error).toBe("Connection timeout");
  });

  it("复杂场景：多次快速查询只有最后一次生效", () => {
    let tab: TestTab = {
      id: "tab-1",
      activeQueryId: "query-1",
      lastQueryId: "query-1",
    };

    // 模拟用户快速执行了 3 次查询
    // 第 1 次
    tab = { ...tab, activeQueryId: "query-1", lastQueryId: "query-1" };
    // 第 2 次（覆盖了第 1 次）
    tab = { ...tab, activeQueryId: "query-2", lastQueryId: "query-2" };
    // 第 3 次（覆盖了第 2 次）
    tab = { ...tab, activeQueryId: "query-3", lastQueryId: "query-3" };

    // 现在 query-2 先完成（过期了）
    const resultFromQuery2 = applyQueryCompletionToTab(tab, "tab-1", "query-2", {
      ...mockResults,
      data: [{ id: 2 }],
    });

    // 应该被忽略
    expect(resultFromQuery2.queryResults).toBeUndefined();
    expect(resultFromQuery2.lastQueryId).toBe("query-3");

    // 然后 query-3 完成（最新的）
    const resultFromQuery3 = applyQueryCompletionToTab(tab, "tab-1", "query-3", {
      ...mockResults,
      data: [{ id: 3 }],
    });

    // 应该被接受
    expect(resultFromQuery3.queryResults?.data).toEqual([{ id: 3 }]);
    expect(resultFromQuery3.lastQueryId).toBeUndefined();

    // 最后 query-1 完成（更过期）
    const resultFromQuery1 = applyQueryCompletionToTab(resultFromQuery3, "tab-1", "query-1", {
      ...mockResults,
      data: [{ id: 1 }],
    });

    // 应该被忽略，保持 query-3 的结果
    expect(resultFromQuery1.queryResults?.data).toEqual([{ id: 3 }]);
  });
});

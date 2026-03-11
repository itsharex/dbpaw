export type QueryResultsState = {
  data: unknown[];
  columns: string[];
  executionTime: string;
  error?: string;
};

type QueryTabState = {
  id: string;
  activeQueryId?: string;
  lastQueryId?: string;
  queryResults?: QueryResultsState | null;
};

export function applyQueryCompletionToTab<T extends QueryTabState>(
  tab: T,
  tabId: string,
  queryId: string,
  queryResults: QueryResultsState,
): T {
  if (tab.id !== tabId) {
    return tab;
  }

  // 忽略过期的查询结果（如果用户已发起新查询）
  if (tab.lastQueryId !== queryId) {
    return tab;
  }

  return {
    ...tab,
    queryResults,
    activeQueryId: undefined,
    lastQueryId: undefined,
  };
}

export type QueryResultsState = {
  data: unknown[];
  columns: string[];
  executionTime: string;
  error?: string;
};

type QueryTabState = {
  id: string;
  activeQueryId?: string;
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

  return {
    ...tab,
    queryResults,
    activeQueryId:
      tab.activeQueryId === queryId ? undefined : tab.activeQueryId,
  };
}

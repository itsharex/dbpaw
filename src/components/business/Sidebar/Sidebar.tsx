import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionList, type RedisRefreshRequest } from "./ConnectionList";
import { SavedQueriesList } from "./SavedQueriesList";
import { ConnectionForm, type RoutineType, SavedQuery } from "@/services/api";
import { useTranslation } from "react-i18next";

interface ActiveTableTarget {
  connectionId: number;
  database: string;
  table: string;
  schema?: string;
}

interface SidebarRevealRequest extends ActiveTableTarget {
  id: number;
}

interface SidebarProps {
  onTableSelect?: (
    connection: string,
    database: string,
    table: string,
    connectionId: number,
    driver: string,
    schema?: string,
  ) => void;
  onRedisKeySelect?: (
    connection: string,
    database: string,
    redisKey: string,
    connectionId: number,
    driver: string,
  ) => void;
  onOpenRedisConsole?: (
    connection: string,
    database: string,
    connectionId: number,
    driver: string,
  ) => void;
  onOpenRedisBrowser?: (
    connection: string,
    database: string,
    connectionId: number,
    driver: string,
  ) => void;
  onOpenRedisServerInfo?: (
    connection: string,
    database: string,
    connectionId: number,
    driver: string,
  ) => void;
  onOpenElasticsearchIndex?: (
    connection: string,
    index: string,
    connectionId: number,
    driver: string,
  ) => void;
  onConnect?: (form: ConnectionForm) => void;
  onCreateQuery?: (
    connectionId: number,
    databaseName: string,
    driver: string,
  ) => void;
  onRoutineSelect?: (
    connection: string,
    database: string,
    schema: string,
    name: string,
    routineType: RoutineType,
    connectionId: number,
    driver: string,
  ) => void;
  onExportTable?: (
    ctx: {
      connectionId: number;
      database: string;
      schema: string;
      table: string;
      driver: string;
    },
    format: "csv" | "json" | "sql_dml" | "sql_ddl" | "sql_full",
    filePath: string,
  ) => void;
  onExportDatabase?: (ctx: {
    connectionId: number;
    database: string;
    driver: string;
    format: "sql_dml" | "sql_ddl" | "sql_full";
    filePath: string;
  }) => void;
  onCreateTable?: (
    connectionId: number,
    database: string,
    schema: string,
    driver: string,
  ) => void;
  onAlterTable?: (
    connectionId: number,
    database: string,
    schema: string,
    table: string,
    driver: string,
  ) => void;
  onSelectSavedQuery: (query: SavedQuery) => void;
  lastUpdated?: number;
  activeTableTarget?: ActiveTableTarget;
  sidebarRevealRequest?: SidebarRevealRequest;
  layoutMode?: "tabs" | "tree";
  redisRefreshRequest?: RedisRefreshRequest;
}

export function Sidebar({
  onTableSelect,
  onRedisKeySelect,
  onOpenRedisConsole,
  onOpenRedisBrowser,
  onOpenRedisServerInfo,
  onOpenElasticsearchIndex,
  onConnect,
  onCreateQuery,
  onRoutineSelect,
  onExportTable,
  onExportDatabase,
  onCreateTable,
  onAlterTable,
  onSelectSavedQuery,
  lastUpdated,
  activeTableTarget,
  sidebarRevealRequest,
  layoutMode = "tabs",
  redisRefreshRequest,
}: SidebarProps) {
  const { t } = useTranslation();
  const [sidebarTab, setSidebarTab] = useState<"connections" | "queries">(
    "connections",
  );

  useEffect(() => {
    if (!sidebarRevealRequest) return;
    setSidebarTab("connections");
  }, [sidebarRevealRequest]);

  // Shared props for both layout modes — add new ConnectionList props here once
  const connectionListProps = {
    onTableSelect,
    onRedisKeySelect,
    onOpenRedisConsole,
    onOpenRedisBrowser,
    onOpenRedisServerInfo,
    onOpenElasticsearchIndex,
    onConnect,
    onCreateQuery,
    onRoutineSelect,
    onExportTable,
    onExportDatabase,
    onCreateTable,
    onAlterTable,
    activeTableTarget,
    sidebarRevealRequest,
    redisRefreshRequest,
  };

  if (layoutMode === "tree") {
    return (
      <div className="h-full flex flex-col bg-background border-r border-border">
        <ConnectionList
          {...connectionListProps}
          onSelectSavedQuery={onSelectSavedQuery}
          lastUpdated={lastUpdated}
          showSavedQueriesInTree
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      <Tabs
        value={sidebarTab}
        onValueChange={(value) =>
          setSidebarTab(value as "connections" | "queries")
        }
        className="h-full flex flex-col"
      >
        <TabsList className="w-full grid grid-cols-2 overflow-hidden">
          <TabsTrigger
            value="connections"
            className="min-w-0 max-w-none truncate"
          >
            {t("sidebar.tabs.connections")}
          </TabsTrigger>
          <TabsTrigger value="queries" className="min-w-0 max-w-none truncate">
            {t("sidebar.tabs.queries")}
          </TabsTrigger>
        </TabsList>
        <div className="flex-1 overflow-hidden mt-2">
          <TabsContent
            value="connections"
            forceMount
            className="h-full m-0 border-0"
          >
            <ConnectionList {...connectionListProps} />
          </TabsContent>
          <TabsContent
            value="queries"
            forceMount
            className="h-full m-0 border-0"
          >
            <SavedQueriesList
              onSelectQuery={onSelectSavedQuery}
              onCreateQuery={onCreateQuery}
              lastUpdated={lastUpdated}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

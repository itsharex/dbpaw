import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Play, Save, Trash2, Clock, Database } from "lucide-react";
import { TableView } from "@/components/business/DataGrid/TableView";

interface SqlEditorProps {
  queryResults?: {
    data: any[];
    columns: string[];
    executionTime?: string;
  } | null;
  onExecute?: (sql: string) => void;
  onCancel?: () => void;
  databaseName?: string;
}

export function SqlEditor({
  queryResults,
  onExecute,
  onCancel,
  databaseName,
}: SqlEditorProps) {
  const [sql, setSql] = useState("-- Enter your SQL query here\n");

  const handleExecute = () => {
    if (onExecute) {
      onExecute(sql);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {databaseName && (
            <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded text-xs text-gray-600 border border-gray-200">
              <Database className="w-3 h-3" />
              <span>{databaseName}</span>
            </div>
          )}

          <div className="w-px h-4 bg-gray-300 mx-2" />

          <Button
            onClick={handleExecute}
            size="sm"
            className="gap-2"
            title="Run SQL (Cmd+Enter)"
          >
            <Play className="w-4 h-4" />
            Run
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <Save className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setSql("")}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock className="w-4 h-4" />
          <span>
            {queryResults?.executionTime
              ? `Last executed: ${queryResults.executionTime}`
              : "Ready"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="vertical">
          {/* SQL Editor Panel */}
          <ResizablePanel defaultSize={queryResults ? 50 : 100} minSize={30}>
            <div className="h-full flex flex-col">
              <div className="flex-1 relative">
                <Editor
                  height="100%"
                  defaultLanguage="sql"
                  value={sql}
                  onChange={(value) => setSql(value || "")}
                  theme="vs-light"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    roundedSelection: false,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: "on",
                  }}
                />
              </div>
            </div>
          </ResizablePanel>

          {/* Results Panel */}
          {queryResults && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={20}>
                <div className="h-full flex flex-col">
                  <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
                    <span className="text-sm font-semibold text-gray-700">
                      Query Results ({queryResults.data.length} rows)
                    </span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <TableView
                      data={queryResults.data}
                      columns={queryResults.columns}
                      hideHeader
                    />
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

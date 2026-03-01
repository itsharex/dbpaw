import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, History, Loader2, XCircle } from "lucide-react";
import { api, SqlExecutionLog } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

const SOURCE_LABELS: Record<string, string> = {
  sql_editor: "SQL Editor",
  table_view_save: "Table Save",
  execute_by_conn: "Temp Connection",
  unknown: "Unknown",
};

function formatSource(source?: string | null) {
  if (!source) return SOURCE_LABELS.unknown;
  return SOURCE_LABELS[source] || source;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

export function SqlExecutionLogsDropdown() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<SqlExecutionLog[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.sqlLogs.list(100);
      setLogs(items);
    } catch (e) {
      toast.error("Failed to load SQL logs", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadLogs();
  }, [open, loadLogs]);

  const handleCopy = useCallback(async (sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      toast.success("SQL copied");
    } catch (e) {
      toast.error("Copy failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="SQL Execution Logs"
          aria-label="Open SQL execution logs"
        >
          <History className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[680px] p-2">
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-sm font-medium">SQL Logs (latest 100)</div>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="max-h-[460px] overflow-auto space-y-1">
          {!loading && logs.length === 0 && (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              No execution logs yet.
            </div>
          )}

          {logs.map((log) => (
            <details
              key={log.id}
              className="rounded border border-border/70 bg-muted/20 open:bg-muted/35"
            >
              <summary className="list-none cursor-pointer px-2 py-2">
                <div className="flex items-center gap-2">
                  {log.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive shrink-0" />
                  )}
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {formatDateTime(log.executedAt)}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {formatSource(log.source)}
                  </span>
                  <span className="font-mono text-xs truncate flex-1">
                    {log.sql.replace(/\s+/g, " ")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleCopy(log.sql);
                    }}
                    title="Copy SQL"
                    aria-label="Copy SQL"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </summary>

              <div className="px-2 pb-2 pt-1 space-y-2 border-t border-border/60">
                <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                  {log.sql}
                </pre>
                {!log.success && log.error && (
                  <pre className="text-xs whitespace-pre-wrap break-all font-mono text-destructive">
                    {log.error}
                  </pre>
                )}
              </div>
            </details>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

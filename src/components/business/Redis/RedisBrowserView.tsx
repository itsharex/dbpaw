import { useCallback, useEffect, useState } from "react";
import {
  CheckSquare,
  Copy,
  FileDown,
  FileUp,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  Unlink,
  Clock,
  LockOpen,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/services/api";
import type { RedisKeyInfo } from "@/services/api";
import { toast } from "sonner";
import { cn } from "@/components/ui/utils";
import { RedisKeyView } from "./RedisKeyView";
import { isRedisClusterDatabaseList, parseMsetInput } from "./redis-utils";
import { TYPE_COLORS, TYPE_DISPLAY_LABEL } from "./redis-type-colors";

const SCAN_LIMIT = 200;

function formatTtlShort(ttl: number): string {
  if (ttl <= -2) return "exp";
  if (ttl === -1) return "";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  return `${Math.floor(ttl / 3600)}h`;
}

interface Props {
  connectionId: number;
  database: string;
  onOpenConsole?: () => void;
}

type DetailState =
  | { mode: "none" }
  | { mode: "new" }
  | { mode: "view"; key: string };

export function RedisBrowserView({ connectionId, database, onOpenConsole }: Props) {
  const [pattern, setPattern] = useState("");
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [cursor, setCursor] = useState("0");
  const [isPartial, setIsPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ mode: "none" });
  const [isClusterMode, setIsClusterMode] = useState(false);
  const [requiresPattern, setRequiresPattern] = useState(false);

  // Multi-select state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  // Batch operation loading
  const [batchLoading, setBatchLoading] = useState(false);

  // MGET/MSET dialog state
  const [mgetDialogOpen, setMgetDialogOpen] = useState(false);
  const [msetData, setMsetData] = useState("");
  const [msetDialogOpen, setMsetDialogOpen] = useState(false);
  const [msetImportText, setMsetImportText] = useState("");
  const [msetLoading, setMsetLoading] = useState(false);

  // scan never touches detail — callers decide what happens to selection
  const scan = useCallback(
    async (pat: string, cur: string, append: boolean) => {
      if (isClusterMode && !pat.trim()) {
        setKeys([]);
        setCursor("0");
        setIsPartial(false);
        setRequiresPattern(true);
        return;
      }
      setIsLoading(true);
      try {
        const res = await api.redis.scanKeys({
          id: connectionId,
          database,
          cursor: cur,
          pattern: pat.trim() || undefined,
          limit: SCAN_LIMIT,
        });
        setKeys((prev) => (append ? [...prev, ...res.keys] : res.keys));
        setCursor(res.cursor);
        setIsPartial(res.isPartial);
        setRequiresPattern(false);
      } catch (e) {
        toast.error("Failed to scan keys", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [connectionId, database, isClusterMode],
  );

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const databases = await api.redis.listDatabases(connectionId);
        if (cancelled) return;
        const clusterMode = isRedisClusterDatabaseList(databases);
        setIsClusterMode(clusterMode);
        setRequiresPattern(clusterMode);
        if (!clusterMode) {
          await scan("", "0", false);
        } else {
          setKeys([]);
          setCursor("0");
          setIsPartial(false);
        }
      } catch (e) {
        toast.error("Failed to load Redis databases", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [connectionId, scan]);

  const handleSearch = () => {
    setDetail({ mode: "none" });
    void scan(pattern, "0", false);
  };

  const handleLoadMore = () => void scan(pattern, cursor, true);

  const handleSelectKey = (key: string, index: number, e: React.MouseEvent) => {
    if (selectedKeys.size > 0) {
      // Shift-click range selection
      if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        const rangeKeys = keys.slice(start, end + 1).map((k) => k.key);
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const k of rangeKeys) next.add(k);
          return next;
        });
        setLastClickedIndex(index);
        return;
      }
      // Normal click in multi-select mode — toggle
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setLastClickedIndex(index);
      return;
    }
    setDetail({ mode: "view", key });
  };

  const handleNewKey = () => setDetail({ mode: "new" });

  const handleKeyDeleted = () => {
    if (detail.mode === "view") {
      setKeys((prev) => prev.filter((k) => k.key !== detail.key));
    }
    setDetail({ mode: "none" });
    void scan(pattern, "0", false);
  };

  const handleKeySaved = (newKey: string) => {
    if (detail.mode === "new") {
      setDetail({ mode: "view", key: newKey });
      void scan(pattern, "0", false);
    } else if (detail.mode === "view" && newKey !== detail.key) {
      setDetail({ mode: "view", key: newKey });
      void scan(pattern, "0", false);
    } else {
      void scan(pattern, "0", false);
    }
  };

  // ── Batch operations ──────────────────────────────────────────────────────

  const runBatchOp = async (
    op: "del" | "unlink" | "expire" | "persist",
    ttlSeconds?: number,
  ) => {
    if (selectedKeys.size === 0) return;
    setBatchLoading(true);
    try {
      const operations = Array.from(selectedKeys).map((key) => ({
        op,
        key,
        ttlSeconds,
      }));
      const results = await api.redis.batchKeyOps(connectionId, database, operations);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);
      if (succeeded > 0) {
        toast.success(`Batch ${op.toUpperCase()}: ${succeeded} key(s)`);
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} key(s) failed`);
      }
      if (op === "del" || op === "unlink") {
        setKeys((prev) => prev.filter((k) => !selectedKeys.has(k.key)));
        setDetail((d) =>
          d.mode === "view" && selectedKeys.has(d.key) ? { mode: "none" } : d,
        );
      }
      setSelectedKeys(new Set());
      void scan(pattern, "0", false);
    } catch (e) {
      toast.error("Batch operation failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBatchLoading(false);
    }
  };

  const handleMgetExport = async () => {
    if (selectedKeys.size === 0) return;
    const keysArr = Array.from(selectedKeys);
    setBatchLoading(true);
    try {
      const entries = await api.redis.mget(connectionId, database, keysArr);
      const result = JSON.stringify(entries, null, 2);
      setMsetData(result);
      setMgetDialogOpen(true);
    } catch (e) {
      toast.error("MGET failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBatchLoading(false);
    }
  };

  const handleMsetImport = async () => {
    const entries = parseMsetInput(msetImportText);
    if (!entries || Object.keys(entries).length === 0) {
      toast.error("Invalid format", {
        description: "Expected JSON object or lines of key:value",
      });
      return;
    }
    setMsetLoading(true);
    try {
      await api.redis.mset(connectionId, database, entries);
      const count = Object.keys(entries).length;
      toast.success(`MSET: ${count} key(s) written`);
      setMsetDialogOpen(false);
      setMsetImportText("");
      void scan(pattern, "0", false);
    } catch (e) {
      toast.error("MSET failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMsetLoading(false);
    }
  };

  const handleMsetFileImport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const selected = await open({
        multiple: false,
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "Text", extensions: ["txt"] },
          { name: "All", extensions: ["*"] },
        ],
      });
      if (!selected) return;
      const content = await readTextFile(selected as string);
      setMsetImportText(content);
    } catch (e) {
      toast.error("Failed to read file", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const selectedKey = detail.mode === "view" ? detail.key : null;
  const selectedCount = selectedKeys.size;

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left: key browser */}
      <ResizablePanel defaultSize={30} minSize={18} maxSize={50}>
        <div className="h-full flex flex-col border-r">
          {/* Search */}
          <div className="p-3 border-b space-y-2 shrink-0">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  className="h-7 pl-7 text-xs font-mono"
                  placeholder="Pattern (user:* or *)"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                onClick={handleSearch}
                disabled={isLoading}
                title="Search / Refresh"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {keys.length} keys{isPartial ? "+" : ""}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant={selectedCount > 0 ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    if (selectedCount > 0) {
                      setSelectedKeys(new Set());
                      setLastClickedIndex(null);
                    } else {
                      setSelectedKeys(new Set(keys.map((k) => k.key)));
                    }
                  }}
                  title={selectedCount > 0 ? "Clear selection" : "Select all"}
                >
                  <CheckSquare className="w-3 h-3 mr-1" />
                  {selectedCount > 0 ? "Clear" : "Select"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={onOpenConsole}
                  title="Open Console"
                >
                  <Terminal className="w-3 h-3 mr-1" />
                  Console
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleNewKey}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  New key
                </Button>
              </div>
            </div>
          </div>

          {/* Batch operations toolbar */}
          {selectedCount > 0 && (
            <div className="px-3 py-2 border-b bg-muted/30 space-y-1.5 shrink-0">
              <div className="flex items-center gap-1 flex-wrap">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={batchLoading}
                  onClick={() => runBatchOp("del")}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  DEL ({selectedCount})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={batchLoading}
                  onClick={() => runBatchOp("unlink")}
                >
                  <Unlink className="w-3 h-3 mr-1" />
                  UNLINK
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={batchLoading}
                  onClick={() => {
                    const ttl = prompt("TTL in seconds:");
                    if (ttl) runBatchOp("expire", parseInt(ttl, 10));
                  }}
                >
                  <Clock className="w-3 h-3 mr-1" />
                  EXPIRE
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={batchLoading}
                  onClick={() => runBatchOp("persist")}
                >
                  <LockOpen className="w-3 h-3 mr-1" />
                  PERSIST
                </Button>
                <div className="w-px h-4 bg-border mx-0.5" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={batchLoading}
                  onClick={handleMgetExport}
                >
                  <FileDown className="w-3 h-3 mr-1" />
                  MGET
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={batchLoading}
                  onClick={() => setMsetDialogOpen(true)}
                >
                  <FileUp className="w-3 h-3 mr-1" />
                  MSET
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Shift+click to range-select
              </p>
            </div>
          )}

          {/* Key list */}
          <div className="flex-1 overflow-y-auto">
            {keys.length === 0 && !isLoading && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {requiresPattern
                  ? "Redis Cluster browsing requires a search pattern"
                  : "No keys found"}
              </div>
            )}

            {keys.map((k, index) => {
              const ttlLabel = formatTtlShort(k.ttl);
              const isSelected = selectedKeys.has(k.key);
              return (
                <div
                  key={k.key}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/50 border-b border-border/30 text-xs",
                    selectedKey === k.key && selectedCount === 0 && "bg-accent/50",
                    isSelected && "bg-primary/10",
                  )}
                  onClick={(e) => handleSelectKey(k.key, index, e)}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => {
                      setSelectedKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(k.key)) next.delete(k.key);
                        else next.add(k.key);
                        return next;
                      });
                      setLastClickedIndex(index);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 h-3.5 w-3.5"
                  />
                  <span
                    className={cn(
                      "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
                      TYPE_COLORS[k.keyType] ??
                        "bg-muted text-muted-foreground",
                    )}
                  >
                    {TYPE_DISPLAY_LABEL[k.keyType] ?? k.keyType}
                  </span>
                  <span
                    className="flex-1 truncate font-mono text-foreground"
                    title={k.key}
                  >
                    {k.key}
                  </span>
                  {ttlLabel && (
                    <span
                      className={cn(
                        "shrink-0 text-[10px] tabular-nums",
                        k.ttl <= -2
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {ttlLabel}
                    </span>
                  )}
                </div>
              );
            })}

            {isPartial && !isLoading && (
              <div className="p-2 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={handleLoadMore}
                >
                  Load more
                </Button>
              </div>
            )}

            {requiresPattern && (
              <div className="p-3 text-xs text-muted-foreground border-t">
                Enter a pattern like <span className="font-mono">user:*</span>{" "}
                before browsing cluster keys. Full-cluster wildcard scans are
                blocked.
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Right: key detail */}
      <ResizablePanel defaultSize={70} minSize={50}>
        {detail.mode === "none" ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm">Select a key to view and edit</p>
            <Button variant="outline" size="sm" onClick={handleNewKey}>
              <Plus className="w-4 h-4 mr-2" />
              New key
            </Button>
          </div>
        ) : (
          <RedisKeyView
            key={detail.mode === "new" ? "__new__" : detail.key}
            connectionId={connectionId}
            database={database}
            redisKey={detail.mode === "new" ? "" : detail.key}
            onDeleted={handleKeyDeleted}
            onSavedKeyChange={handleKeySaved}
          />
        )}
      </ResizablePanel>

      {/* MGET Export Dialog */}
      <Dialog open={mgetDialogOpen} onOpenChange={setMgetDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>MGET Export</DialogTitle>
            <DialogDescription>
              Values of {selectedKeys.size} selected key(s)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={msetData}
              readOnly
              className="min-h-[200px] font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(msetData);
                    toast.success("Copied to clipboard");
                  } catch {
                    toast.error("Copy failed");
                  }
                }}
              >
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const { save } = await import("@tauri-apps/plugin-dialog");
                    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
                    const filePath = await save({
                      defaultPath: "redis-mget-export.json",
                      filters: [{ name: "JSON", extensions: ["json"] }],
                    });
                    if (filePath) {
                      await writeTextFile(filePath, msetData);
                      toast.success("Exported successfully");
                    }
                  } catch (e) {
                    toast.error("Export failed", {
                      description: e instanceof Error ? e.message : String(e),
                    });
                  }
                }}
              >
                <FileDown className="w-3.5 h-3.5 mr-1.5" />
                Save to File
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MSET Import Dialog */}
      <Dialog open={msetDialogOpen} onOpenChange={setMsetDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>MSET Import</DialogTitle>
            <DialogDescription>
              Import key-value pairs (JSON object or lines of key:value)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Data</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleMsetFileImport}
                >
                  <Upload className="w-3 h-3 mr-1" />
                  Import File
                </Button>
              </div>
              <Textarea
                value={msetImportText}
                onChange={(e) => setMsetImportText(e.target.value)}
                className="min-h-[180px] font-mono text-xs"
                placeholder={'{"key1": "value1", "key2": "value2"}\nor\nkey1: value1\nkey2: value2'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMsetDialogOpen(false);
                setMsetImportText("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={msetLoading || !msetImportText.trim()}
              onClick={handleMsetImport}
            >
              {msetLoading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ResizablePanelGroup>
  );
}

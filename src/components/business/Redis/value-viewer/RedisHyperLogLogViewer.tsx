import { useState, useCallback } from "react";
import { Hash, Plus, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RedisKeyExtra } from "@/services/api";

interface Props {
  value: string;
  isBinary: boolean;
  extra?: RedisKeyExtra | null;
  connectionId: number;
  database?: string;
  redisKey: string;
  onRefresh: () => void;
}

export function RedisHyperLogLogViewer({
  value,
  isBinary,
  extra,
  connectionId,
  database,
  redisKey,
  onRefresh,
}: Props) {
  const [elements, setElements] = useState("");
  const [adding, setAdding] = useState(false);
  const [lastResult, setLastResult] = useState<boolean | null>(null);

  const hllCount = extra?.hllCount ?? 0;
  const byteSize = isBinary
    ? (() => {
        try {
          return atob(value).length;
        } catch {
          return value.length;
        }
      })()
    : value.length;

  const handlePfadd = useCallback(async () => {
    const items = elements
      .split(/[,\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    setAdding(true);
    try {
      const { api } = await import("@/services/api");
      const result = await api.redis.hllPfadd(
        connectionId,
        database,
        redisKey,
        items,
      );
      setLastResult(result);
      setElements("");
      onRefresh();
    } catch {
      // error handled upstream
    } finally {
      setAdding(false);
    }
  }, [elements, connectionId, database, redisKey, onRefresh]);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Hash className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">HyperLogLog</span>
        </div>
        <Badge variant="outline" className="text-xs font-mono gap-1">
          ~{hllCount.toLocaleString()} elements
        </Badge>
        <Badge variant="secondary" className="text-xs font-mono gap-1">
          {byteSize.toLocaleString()} bytes
        </Badge>
      </div>

      {/* Info */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2">
        <Hash className="w-3.5 h-3.5 shrink-0" />
        <span>
          HyperLogLog is a probabilistic data structure for cardinality
          estimation. The count above is an approximation with ~0.81% standard
          error.
        </span>
      </div>

      {/* PFADD form */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Add elements (PFADD)
        </div>
        <div className="flex gap-2">
          <Input
            className="h-8 font-mono text-xs flex-1"
            placeholder="Enter elements, comma or newline separated"
            value={elements}
            onChange={(e) => setElements(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePfadd()}
          />
          <Button
            size="sm"
            className="h-8 px-3"
            onClick={handlePfadd}
            disabled={adding || !elements.trim()}
          >
            <Plus className="w-3 h-3 mr-1" />
            {adding ? "Adding..." : "Add"}
          </Button>
        </div>

        {lastResult !== null && (
          <div
            className={`flex items-center gap-2 text-xs rounded px-3 py-1.5 ${
              lastResult
                ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950/30"
                : "text-muted-foreground bg-muted/30"
            }`}
          >
            {lastResult ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            {lastResult
              ? "New element(s) added to the HyperLogLog"
              : "All elements already existed in the HyperLogLog"}
          </div>
        )}
      </div>

      {/* Raw value */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">
          Internal State
        </div>
        <div className="p-2 bg-muted/30 rounded text-xs font-mono text-muted-foreground break-all max-h-32 overflow-y-auto">
          {isBinary ? (
            <span className="text-amber-600">
              {value.substring(0, 200)}
              {value.length > 200 && "…"}
              <span className="text-[10px] block mt-1">
                (Base64-encoded binary data)
              </span>
            </span>
          ) : (
            <>
              {value.substring(0, 200)}
              {value.length > 200 && "…"}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

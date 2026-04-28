import { useState, useMemo, useCallback } from "react";
import {
  Binary,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Hash,
  Search,
  Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RedisBitmapBit, RedisKeyExtra } from "@/services/api";

interface Props {
  value: string;
  isBinary: boolean;
  onChange: (v: string) => void;
  onPatch: (bits: RedisBitmapBit[]) => void | Promise<void>;
  extra?: RedisKeyExtra | null;
}

const COLS_OPTIONS = [8, 16, 32, 64];

function parseBytes(value: string, isBinary: boolean): number[] {
  if (!value) return [];
  const bytes: number[] = [];
  if (isBinary) {
    try {
      const raw = atob(value);
      for (let i = 0; i < raw.length; i++) {
        bytes.push(raw.charCodeAt(i));
      }
    } catch {
      for (let i = 0; i < value.length; i++) {
        bytes.push(value.charCodeAt(i) & 0xff);
      }
    }
  } else {
    for (let i = 0; i < value.length; i++) {
      bytes.push(value.charCodeAt(i) & 0xff);
    }
  }
  return bytes;
}

function getBit(bytes: number[], offset: number): boolean {
  const byteIdx = offset >> 3;
  if (byteIdx >= bytes.length) return false;
  const bitIdx = 7 - (offset & 7);
  return ((bytes[byteIdx] >> bitIdx) & 1) === 1;
}

export function RedisBitmapViewer({ value, isBinary, onPatch, extra }: Props) {
  const [cols, setCols] = useState(16);
  const [page, setPage] = useState(0);
  const [gotoOffset, setGotoOffset] = useState("");
  const [pending, setPending] = useState<Map<number, boolean>>(new Map());

  const totalBits = useMemo(() => {
    const bytes = parseBytes(value, isBinary);
    return bytes.length * 8;
  }, [value, isBinary]);

  const pageSize = cols * 16;
  const totalPages = Math.ceil(totalBits / pageSize) || 1;
  const pageStart = page * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalBits);
  const bitsOn = extra?.bitmapCount ?? 0;

  const bytes = useMemo(() => parseBytes(value, isBinary), [value, isBinary]);

  const toggleBit = useCallback(
    (offset: number) => {
      const current = pending.has(offset)
        ? pending.get(offset)!
        : getBit(bytes, offset);
      const next = new Map(pending);
      const original = getBit(bytes, offset);
      if (!current === original) {
        next.delete(offset);
      } else {
        next.set(offset, !current);
      }
      setPending(next);
    },
    [bytes, pending],
  );

  const commitPending = useCallback(() => {
    if (pending.size === 0) return;
    const bits: RedisBitmapBit[] = [];
    for (const [offset, val] of pending) {
      bits.push({ offset, value: val });
    }
    onPatch(bits);
    setPending(new Map());
  }, [pending, onPatch]);

  const discardPending = useCallback(() => {
    setPending(new Map());
  }, []);

  const handleGoto = useCallback(() => {
    const offset = parseInt(gotoOffset, 10);
    if (isNaN(offset) || offset < 0) return;
    const targetPage = Math.floor(offset / pageSize);
    setPage(targetPage);
    setGotoOffset("");
  }, [gotoOffset, pageSize]);

  const bitRows = useMemo(() => {
    const rows: { offset: number; value: boolean; pending: boolean }[][] = [];
    for (let start = pageStart; start < pageEnd; start += cols) {
      const row: { offset: number; value: boolean; pending: boolean }[] = [];
      for (let col = 0; col < cols && start + col < pageEnd; col++) {
        const offset = start + col;
        const pendingVal = pending.get(offset);
        const val = pendingVal !== undefined ? pendingVal : getBit(bytes, offset);
        row.push({ offset, value: val, pending: pendingVal !== undefined });
      }
      rows.push(row);
    }
    return rows;
  }, [bytes, pageStart, pageEnd, cols, pending]);

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Binary className="w-3.5 h-3.5" />
          <span>{totalBits.toLocaleString()} bits</span>
        </div>
        <Badge variant="outline" className="text-xs font-mono gap-1">
          <Grid3X3 className="w-3 h-3" />
          {bitsOn.toLocaleString()} set
        </Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Cols:</span>
          <Select
            value={String(cols)}
            onValueChange={(v) => {
              setCols(Number(v));
              setPage(0);
            }}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLS_OPTIONS.map((c) => (
                <SelectItem key={c} value={String(c)}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Goto offset */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Hash className="w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="h-7 font-mono text-xs w-28"
            placeholder="Offset"
            value={gotoOffset}
            onChange={(e) => setGotoOffset(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGoto()}
            inputMode="numeric"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleGoto}
          >
            <Search className="w-3 h-3" />
          </Button>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[6rem] text-center">
            {pageStart.toLocaleString()}–{(pageEnd - 1).toLocaleString()} /{" "}
            {totalBits.toLocaleString()}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Pending changes action bar */}
      {pending.size > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-1.5">
          <Settings2 className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {pending.size} bit(s) modified
          </span>
          <Button
            size="sm"
            className="h-6 ml-auto text-xs"
            onClick={commitPending}
          >
            Apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={discardPending}
          >
            Discard
          </Button>
        </div>
      )}

      {/* Bitmap grid */}
      <div className="overflow-x-auto">
        <div className="inline-block">
          {/* Header row: byte offsets */}
          <div className="flex items-center gap-0.5 mb-0.5">
            <div className="w-16 text-right pr-2 text-[10px] text-muted-foreground font-mono shrink-0" />
            {Array.from({ length: cols }).map((_, i) => (
              <div
                key={i}
                className="w-6 text-center text-[10px] text-muted-foreground font-mono"
              >
                {(pageStart + i) & 7}
              </div>
            ))}
          </div>

          {/* Data rows */}
          {bitRows.map((row, rowIdx) => {
            const rowStart = row[0]?.offset ?? 0;
            const byteIdx = rowStart >> 3;
            return (
              <div key={rowIdx} className="flex items-center gap-0.5 mb-0.5">
                <div className="w-16 text-right pr-2 text-[10px] text-muted-foreground font-mono shrink-0 tabular-nums">
                  {byteIdx}
                </div>
                {row.map((bit) => (
                  <TooltipProvider key={bit.offset} delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className={`
                            w-6 h-6 rounded-sm text-[10px] font-mono flex items-center justify-center
                            transition-colors cursor-pointer border
                            ${
                              bit.pending
                                ? bit.value
                                  ? "bg-green-300 dark:bg-green-700 border-green-400 dark:border-green-600 text-green-900 dark:text-green-100 ring-1 ring-amber-400"
                                  : "bg-red-200 dark:bg-red-900/50 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 ring-1 ring-amber-400"
                                : bit.value
                                  ? "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700 text-green-800 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-800/60"
                                  : "bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700/60"
                            }
                          `}
                          onClick={() => toggleBit(bit.offset)}
                        >
                          {bit.value ? "1" : "0"}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="text-xs font-mono"
                      >
                        offset {bit.offset} = {bit.value ? "1" : "0"}
                        {bit.pending ? " (modified)" : ""}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700 inline-block" />
          1 (set)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 inline-block" />
          0 (unset)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-green-300 dark:bg-green-700 border border-green-400 dark:border-green-600 ring-1 ring-amber-400 inline-block" />
          modified
        </span>
        <span className="ml-auto">Click to toggle • Apply to save</span>
      </div>
    </div>
  );
}

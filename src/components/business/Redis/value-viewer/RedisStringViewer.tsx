import { useState } from "react";
import {
  Braces,
  AlertTriangle,
  Info,
  ToggleLeft,
  ToggleRight,
  Plus,
  Minus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RedisKeyExtra } from "@/services/api";

interface Props {
  value: string;
  onChange: (v: string) => void;
  isBinary?: boolean;
  extra?: RedisKeyExtra | null;
  onIncrBy?: (amount: string) => void;
  onIncrByInt?: (amount: number) => void;
}

function tryParseJson(s: string): unknown | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isNumericValue(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  return !isNaN(Number(trimmed)) && isFinite(Number(trimmed));
}

function isIntegerValue(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  return !isNaN(n) && isFinite(n) && Number.isInteger(n);
}

export function RedisStringViewer({
  value,
  onChange,
  isBinary,
  extra,
  onIncrBy,
  onIncrByInt,
}: Props) {
  const [formatted, setFormatted] = useState(false);
  const [editAsText, setEditAsText] = useState(false);
  const [bitmapMode, setBitmapMode] = useState(false);
  const [bitmapOffset, setBitmapOffset] = useState("");
  const [bitmapBit, setBitmapBit] = useState("");
  const [step, setStep] = useState("1");
  const parsed = tryParseJson(value);
  const isJson = parsed !== null && !isBinary;
  const isHll = extra?.subtype === "hyperloglog";
  const isJsonMissing = extra?.subtype === "json-module-missing";
  const isNumeric = isNumericValue(value) && !isBinary && !isJson;
  const isInteger = isIntegerValue(value) && !isBinary && !isJson;
  const useIntIncr = isInteger && onIncrByInt;

  const displayValue =
    formatted && isJson ? JSON.stringify(parsed, null, 2) : value;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{value.length} chars</span>
        <div className="flex items-center gap-2">
          {isJson && (
            <Badge variant="secondary" className="text-xs">
              JSON
            </Badge>
          )}
          {isBinary && (
            <Badge variant="destructive" className="text-xs">
              Binary
            </Badge>
          )}
          {isHll && (
            <Badge
              variant="outline"
              className="text-xs text-violet-600 border-violet-200"
            >
              HyperLogLog
            </Badge>
          )}
          {isJson && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setFormatted((f) => !f)}
            >
              <Braces className="w-3 h-3 mr-1" />
              {formatted ? "Raw" : "Beautify"}
            </Button>
          )}
          {isBinary && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setEditAsText((e) => !e)}
            >
              {editAsText ? "Base64" : "Edit as text"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setBitmapMode((b) => !b)}
            title="Toggle Bitmap mode"
          >
            {bitmapMode ? (
              <ToggleRight className="w-3 h-3 mr-1 text-green-500" />
            ) : (
              <ToggleLeft className="w-3 h-3 mr-1" />
            )}
            Bitmap
          </Button>
        </div>
      </div>

      {isNumeric && (onIncrBy || onIncrByInt) && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-2">
          <span className="text-xs text-muted-foreground shrink-0">
            Counter:
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              const n = Number(step || "1");
              if (useIntIncr) {
                onIncrByInt!(-Math.abs(Math.trunc(n)));
              } else {
                onIncrBy!(`-${step || "1"}`);
              }
            }}
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Input
            className="h-7 font-mono text-xs w-24 text-center"
            value={step}
            onChange={(e) => setStep(e.target.value)}
            placeholder="Step"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              if (useIntIncr) {
                onIncrByInt!(Math.abs(Math.trunc(Number(step || "1"))));
              } else {
                onIncrBy!(step || "1");
              }
            }}
          >
            <Plus className="w-3 h-3" />
          </Button>
          <span className="text-xs text-muted-foreground ml-1">
            {useIntIncr ? "INCRBY" : "INCRBYFLOAT"}
          </span>
        </div>
      )}

      {isHll && (
        <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>
            HyperLogLog detected. Cardinality estimate:{" "}
            <strong>
              {extra?.hllCount?.toLocaleString() ?? "unknown"}
            </strong>
            . Use Console for PFADD / PFMERGE operations.
          </span>
        </div>
      )}

      {isJsonMissing && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            RedisJSON module is not loaded on this server. Displaying raw string
            value. Editing will overwrite the key as a plain string.
          </span>
        </div>
      )}

      {bitmapMode && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">
            Bitmap Operations
          </div>
          <div className="flex gap-2 items-center">
            <Input
              className="h-7 font-mono text-xs w-32"
              placeholder="Offset"
              value={bitmapOffset}
              onChange={(e) => setBitmapOffset(e.target.value)}
              inputMode="numeric"
            />
            <Input
              className="h-7 font-mono text-xs w-20"
              placeholder="Bit (0/1)"
              value={bitmapBit}
              onChange={(e) => setBitmapBit(e.target.value)}
              inputMode="numeric"
            />
            <span className="text-xs text-muted-foreground">
              Use Console: GETBIT / SETBIT / BITCOUNT / BITPOS
            </span>
          </div>
        </div>
      )}

      {isBinary && editAsText && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            This value contains binary data. Editing as text may corrupt the
            original bytes.
          </span>
        </div>
      )}
      <Textarea
        className="min-h-[320px] font-mono text-sm"
        value={displayValue}
        onChange={(e) => {
          setFormatted(false);
          onChange(e.target.value);
        }}
        placeholder="String value"
        readOnly={isBinary && !editAsText}
      />
    </div>
  );
}

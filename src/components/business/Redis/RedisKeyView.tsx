import { useEffect, useState } from "react";
import { Clock, Hash, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import type { RedisKeyValue, RedisValue } from "@/services/api";
import { toast } from "sonner";
import { RedisStringViewer } from "./value-viewer/RedisStringViewer";
import { RedisHashViewer } from "./value-viewer/RedisHashViewer";
import { RedisListViewer } from "./value-viewer/RedisListViewer";
import { RedisSetViewer } from "./value-viewer/RedisSetViewer";
import { RedisZSetViewer } from "./value-viewer/RedisZSetViewer";

type RedisKind = RedisValue["kind"];

interface RedisKeyViewProps {
  connectionId: number;
  database: string;
  redisKey: string;
  onDeleted?: () => void;
  onSavedKeyChange?: (key: string) => void;
}

const EDITABLE_KINDS: RedisKind[] = ["string", "hash", "list", "set", "zSet"];

const KIND_DEFAULT: Record<RedisKind, RedisValue> = {
  string: { kind: "string", value: "" },
  hash: { kind: "hash", value: {} },
  list: { kind: "list", value: [] },
  set: { kind: "set", value: [] },
  zSet: { kind: "zSet", value: [] },
  none: { kind: "none" },
};

const TYPE_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  string: {
    label: "string",
    className:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
  },
  hash: {
    label: "hash",
    className:
      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  },
  list: {
    label: "list",
    className:
      "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  },
  set: {
    label: "set",
    className:
      "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800",
  },
  zSet: {
    label: "zset",
    className:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800",
  },
};

function formatTtl(ttl: number): string {
  if (ttl === -1) return "No expiry";
  if (ttl <= -2) return "Expired";
  const h = Math.floor(ttl / 3600);
  const m = Math.floor((ttl % 3600) / 60);
  const s = ttl % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function countItems(value: RedisValue): number {
  if (value.kind === "string" || value.kind === "none") return 0;
  if (value.kind === "hash") return Object.keys(value.value).length;
  return value.value.length;
}

function mergeValues(base: RedisValue, next: RedisValue): RedisValue {
  if (base.kind !== next.kind) return base;
  if (base.kind === "list" && next.kind === "list") {
    return { kind: "list", value: [...base.value, ...next.value] };
  }
  if (base.kind === "set" && next.kind === "set") {
    const merged = [
      ...base.value,
      ...next.value.filter((m) => !base.value.includes(m)),
    ];
    return { kind: "set", value: merged };
  }
  if (base.kind === "zSet" && next.kind === "zSet") {
    const existingMembers = new Set(base.value.map((m) => m.member));
    const added = next.value.filter((m) => !existingMembers.has(m.member));
    return { kind: "zSet", value: [...base.value, ...added] };
  }
  if (base.kind === "hash" && next.kind === "hash") {
    return { kind: "hash", value: { ...base.value, ...next.value } };
  }
  return base;
}

export function RedisKeyView({
  connectionId,
  database,
  redisKey,
  onDeleted,
  onSavedKeyChange,
}: RedisKeyViewProps) {
  const [record, setRecord] = useState<RedisKeyValue | null>(null);
  const [value, setValue] = useState<RedisValue>({ kind: "string", value: "" });
  const [keyName, setKeyName] = useState(redisKey);
  const [ttl, setTtl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "delete" | "overwrite" | null
  >(null);
  const [valueIsPartial, setValueIsPartial] = useState(false);
  const [valueTotalLen, setValueTotalLen] = useState<number | null>(null);
  const [loadedOffset, setLoadedOffset] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const isCreateMode = redisKey.trim().length === 0;

  const load = async () => {
    if (isCreateMode) {
      setRecord(null);
      setKeyName("");
      setTtl("");
      setValue({ kind: "string", value: "" });
      setValueIsPartial(false);
      setValueTotalLen(null);
      return;
    }
    setIsLoading(true);
    try {
      const next = await api.redis.getKey(connectionId, database, redisKey);
      setRecord(next);
      const v = next.value;
      const resolvedKind = EDITABLE_KINDS.includes(v.kind) ? v.kind : "string";
      setValue(resolvedKind === v.kind ? v : KIND_DEFAULT[resolvedKind]);
      setKeyName(next.key);
      setTtl(next.ttl > 0 ? String(next.ttl) : "");
      const count = countItems(v);
      setLoadedCount(count);
      const total = next.valueTotalLen ?? null;
      setValueTotalLen(total);
      setValueIsPartial(total !== null && total > count);
      setLoadedOffset(next.valueOffset + count);
    } catch (e) {
      toast.error("Failed to load Redis key", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [connectionId, database, redisKey, isCreateMode]);

  const handleLoadMore = async () => {
    if (!record) return;
    setIsLoadingMore(true);
    try {
      const page = await api.redis.getKeyPage(
        connectionId,
        database,
        redisKey,
        loadedOffset,
        200,
      );
      const merged = mergeValues(value, page.value);
      setValue(merged);
      const newCount = countItems(merged);
      setLoadedCount(newCount);
      setLoadedOffset(page.valueOffset + countItems(page.value));
      setValueIsPartial(
        page.valueTotalLen !== null && page.valueTotalLen > newCount,
      );
    } catch (e) {
      toast.error("Failed to load more items", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsLoadingMore(false);
    }
  };

  const validateTtl = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
      throw new Error("TTL must be a positive integer (1–2147483647)");
    }
    return n;
  };

  const doSave = async () => {
    const normalizedKey = keyName.trim();
    if (!normalizedKey) throw new Error("Redis key cannot be empty");
    const parsedTtl = validateTtl(ttl);
    if (!isCreateMode && normalizedKey !== redisKey) {
      await api.redis.renameKey(
        connectionId,
        database,
        redisKey,
        normalizedKey,
      );
    }
    const payload = { key: normalizedKey, value, ttlSeconds: parsedTtl };
    if (isCreateMode) {
      await api.redis.setKey(connectionId, database, payload);
    } else {
      await api.redis.updateKey(connectionId, database, payload);
    }
    toast.success("Redis key saved");
    if (normalizedKey !== redisKey) {
      onSavedKeyChange?.(normalizedKey);
    } else if (!isCreateMode) {
      await load();
    }
  };

  const handleSave = async () => {
    if (isCreateMode) {
      setIsSaving(true);
      try {
        await doSave();
      } catch (e) {
        toast.error("Failed to save Redis key", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setIsSaving(false);
      }
      return;
    }
    try {
      validateTtl(ttl);
    } catch (e) {
      toast.error("Failed to save Redis key", {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    setPendingAction("overwrite");
  };

  const doDelete = async () => {
    await api.redis.deleteKey(connectionId, database, redisKey);
    toast.success("Redis key deleted");
    onDeleted?.();
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      if (pendingAction === "delete") {
        await doDelete();
      } else {
        await doSave();
      }
    } catch (e) {
      toast.error("Operation failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsSaving(false);
      setPendingAction(null);
    }
  };

  const handleKindChange = (newKind: RedisKind) => {
    setValue(KIND_DEFAULT[newKind]);
  };

  const typeBadge = record ? TYPE_BADGE[record.value.kind] : null;

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-xl font-semibold tracking-tight truncate">
              {isCreateMode ? "New Redis key" : redisKey}
            </h2>
            {typeBadge && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${typeBadge.className}`}
              >
                {typeBadge.label}
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={isCreateMode || isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setPendingAction("delete")}
              disabled={isCreateMode}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        {/* Metadata bar (view mode only) */}
        {!isCreateMode && record && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground px-3 py-2 rounded-lg bg-muted/40 border">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              TTL: {formatTtl(record.ttl)}
            </span>
            {valueTotalLen !== null && valueTotalLen > 0 && (
              <span className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" />
                {valueTotalLen.toLocaleString()} total
              </span>
            )}
            <span className="text-muted-foreground/60">{database}</span>
          </div>
        )}

        {/* Edit form: key name / type / TTL */}
        <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[1fr_160px_160px]">
          <div className="space-y-2">
            <Label>Key</Label>
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="key name"
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            {isCreateMode ? (
              <Select
                value={value.kind === "none" ? "string" : value.kind}
                onValueChange={(v) => handleKindChange(v as RedisKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">string</SelectItem>
                  <SelectItem value="hash">hash</SelectItem>
                  <SelectItem value="list">list</SelectItem>
                  <SelectItem value="set">set</SelectItem>
                  <SelectItem value="zSet">zset</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                {record?.keyType ?? value.kind}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>TTL (seconds)</Label>
            <Input
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              placeholder="persist"
              inputMode="numeric"
            />
          </div>
        </div>

        {/* Value viewer */}
        <div className="space-y-2">
          <Label>Value</Label>

          {value.kind === "string" && (
            <RedisStringViewer
              value={value.value}
              onChange={(v) => setValue({ kind: "string", value: v })}
            />
          )}
          {value.kind === "hash" && (
            <RedisHashViewer
              value={value.value}
              onChange={(v) => setValue({ kind: "hash", value: v })}
            />
          )}
          {value.kind === "list" && (
            <RedisListViewer
              value={value.value}
              onChange={(v) => setValue({ kind: "list", value: v })}
            />
          )}
          {value.kind === "set" && (
            <RedisSetViewer
              value={value.value}
              onChange={(v) => setValue({ kind: "set", value: v })}
            />
          )}
          {value.kind === "zSet" && (
            <RedisZSetViewer
              value={value.value}
              onChange={(v) => setValue({ kind: "zSet", value: v })}
            />
          )}
          {value.kind === "none" && (
            <div className="text-sm text-muted-foreground italic py-4">
              Key does not exist or type is unsupported.
            </div>
          )}

          {valueIsPartial && !isCreateMode && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
              <span>
                Showing {loadedCount} of {valueTotalLen} items
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleLoadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Load more
              </Button>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === "delete"
                ? "Delete this key?"
                : "Overwrite key data?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === "delete"
                ? `"${redisKey}" will be permanently deleted. This cannot be undone.`
                : "This will replace the current value. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirm()}>
              {pendingAction === "delete" ? "Delete" : "Overwrite"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

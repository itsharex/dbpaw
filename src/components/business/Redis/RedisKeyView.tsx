import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/services/api";
import type { RedisKeyValue, RedisValue } from "@/services/api";
import { toast } from "sonner";

type RedisKind = RedisValue["kind"];

interface RedisKeyViewProps {
  connectionId: number;
  database: string;
  redisKey: string;
  onDeleted?: () => void;
  onSavedKeyChange?: (key: string) => void;
}

const editableKinds: RedisKind[] = ["string", "hash", "list", "set", "zSet"];

const valueToText = (value: RedisValue) => {
  if (value.kind === "string") return value.value;
  if (value.kind === "none") return "";
  return JSON.stringify(value.value, null, 2);
};

const parseValue = (kind: RedisKind, raw: string): RedisValue => {
  if (kind === "string") return { kind, value: raw };
  try {
    const parsed = raw.trim() ? JSON.parse(raw) : kind === "hash" ? {} : [];
    if (kind === "hash") {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error('Hash value must be a JSON object like {"field": "value"}');
      }
    } else if (kind === "list" || kind === "set") {
      if (!Array.isArray(parsed)) {
        throw new Error(`${kind} value must be a JSON array like ["item1", "item2"]`);
      }
    } else if (kind === "zSet") {
      if (!Array.isArray(parsed)) {
        throw new Error("zset value must be a JSON array");
      }
      for (const item of parsed as unknown[]) {
        const entry = item as Record<string, unknown>;
        if (typeof entry.member !== "string") {
          throw new Error('Each zset member must have a string "member" field');
        }
        if (typeof entry.score !== "number" || !isFinite(entry.score)) {
          throw new Error('Each zset member must have a numeric "score" field');
        }
      }
    }
    return { kind, value: parsed } as RedisValue;
  } catch (e) {
    throw new Error(
      `Invalid value for ${kind}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

const countItems = (value: RedisValue): number => {
  if (value.kind === "string" || value.kind === "none") return 0;
  if (value.kind === "hash") return Object.keys(value.value).length;
  return value.value.length;
};

const mergeValues = (base: RedisValue, next: RedisValue): RedisValue => {
  if (base.kind !== next.kind) return base;
  if (base.kind === "list" && next.kind === "list") {
    return { kind: "list", value: [...base.value, ...next.value] };
  }
  if (base.kind === "set" && next.kind === "set") {
    const merged = [...base.value, ...next.value.filter((m) => !base.value.includes(m))];
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
};

export function RedisKeyView({
  connectionId,
  database,
  redisKey,
  onDeleted,
  onSavedKeyChange,
}: RedisKeyViewProps) {
  const [record, setRecord] = useState<RedisKeyValue | null>(null);
  const [kind, setKind] = useState<RedisKind>("string");
  const [keyName, setKeyName] = useState(redisKey);
  const [ttl, setTtl] = useState("");
  const [valueText, setValueText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<"delete" | "overwrite" | null>(null);
  const [valueIsPartial, setValueIsPartial] = useState(false);
  const [valueTotalLen, setValueTotalLen] = useState<number | null>(null);
  const [loadedOffset, setLoadedOffset] = useState<number>(0);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isCreateMode = redisKey.trim().length === 0;

  const load = async () => {
    if (isCreateMode) {
      setRecord(null);
      setKind("string");
      setKeyName("");
      setTtl("");
      setValueText("");
      setValueIsPartial(false);
      setValueTotalLen(null);
      return;
    }
    setIsLoading(true);
    try {
      const next = await api.redis.getKey(connectionId, database, redisKey);
      setRecord(next);
      const nextKind = editableKinds.includes(next.value.kind)
        ? next.value.kind
        : "string";
      setKind(nextKind);
      setKeyName(next.key);
      setTtl(next.ttl > 0 ? String(next.ttl) : "");
      setValueText(valueToText(next.value));
      const count = countItems(next.value);
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
      const baseValue = parseValue(kind, valueText);
      const merged = mergeValues(baseValue, page.value);
      setValueText(valueToText(merged));
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
      await api.redis.renameKey(connectionId, database, redisKey, normalizedKey);
    }
    const payload = {
      key: normalizedKey,
      value: parseValue(kind, valueText),
      ttlSeconds: parsedTtl,
    };
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
      parseValue(kind, valueText);
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

  const handleDelete = () => {
    if (isCreateMode) return;
    setPendingAction("delete");
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

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {isCreateMode ? "New Redis key" : redisKey}
            </h2>
            <p className="text-sm text-muted-foreground">
              Redis {database}{" "}
              {record ? ` · ${record.keyType} · TTL ${record.ttl}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={isCreateMode}
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
              onClick={handleDelete}
              disabled={isCreateMode}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[1fr_160px_160px]">
          <div className="space-y-2">
            <Label>Key</Label>
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as RedisKind)}
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
          </div>
          <div className="space-y-2">
            <Label>TTL seconds</Label>
            <Input
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
              placeholder="persist"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Value</Label>
          <Textarea
            className="min-h-[420px] font-mono text-sm"
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            placeholder={
              kind === "string"
                ? "raw string value"
                : "JSON value for this Redis type"
            }
          />
          {valueIsPartial && !isCreateMode && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
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

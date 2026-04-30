import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  api,
  type RedisKeyExtra,
  type RedisStreamEntry,
  type RedisStreamGroup,
  type RedisStreamView,
  type RedisXPendingEntry,
  type RedisXPendingSummary,
} from "@/services/api";

const DEFAULT_PAGE_SIZE = 200;

interface Props {
  connectionId: number;
  database: string;
  redisKey: string;
  value: RedisStreamEntry[];
  onChange: (v: RedisStreamEntry[]) => void;
  totalLen?: number | null;
  extra?: RedisKeyExtra | null;
  isCreateMode?: boolean;
}

interface StreamBrowserState {
  startIdInput: string;
  endIdInput: string;
  countInput: string;
  appliedStartId: string;
  appliedEndId: string;
  pageSize: number;
  nextStartId: string | null;
  totalLen: number | null;
  streamInfo: RedisKeyExtra["streamInfo"];
  groups: RedisStreamGroup[];
}

const createInitialBrowserState = (
  entries: RedisStreamEntry[],
  totalLen?: number | null,
  extra?: RedisKeyExtra | null,
): StreamBrowserState => ({
  startIdInput: "",
  endIdInput: "",
  countInput: String(DEFAULT_PAGE_SIZE),
  appliedStartId: "-",
  appliedEndId: "+",
  pageSize: DEFAULT_PAGE_SIZE,
  nextStartId:
    totalLen !== null && totalLen !== undefined && entries.length < totalLen && entries.length > 0
      ? `(${entries[entries.length - 1].id}`
      : null,
  totalLen: totalLen ?? null,
  streamInfo: extra?.streamInfo ?? null,
  groups: extra?.streamGroups ?? [],
});

function formatFields(fields: Record<string, string>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return "{}";
  if (keys.length <= 3) {
    return "{ " + keys.map((key) => `${key}: ${fields[key]}`).join(", ") + " }";
  }
  return `{ ${keys[0]}: ${fields[keys[0]]}, ${keys[1]}: ${fields[keys[1]]}, ... +${keys.length - 2} }`;
}

function parseFieldsRaw(raw: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  const lines = raw.split(/\n|,/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return null;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!key) return null;
    result[key] = value;
  }
  return result;
}

function resolvePageSize(raw: string) {
  const parsed = Number(raw.trim() || String(DEFAULT_PAGE_SIZE));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("Count must be an integer between 1 and 1000");
  }
  return parsed;
}

function mapViewResultToBrowserState(result: RedisStreamView, current: StreamBrowserState): StreamBrowserState {
  return {
    ...current,
    appliedStartId: result.startId,
    appliedEndId: result.endId,
    pageSize: result.count,
    nextStartId: result.nextStartId ?? null,
    totalLen: result.totalLen,
    streamInfo: result.streamInfo ?? null,
    groups: result.groups,
  };
}

function formatIdleMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

// ── Main Component ──────────────────────────────────────────────────────────

export function RedisStreamViewer({
  connectionId,
  database,
  redisKey,
  value,
  onChange,
  totalLen,
  extra,
  isCreateMode,
}: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showNewRow, setShowNewRow] = useState(false);
  const [newId, setNewId] = useState("*");
  const [newFieldsRaw, setNewFieldsRaw] = useState("");
  const [browser, setBrowser] = useState<StreamBrowserState>(() =>
    createInitialBrowserState(value, totalLen, extra),
  );
  const [isLoadingView, setIsLoadingView] = useState(false);

  // ── Consumer Group state ──
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(null);
  const [resetGroupTarget, setResetGroupTarget] = useState<string | null>(null);
  const [expandedGroupNames, setExpandedGroupNames] = useState<Set<string>>(new Set());
  const [pendingData, setPendingData] = useState<Record<string, RedisXPendingSummary | RedisXPendingEntry[] | null>>({});
  const [pendingLoading, setPendingLoading] = useState<Record<string, boolean>>({});
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [claimTarget, setClaimTarget] = useState<{ group: string; entry: RedisXPendingEntry } | null>(null);

  // ── XTRIM state ──
  const [showTrimDialog, setShowTrimDialog] = useState(false);

  // ── XREADGROUP state ──
  const [readMode, setReadMode] = useState<"xrange" | "xreadgroup">("xrange");
  const [xrgGroup, setXrgGroup] = useState("");
  const [xrgConsumer, setXrgConsumer] = useState("");
  const [xrgStartId, setXrgStartId] = useState(">");
  const [xrgEntries, setXrgEntries] = useState<RedisStreamEntry[] | null>(null);
  const [isLoadingXrg, setIsLoadingXrg] = useState(false);

  useEffect(() => {
    setBrowser(createInitialBrowserState(value, totalLen, extra));
    setExpandedIds(new Set());
    setShowNewRow(false);
    setNewId("*");
    setNewFieldsRaw("");
    setExpandedGroupNames(new Set());
    setPendingData({});
    setSelectedPendingIds(new Set());
    setXrgEntries(null);
  }, [connectionId, database, redisKey, totalLen, extra]);

  const hasMore = useMemo(() => {
    if (isCreateMode) return false;
    if (browser.nextStartId) return true;
    return browser.totalLen !== null && value.length < browser.totalLen;
  }, [browser.nextStartId, browser.totalLen, isCreateMode, value.length]);

  const refreshView = useCallback(async () => {
    try {
      const result = await api.redis.getStreamView(
        connectionId,
        database,
        redisKey,
        browser.appliedStartId,
        browser.appliedEndId,
        browser.pageSize,
      );
      onChange(result.entries);
      setBrowser((current) => mapViewResultToBrowserState(result, current));
    } catch {
      // silent — caller can show toast
    }
  }, [connectionId, database, redisKey, browser.appliedStartId, browser.appliedEndId, browser.pageSize, onChange]);

  const loadStreamView = async (
    mode: "replace" | "append",
    overrides?: { startId?: string; endId?: string; count?: number },
  ) => {
    if (isCreateMode) return;

    let count: number;
    try {
      count = overrides?.count ?? resolvePageSize(browser.countInput);
    } catch (e) {
      toast.error("Invalid stream range", {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    const startId =
      mode === "append"
        ? browser.nextStartId ||
          (value.length > 0 ? `(${value[value.length - 1].id}` : browser.appliedStartId)
        : (overrides?.startId ?? browser.startIdInput.trim()) || "-";
    const endId = (overrides?.endId ?? browser.endIdInput.trim()) || "+";

    setIsLoadingView(true);
    try {
      const result = await api.redis.getStreamView(
        connectionId,
        database,
        redisKey,
        startId,
        endId,
        count,
      );
      onChange(mode === "append" ? [...value, ...result.entries] : result.entries);
      setBrowser((current) => mapViewResultToBrowserState(result, current));
    } catch (e) {
      toast.error(
        mode === "append" ? "Failed to load more stream entries" : "Failed to load stream entries",
        { description: e instanceof Error ? e.message : String(e) },
      );
    } finally {
      setIsLoadingView(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteEntry = (id: string) => {
    onChange(value.filter((entry) => entry.id !== id));
  };

  const addEntry = () => {
    const fields = parseFieldsRaw(newFieldsRaw);
    if (!fields) return;
    onChange([{ id: newId.trim() || "*", fields }, ...value]);
    setShowNewRow(false);
    setNewId("*");
    setNewFieldsRaw("");
  };

  // ── Group operations ──

  const handleCreateGroup = async (groupName: string, startId: string, mkstream: boolean) => {
    try {
      await api.redis.xgroupCreate(connectionId, database, redisKey, groupName, startId, mkstream);
      toast.success(`Group "${groupName}" created`);
      setShowCreateGroupDialog(false);
      await refreshView();
    } catch (e) {
      toast.error("Failed to create group", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    try {
      await api.redis.xgroupDel(connectionId, database, redisKey, deleteGroupTarget);
      toast.success(`Group "${deleteGroupTarget}" deleted`);
      setDeleteGroupTarget(null);
      setExpandedGroupNames((s) => { const n = new Set(s); n.delete(deleteGroupTarget); return n; });
      setPendingData((s) => { const n = { ...s }; delete n[deleteGroupTarget]; return n; });
      await refreshView();
    } catch (e) {
      toast.error("Failed to delete group", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleResetGroup = async (startId: string) => {
    if (!resetGroupTarget) return;
    try {
      await api.redis.xgroupSetId(connectionId, database, redisKey, resetGroupTarget, startId);
      toast.success(`Group "${resetGroupTarget}" cursor reset`);
      setResetGroupTarget(null);
      await refreshView();
    } catch (e) {
      toast.error("Failed to reset group cursor", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const toggleGroupExpand = async (groupName: string) => {
    setExpandedGroupNames((current) => {
      const next = new Set(current);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });

    if (!expandedGroupNames.has(groupName) && !pendingData[groupName]) {
      setPendingLoading((s) => ({ ...s, [groupName]: true }));
      try {
        const result = await api.redis.xpending(connectionId, database, redisKey, groupName);
        setPendingData((s) => ({ ...s, [groupName]: result as RedisXPendingSummary }));
      } catch (e) {
        toast.error("Failed to load pending info", { description: e instanceof Error ? e.message : String(e) });
      } finally {
        setPendingLoading((s) => ({ ...s, [groupName]: false }));
      }
    }
  };

  const loadPendingDetails = async (groupName: string) => {
    setPendingLoading((s) => ({ ...s, [groupName]: true }));
    try {
      const result = await api.redis.xpending(
        connectionId, database, redisKey, groupName, "-", "+", 100,
      );
      setPendingData((s) => ({ ...s, [groupName]: result as RedisXPendingEntry[] }));
      setSelectedPendingIds(new Set());
    } catch (e) {
      toast.error("Failed to load pending entries", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingLoading((s) => ({ ...s, [groupName]: false }));
    }
  };

  const handleAck = async (groupName: string, ids: string[]) => {
    try {
      const count = await api.redis.xack(connectionId, database, redisKey, groupName, ids);
      toast.success(`Acknowledged ${count} message(s)`);
      setSelectedPendingIds(new Set());
      // Reload pending details
      await loadPendingDetails(groupName);
      await refreshView();
    } catch (e) {
      toast.error("Failed to acknowledge", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleClaim = async (groupName: string, consumer: string, entryId: string) => {
    try {
      await api.redis.xclaim(connectionId, database, redisKey, groupName, consumer, 0, [entryId]);
      toast.success(`Entry claimed by "${consumer}"`);
      setClaimTarget(null);
      await loadPendingDetails(groupName);
    } catch (e) {
      toast.error("Failed to claim entry", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── XTRIM ──

  const handleTrim = async (strategy: string, threshold: string) => {
    try {
      const trimmed = await api.redis.xtrim(connectionId, database, redisKey, strategy, threshold);
      toast.success(`Trimmed ${trimmed} entries`);
      setShowTrimDialog(false);
      await refreshView();
    } catch (e) {
      toast.error("Failed to trim stream", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  // ── XREADGROUP ──

  const handleXreadgroup = async () => {
    if (!xrgGroup || !xrgConsumer) {
      toast.error("Please select a group and enter a consumer name");
      return;
    }
    setIsLoadingXrg(true);
    try {
      const count = resolvePageSize(browser.countInput);
      const entries = await api.redis.xreadgroup(
        connectionId, database, redisKey, xrgGroup, xrgConsumer, xrgStartId, count,
      );
      setXrgEntries(entries);
    } catch (e) {
      toast.error("Failed to read from consumer group", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsLoadingXrg(false);
    }
  };

  const displayEntries = readMode === "xreadgroup" && xrgEntries !== null ? xrgEntries : value;

  return (
    <div className="space-y-3">
      {!isCreateMode && (
        <>
          <StreamFilterBar
            browser={browser}
            isLoading={isLoadingView}
            onChange={setBrowser}
            onApply={() => void loadStreamView("replace")}
            onReset={() => {
              setBrowser((current) => ({
                ...current,
                startIdInput: "",
                endIdInput: "",
                countInput: String(DEFAULT_PAGE_SIZE),
                appliedStartId: "-",
                appliedEndId: "+",
                pageSize: DEFAULT_PAGE_SIZE,
              }));
              void loadStreamView("replace", {
                startId: "-",
                endId: "+",
                count: DEFAULT_PAGE_SIZE,
              });
            }}
            readMode={readMode}
            onReadModeChange={setReadMode}
            xrgGroup={xrgGroup}
            onXrgGroupChange={setXrgGroup}
            xrgConsumer={xrgConsumer}
            onXrgConsumerChange={setXrgConsumer}
            xrgStartId={xrgStartId}
            onXrgStartIdChange={setXrgStartId}
            groups={browser.groups}
            onXreadgroupApply={() => void handleXreadgroup()}
            isLoadingXrg={isLoadingXrg}
          />

          <StreamSummaryCards
            entryCount={value.length}
            totalLen={browser.totalLen}
            streamInfo={browser.streamInfo}
            groups={browser.groups}
            appliedStartId={browser.appliedStartId}
            appliedEndId={browser.appliedEndId}
            onTrim={() => setShowTrimDialog(true)}
          />

          <StreamGroupsTable
            groups={browser.groups}
            expandedGroupNames={expandedGroupNames}
            pendingData={pendingData}
            pendingLoading={pendingLoading}
            selectedPendingIds={selectedPendingIds}
            onToggleGroup={toggleGroupExpand}
            onCreateGroup={() => setShowCreateGroupDialog(true)}
            onDeleteGroup={(name) => setDeleteGroupTarget(name)}
            onResetGroup={(name) => setResetGroupTarget(name)}
            onLoadPendingDetails={loadPendingDetails}
            onAck={handleAck}
            onClaim={(group, entry) => setClaimTarget({ group, entry })}
            onTogglePendingSelect={(id) => {
              setSelectedPendingIds((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id); else n.add(id);
                return n;
              });
            }}
          />
        </>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {readMode === "xreadgroup" && xrgEntries !== null
            ? `${xrgEntries.length} entries (consumer group mode)`
            : `${value.length} entries${browser.totalLen !== null ? ` / ${browser.totalLen}` : ""}`}
        </span>
        <div className="flex gap-2">
          {!isCreateMode && (
            <span className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              Page size {browser.pageSize}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setShowNewRow(true)}
            disabled={showNewRow}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add entry
          </Button>
        </div>
      </div>

      {showNewRow && (
        <StreamAddEntryForm
          newId={newId}
          newFieldsRaw={newFieldsRaw}
          onIdChange={setNewId}
          onFieldsChange={setNewFieldsRaw}
          onAdd={addEntry}
          onCancel={() => {
            setShowNewRow(false);
            setNewId("*");
            setNewFieldsRaw("");
          }}
        />
      )}

      <StreamEntriesTable
        entries={displayEntries}
        expandedIds={expandedIds}
        onToggleExpand={toggleExpand}
        onDelete={deleteEntry}
        pendingAckIds={
          readMode === "xreadgroup" && xrgEntries !== null
            ? new Set(xrgEntries.map((e) => e.id))
            : undefined
        }
        onAckSingle={
          readMode === "xreadgroup" && xrgGroup
            ? (id) => void handleAck(xrgGroup, [id])
            : undefined
        }
      />

      {!isCreateMode && hasMore && readMode === "xrange" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing {value.length}
            {browser.totalLen !== null ? ` of ${browser.totalLen}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStreamView("append")}
            disabled={isLoadingView}
          >
            {isLoadingView ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      )}

      {/* ── Dialogs ── */}
      {showCreateGroupDialog && (
        <CreateGroupDialog
          onClose={() => setShowCreateGroupDialog(false)}
          onConfirm={handleCreateGroup}
        />
      )}

      <AlertDialog open={!!deleteGroupTarget} onOpenChange={(o) => { if (!o) setDeleteGroupTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete consumer group</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the group <span className="font-mono font-semibold">{deleteGroupTarget}</span> and all its pending entries. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteGroup()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {resetGroupTarget && (
        <ResetGroupDialog
          groupName={resetGroupTarget}
          onClose={() => setResetGroupTarget(null)}
          onConfirm={handleResetGroup}
        />
      )}

      {showTrimDialog && (
        <TrimDialog
          currentLength={browser.streamInfo?.length ?? browser.totalLen ?? value.length}
          onClose={() => setShowTrimDialog(false)}
          onConfirm={handleTrim}
        />
      )}

      {claimTarget && (
        <ClaimDialog
          entry={claimTarget.entry}
          onClose={() => setClaimTarget(null)}
          onConfirm={(consumer) => void handleClaim(claimTarget.group, consumer, claimTarget.entry.id)}
        />
      )}
    </div>
  );
}

// ── Filter Bar (enhanced with XREADGROUP mode) ─────────────────────────────

function StreamFilterBar({
  browser,
  isLoading,
  onChange,
  onApply,
  onReset,
  readMode,
  onReadModeChange,
  xrgGroup,
  onXrgGroupChange,
  xrgConsumer,
  onXrgConsumerChange,
  xrgStartId,
  onXrgStartIdChange,
  groups,
  onXreadgroupApply,
  isLoadingXrg,
}: {
  browser: StreamBrowserState;
  isLoading: boolean;
  onChange: Dispatch<SetStateAction<StreamBrowserState>>;
  onApply: () => void;
  onReset: () => void;
  readMode: "xrange" | "xreadgroup";
  onReadModeChange: (mode: "xrange" | "xreadgroup") => void;
  xrgGroup: string;
  onXrgGroupChange: (v: string) => void;
  xrgConsumer: string;
  onXrgConsumerChange: (v: string) => void;
  xrgStartId: string;
  onXrgStartIdChange: (v: string) => void;
  groups: RedisStreamGroup[];
  onXreadgroupApply: () => void;
  isLoadingXrg: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <button
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${readMode === "xrange" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          onClick={() => onReadModeChange("xrange")}
        >
          XRANGE
        </button>
        <button
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${readMode === "xreadgroup" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          onClick={() => onReadModeChange("xreadgroup")}
        >
          Consumer Group
        </button>
      </div>

      {readMode === "xrange" ? (
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto_auto]">
          <Input
            className="h-8 font-mono text-xs"
            value={browser.startIdInput}
            onChange={(e) => onChange((current) => ({ ...current, startIdInput: e.target.value }))}
            placeholder="Start ID (-)"
          />
          <Input
            className="h-8 font-mono text-xs"
            value={browser.endIdInput}
            onChange={(e) => onChange((current) => ({ ...current, endIdInput: e.target.value }))}
            placeholder="End ID (+)"
          />
          <Input
            className="h-8 font-mono text-xs"
            value={browser.countInput}
            onChange={(e) => onChange((current) => ({ ...current, countInput: e.target.value }))}
            placeholder="Count"
            inputMode="numeric"
          />
          <Button variant="outline" size="sm" className="h-8" onClick={onApply} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Filter className="mr-1 h-3 w-3" />
            )}
            Apply
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={onReset}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
          <Select value={xrgGroup} onValueChange={onXrgGroupChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.name} value={g.name}>{g.name}</SelectItem>
              ))}
              {groups.length === 0 && (
                <SelectItem value="__none" disabled>No groups available</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Input
            className="h-8 font-mono text-xs"
            value={xrgConsumer}
            onChange={(e) => onXrgConsumerChange(e.target.value)}
            placeholder="Consumer name"
          />
          <Select value={xrgStartId} onValueChange={onXrgStartIdChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="&gt;">New messages only (&gt;)</SelectItem>
              <SelectItem value="0">Pending messages (0)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onXreadgroupApply}
            disabled={isLoadingXrg || !xrgGroup || !xrgConsumer}
          >
            {isLoadingXrg ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Filter className="mr-1 h-3 w-3" />}
            Read
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Summary Cards (enhanced with Trim button) ───────────────────────────────

function StreamSummaryCards({
  entryCount,
  totalLen,
  streamInfo,
  groups,
  appliedStartId,
  appliedEndId,
  onTrim,
}: {
  entryCount: number;
  totalLen: number | null;
  streamInfo: RedisKeyExtra["streamInfo"];
  groups: RedisStreamGroup[];
  appliedStartId: string;
  appliedEndId: string;
  onTrim: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="grid flex-1 gap-2 md:grid-cols-4">
        <div className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="text-muted-foreground">Length</div>
          <div className="mt-1 font-mono text-sm">
            {(streamInfo?.length ?? totalLen ?? entryCount).toLocaleString()}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="text-muted-foreground">Groups</div>
          <div className="mt-1 font-mono text-sm">
            {(streamInfo?.groups ?? groups.length).toLocaleString()}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="text-muted-foreground">Last generated ID</div>
          <div className="mt-1 truncate font-mono text-sm">
            {streamInfo?.lastGeneratedId || "n/a"}
          </div>
        </div>
        <div className="rounded-md border bg-card px-3 py-2 text-xs">
          <div className="text-muted-foreground">Current range</div>
          <div className="mt-1 font-mono text-sm">
            {appliedStartId} .. {appliedEndId}
          </div>
        </div>
      </div>
      <Button variant="outline" size="sm" className="h-auto shrink-0 px-2 py-2" onClick={onTrim} title="Trim stream">
        <Scissors className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Groups Table (enhanced with CRUD + expandable pending) ──────────────────

function StreamGroupsTable({
  groups,
  expandedGroupNames,
  pendingData,
  pendingLoading,
  selectedPendingIds,
  onToggleGroup,
  onCreateGroup,
  onDeleteGroup,
  onResetGroup,
  onLoadPendingDetails,
  onAck,
  onClaim,
  onTogglePendingSelect,
}: {
  groups: RedisStreamGroup[];
  expandedGroupNames: Set<string>;
  pendingData: Record<string, RedisXPendingSummary | RedisXPendingEntry[] | null>;
  pendingLoading: Record<string, boolean>;
  selectedPendingIds: Set<string>;
  onToggleGroup: (name: string) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (name: string) => void;
  onResetGroup: (name: string) => void;
  onLoadPendingDetails: (name: string) => void;
  onAck: (group: string, ids: string[]) => void;
  onClaim: (group: string, entry: RedisXPendingEntry) => void;
  onTogglePendingSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>Consumer groups</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{groups.length} groups</span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onCreateGroup}>
            <UserPlus className="mr-1 h-3 w-3" />
            Create
          </Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[32px]" />
            <TableHead className="text-xs">Group</TableHead>
            <TableHead className="text-xs">Consumers</TableHead>
            <TableHead className="text-xs">Pending</TableHead>
            <TableHead className="text-xs">Last delivered ID</TableHead>
            <TableHead className="text-xs">Lag</TableHead>
            <TableHead className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-5 text-center text-sm text-muted-foreground">
                No consumer groups
              </TableCell>
            </TableRow>
          ) : (
            groups.flatMap((group) => {
              const expanded = expandedGroupNames.has(group.name);
              const rows = [
                <TableRow
                  key={group.name}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => onToggleGroup(group.name)}
                >
                  <TableCell className="py-1.5">
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{group.name}</TableCell>
                  <TableCell className="text-xs">{group.consumers}</TableCell>
                  <TableCell className="text-xs">
                    <span className={group.pending > 0 ? "text-orange-500 font-medium" : ""}>
                      {group.pending}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {group.lastDeliveredId || "n/a"}
                  </TableCell>
                  <TableCell className="text-xs">{group.lag ?? group.entriesRead ?? "n/a"}</TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="Reset cursor"
                        onClick={() => onResetGroup(group.name)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="Delete group"
                        onClick={() => onDeleteGroup(group.name)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>,
              ];

              if (expanded) {
                rows.push(
                  <TableRow key={`${group.name}-pending`} className="bg-muted/10">
                    <TableCell colSpan={7} className="p-0">
                      <StreamPendingPanel
                        data={pendingData[group.name] ?? null}
                        isLoading={!!pendingLoading[group.name]}
                        selectedIds={selectedPendingIds}
                        onLoadDetails={() => void onLoadPendingDetails(group.name)}
                        onAck={(ids) => onAck(group.name, ids)}
                        onClaim={(entry) => onClaim(group.name, entry)}
                        onToggleSelect={onTogglePendingSelect}
                      />
                    </TableCell>
                  </TableRow>,
                );
              }
              return rows;
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Pending Panel ───────────────────────────────────────────────────────────

function StreamPendingPanel({
  data,
  isLoading,
  selectedIds,
  onLoadDetails,
  onAck,
  onClaim,
  onToggleSelect,
}: {
  data: RedisXPendingSummary | RedisXPendingEntry[] | null;
  isLoading: boolean;
  selectedIds: Set<string>;
  onLoadDetails: () => void;
  onAck: (ids: string[]) => void;
  onClaim: (entry: RedisXPendingEntry) => void;
  onToggleSelect: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading pending info…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">No pending data</div>
    );
  }

  // Summary mode
  if ("minId" in data) {
    const summary = data as RedisXPendingSummary;
    return (
      <div className="space-y-2 px-4 py-3">
        <div className="grid gap-2 md:grid-cols-4">
          <div className="text-xs">
            <span className="text-muted-foreground">Total pending: </span>
            <span className="font-mono font-medium">{summary.count}</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Min ID: </span>
            <span className="font-mono">{summary.minId || "n/a"}</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Max ID: </span>
            <span className="font-mono">{summary.maxId || "n/a"}</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Consumers: </span>
            {summary.consumers.length === 0
              ? "none"
              : summary.consumers.map(([name, cnt]) => (
                  <Badge key={name} variant="secondary" className="ml-1 text-[10px]">
                    {name}: {cnt}
                  </Badge>
                ))}
          </div>
        </div>
        {summary.count > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onLoadDetails}>
            View Details
          </Button>
        )}
      </div>
    );
  }

  // Entries mode
  const entries = data as RedisXPendingEntry[];
  const hasSelection = selectedIds.size > 0;

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{entries.length} pending entries</span>
        {hasSelection && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => onAck(Array.from(selectedIds))}
          >
            <ShieldCheck className="mr-1 h-3 w-3" />
            ACK selected ({selectedIds.size})
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[32px]" />
            <TableHead className="text-xs">Entry ID</TableHead>
            <TableHead className="text-xs">Consumer</TableHead>
            <TableHead className="text-xs">Idle</TableHead>
            <TableHead className="text-xs">Deliveries</TableHead>
            <TableHead className="w-[80px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-3 text-center text-xs text-muted-foreground">
                No pending entries
              </TableCell>
            </TableRow>
          ) : (
            entries.map((entry) => (
              <TableRow key={entry.id} className="group">
                <TableCell className="py-1">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => onToggleSelect(entry.id)}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.id}</TableCell>
                <TableCell className="font-mono text-xs">{entry.consumer}</TableCell>
                <TableCell className="text-xs">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {formatIdleMs(entry.idleMs)}
                  </span>
                </TableCell>
                <TableCell className="text-xs">{entry.deliveryCount}</TableCell>
                <TableCell className="py-1">
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="ACK this entry"
                      onClick={() => onAck([entry.id])}
                    >
                      <Check className="h-3 w-3 text-green-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Claim to another consumer"
                      onClick={() => onClaim(entry)}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Add Entry Form ──────────────────────────────────────────────────────────

function StreamAddEntryForm({
  newId,
  newFieldsRaw,
  onIdChange,
  onFieldsChange,
  onAdd,
  onCancel,
}: {
  newId: string;
  newFieldsRaw: string;
  onIdChange: (value: string) => void;
  onFieldsChange: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <Input
        className="h-7 w-40 font-mono text-xs"
        value={newId}
        onChange={(e) => onIdChange(e.target.value)}
        placeholder="ID (* = auto)"
      />
      <textarea
        className="h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs font-mono"
        value={newFieldsRaw}
        onChange={(e) => onFieldsChange(e.target.value)}
        placeholder={"field1=value1\nfield2=value2"}
      />
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="h-7" onClick={onAdd}>
          <Check className="mr-1 h-3 w-3 text-green-500" />
          Add
        </Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
          <X className="mr-1 h-3 w-3 text-muted-foreground" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Entries Table (enhanced with ACK indicators) ────────────────────────────

function StreamEntriesTable({
  entries,
  expandedIds,
  onToggleExpand,
  onDelete,
  pendingAckIds,
  onAckSingle,
}: {
  entries: RedisStreamEntry[];
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onDelete: (id: string) => void;
  pendingAckIds?: Set<string>;
  onAckSingle?: (id: string) => void;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]" />
            <TableHead className="text-xs">Entry ID</TableHead>
            <TableHead className="text-xs">Field count</TableHead>
            <TableHead className="text-xs">Fields</TableHead>
            <TableHead className="w-[72px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                No entries in this range
              </TableCell>
            </TableRow>
          )}
          {entries.map((entry) => (
            <StreamEntryRow
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggle={() => onToggleExpand(entry.id)}
              onDelete={() => onDelete(entry.id)}
              isPending={pendingAckIds?.has(entry.id)}
              onAck={onAckSingle ? () => onAckSingle(entry.id) : undefined}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StreamEntryRow({
  entry,
  expanded,
  onToggle,
  onDelete,
  isPending,
  onAck,
}: {
  entry: RedisStreamEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  isPending?: boolean;
  onAck?: () => void;
}) {
  return (
    <>
      <TableRow className="group">
        <TableCell className="py-1.5">
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onToggle}>
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </TableCell>
        <TableCell className="max-w-0 truncate py-1.5 font-mono text-xs text-muted-foreground">
          <span title={entry.id} className="inline-flex items-center gap-1">
            {entry.id}
            {isPending && (
              <Badge variant="outline" className="h-4 px-1 text-[9px] text-orange-500 border-orange-300">
                pending
              </Badge>
            )}
          </span>
        </TableCell>
        <TableCell className="py-1.5 text-xs">{Object.keys(entry.fields).length}</TableCell>
        <TableCell className="py-1.5">
          <span
            className="block cursor-pointer truncate font-mono text-xs hover:text-foreground/70"
            title={formatFields(entry.fields)}
            onClick={onToggle}
          >
            {formatFields(entry.fields)}
          </span>
        </TableCell>
        <TableCell className="py-1.5">
          <div className="flex gap-1">
            {onAck && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                title="ACK this entry"
                onClick={onAck}
              >
                <Check className="h-3 w-3 text-green-500" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/20">
          <TableCell colSpan={5} className="py-2">
            <div className="space-y-1 px-2">
              {Object.entries(entry.fields).map(([key, fieldValue]) => (
                <div key={key} className="flex gap-2 text-xs">
                  <span className="min-w-[80px] font-mono text-muted-foreground">{key}</span>
                  <span className="font-mono">{fieldValue}</span>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Dialog Components ───────────────────────────────────────────────────────

function CreateGroupDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (name: string, startId: string, mkstream: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [startId, setStartId] = useState("0");
  const [mkstream, setMkstream] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Consumer Group</DialogTitle>
          <DialogDescription>
            Create a new consumer group for this stream.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Group Name</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-group"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Start ID</Label>
            <Select value={startId} onValueChange={setStartId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0 — Process all entries from the beginning</SelectItem>
                <SelectItem value="$">$ — Only new entries from now on</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={mkstream}
              onChange={(e) => setMkstream(e.target.checked)}
            />
            MKSTREAM (create stream if it doesn't exist)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={() => onConfirm(name.trim(), startId, mkstream)}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetGroupDialog({
  groupName,
  onClose,
  onConfirm,
}: {
  groupName: string;
  onClose: () => void;
  onConfirm: (startId: string) => void;
}) {
  const [startId, setStartId] = useState("0");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Group Cursor</DialogTitle>
          <DialogDescription>
            Reset the last delivered ID for group <span className="font-mono font-semibold">{groupName}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">New Start ID</Label>
          <Select value={startId} onValueChange={setStartId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0 — Reprocess from beginning</SelectItem>
              <SelectItem value="$">$ — Skip to latest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(startId)}>Reset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrimDialog({
  currentLength,
  onClose,
  onConfirm,
}: {
  currentLength: number;
  onClose: () => void;
  onConfirm: (strategy: string, threshold: string) => void;
}) {
  const [strategy, setStrategy] = useState("MAXLEN");
  const [threshold, setThreshold] = useState("");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trim Stream</DialogTitle>
          <DialogDescription>
            Current length: <span className="font-mono">{currentLength.toLocaleString()}</span> entries.
            Uses approximate trimming (~) for better performance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Strategy</Label>
            <Select value={strategy} onValueChange={setStrategy}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MAXLEN">MAXLEN — Keep at most N entries</SelectItem>
                <SelectItem value="MINID">MINID — Remove entries with ID below threshold</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {strategy === "MAXLEN" ? "Max length" : "Min ID"}
            </Label>
            <Input
              className="h-8 font-mono text-xs"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={strategy === "MAXLEN" ? "1000" : "1234567890-0"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!threshold.trim()}
            onClick={() => onConfirm(strategy, threshold.trim())}
          >
            Trim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClaimDialog({
  entry,
  onClose,
  onConfirm,
}: {
  entry: RedisXPendingEntry;
  onClose: () => void;
  onConfirm: (consumer: string) => void;
}) {
  const [consumer, setConsumer] = useState("");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Claim Entry</DialogTitle>
          <DialogDescription>
            Transfer entry <span className="font-mono">{entry.id}</span> from{" "}
            <span className="font-mono">{entry.consumer}</span> to a new consumer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">Target Consumer Name</Label>
          <Input
            className="h-8 font-mono text-xs"
            value={consumer}
            onChange={(e) => setConsumer(e.target.value)}
            placeholder="new-consumer"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!consumer.trim()}
            onClick={() => onConfirm(consumer.trim())}
          >
            Claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

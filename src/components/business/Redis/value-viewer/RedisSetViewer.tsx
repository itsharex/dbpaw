import { useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  MoveRight,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
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
import type { RedisSetOperation } from "@/services/api";

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  onSismember?: (member: string) => Promise<boolean>;
  onSetOperation?: (
    keys: string[],
    op: RedisSetOperation,
  ) => Promise<string[]>;
  onSmove?: (destination: string, member: string) => Promise<boolean>;
}

export function RedisSetViewer({
  value,
  onChange,
  onSismember,
  onSetOperation,
  onSmove,
}: Props) {
  const [filter, setFilter] = useState("");
  const [showNewRow, setShowNewRow] = useState(false);
  const [newMember, setNewMember] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  // Operations panel state
  const [showOpsPanel, setShowOpsPanel] = useState(false);

  // SISMEMBER state
  const [sismemberInput, setSismemberInput] = useState("");
  const [sismemberResult, setSismemberResult] = useState<boolean | null>(null);
  const [isCheckingMember, setIsCheckingMember] = useState(false);

  // Set algebra state
  const [setOpType, setSetOpType] = useState<RedisSetOperation>("inter");
  const [setOpKeys, setSetOpKeys] = useState("");
  const [setOpResults, setSetOpResults] = useState<string[] | null>(null);
  const [isRunningOp, setIsRunningOp] = useState(false);

  // SMOVE dialog state
  const [smoveMember, setSmoveMember] = useState<string | null>(null);
  const [smoveDest, setSmoveDest] = useState("");
  const [isSmoveing, setIsSmoveing] = useState(false);

  const filtered = filter.trim()
    ? value.filter((m) => m.includes(filter.trim()))
    : value;

  const hasOpsCapability = onSismember || onSetOperation || onSmove;

  const handleSismember = async () => {
    if (!onSismember || !sismemberInput.trim()) return;
    setIsCheckingMember(true);
    try {
      const exists = await onSismember(sismemberInput.trim());
      setSismemberResult(exists);
    } catch {
      setSismemberResult(null);
    } finally {
      setIsCheckingMember(false);
    }
  };

  const handleSetOp = async () => {
    if (!onSetOperation || !setOpKeys.trim()) return;
    const keys = setOpKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length === 0) return;
    setIsRunningOp(true);
    try {
      const results = await onSetOperation(keys, setOpType);
      setSetOpResults(results);
    } catch {
      setSetOpResults(null);
    } finally {
      setIsRunningOp(false);
    }
  };

  const handleSmove = async () => {
    if (!onSmove || !smoveMember || !smoveDest.trim()) return;
    setIsSmoveing(true);
    try {
      const moved = await onSmove(smoveDest.trim(), smoveMember);
      if (moved) {
        onChange(value.filter((m) => m !== smoveMember));
      }
      setSmoveMember(null);
      setSmoveDest("");
    } catch {
      // Error handled by caller
    } finally {
      setIsSmoveing(false);
    }
  };

  const commitAdd = () => {
    const m = newMember.trim();
    if (!m) return;
    if (value.includes(m)) {
      setDuplicateWarning(true);
      return;
    }
    onChange([...value, m]);
    setNewMember("");
    setShowNewRow(false);
    setDuplicateWarning(false);
  };

  const cancelAdd = () => {
    setShowNewRow(false);
    setNewMember("");
    setDuplicateWarning(false);
  };

  const deleteMember = (member: string) => {
    onChange(value.filter((m) => m !== member));
  };

  const copyResults = () => {
    if (setOpResults) {
      void navigator.clipboard.writeText(setOpResults.join("\n"));
    }
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground shrink-0">
          {value.length} members
        </span>
        <div className="flex items-center gap-1.5 flex-1 max-w-xs">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              className="h-7 pl-6 text-xs"
              placeholder="Filter members…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {hasOpsCapability && (
            <Button
              variant={showOpsPanel ? "secondary" : "outline"}
              size="sm"
              className="h-7"
              onClick={() => setShowOpsPanel((v) => !v)}
            >
              <SlidersHorizontal className="w-3 h-3 mr-1" />
              Operations
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setShowNewRow(true)}
            disabled={showNewRow}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add member
          </Button>
        </div>
      </div>

      {/* Operations Panel */}
      {showOpsPanel && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          {/* SISMEMBER */}
          {onSismember && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                SISMEMBER
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-48"
                  value={sismemberInput}
                  onChange={(e) => {
                    setSismemberInput(e.target.value);
                    setSismemberResult(null);
                  }}
                  placeholder="member value"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSismember();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleSismember()}
                  disabled={isCheckingMember || !sismemberInput.trim()}
                >
                  {isCheckingMember ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Check
                </Button>
              </div>
              {sismemberResult !== null && (
                <div className="text-xs">
                  {sismemberResult ? (
                    <span className="text-green-600 dark:text-green-400">
                      ✓ Member exists in this set
                    </span>
                  ) : (
                    <span className="text-red-500 dark:text-red-400">
                      ✗ Member does not exist
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Set Algebra */}
          {onSetOperation && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Set Algebra
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={setOpType}
                  onValueChange={(v) => setSetOpType(v as RedisSetOperation)}
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inter">SINTER</SelectItem>
                    <SelectItem value="union">SUNION</SelectItem>
                    <SelectItem value="diff">SDIFF</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  className="h-7 font-mono text-xs flex-1"
                  value={setOpKeys}
                  onChange={(e) => {
                    setSetOpKeys(e.target.value);
                    setSetOpResults(null);
                  }}
                  placeholder="other key1, key2, ..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSetOp();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleSetOp()}
                  disabled={isRunningOp || !setOpKeys.trim()}
                >
                  {isRunningOp ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Execute
                </Button>
              </div>
              {setOpResults !== null && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {setOpResults.length} members
                    </Badge>
                    {setOpResults.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-xs"
                        onClick={copyResults}
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Copy
                      </Button>
                    )}
                  </div>
                  {setOpResults.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {setOpResults.map((m) => (
                        <Badge
                          key={m}
                          variant="outline"
                          className="font-mono text-xs"
                        >
                          {m}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {setOpResults.length === 0 && (
                    <div className="text-xs text-muted-foreground">
                      (empty result)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Data table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Member</TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {showNewRow && (
              <TableRow className="bg-muted/20">
                <TableCell className="py-1.5">
                  <div className="space-y-1">
                    <Input
                      className="h-7 font-mono text-xs"
                      value={newMember}
                      onChange={(e) => {
                        setNewMember(e.target.value);
                        setDuplicateWarning(false);
                      }}
                      placeholder="member value"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitAdd();
                        if (e.key === "Escape") cancelAdd();
                      }}
                    />
                    {duplicateWarning && (
                      <p className="text-xs text-destructive">
                        Member already exists in this set
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={commitAdd}
                    >
                      <Check className="w-3 h-3 text-green-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={cancelAdd}
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {filtered.length === 0 && !showNewRow && (
              <TableRow>
                <TableCell
                  colSpan={2}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  {filter ? "No members match filter" : "Empty set"}
                </TableCell>
              </TableRow>
            )}

            {filtered.map((member) => (
              <TableRow key={member} className="group">
                <TableCell
                  className="font-mono text-xs py-1.5 truncate max-w-0"
                  title={member}
                >
                  {member}
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-0.5">
                    {onSmove && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          setSmoveMember(member);
                          setSmoveDest("");
                        }}
                        title="Move to another set"
                      >
                        <MoveRight className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deleteMember(member)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* SMOVE Dialog */}
      <Dialog
        open={smoveMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSmoveMember(null);
            setSmoveDest("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move member to another set</DialogTitle>
            <DialogDescription>
              Move{" "}
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                {smoveMember}
              </code>{" "}
              to a destination set using SMOVE.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">Destination key</Label>
            <Input
              value={smoveDest}
              onChange={(e) => setSmoveDest(e.target.value)}
              placeholder="destination set key"
              className="font-mono text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSmove();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSmoveMember(null);
                setSmoveDest("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSmove()}
              disabled={isSmoveing || !smoveDest.trim()}
            >
              {isSmoveing && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Plus,
  Scissors,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
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
import type { RedisLInsertPosition, RedisLMoveDirection } from "@/services/api";

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  onLindex?: (index: number) => Promise<string | null>;
  onLpos?: (
    element: string,
    rank?: number,
    count?: number,
    maxlen?: number,
  ) => Promise<number[]>;
  onLtrim?: (start: number, stop: number) => Promise<void>;
  onLinsert?: (
    position: RedisLInsertPosition,
    pivot: string,
    element: string,
  ) => Promise<number>;
  onLmove?: (
    destination: string,
    srcDirection: RedisLMoveDirection,
    dstDirection: RedisLMoveDirection,
  ) => Promise<string | null>;
}

type AddMode = "append" | "prepend" | null;

export function RedisListViewer({
  value,
  onChange,
  onLindex,
  onLpos,
  onLtrim,
  onLinsert,
  onLmove,
}: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [addValue, setAddValue] = useState("");

  // Query panel state
  const [showQueryPanel, setShowQueryPanel] = useState(false);

  // LINDEX
  const [lindexInput, setLindexInput] = useState("");
  const [lindexResult, setLindexResult] = useState<string | null | undefined>(
    undefined,
  );
  const [isLindexing, setIsLindexing] = useState(false);

  // LPOS
  const [lposElement, setLposElement] = useState("");
  const [lposResult, setLposResult] = useState<number[] | null>(null);
  const [isLposing, setIsLposing] = useState(false);

  // LTRIM dialog
  const [trimDialog, setTrimDialog] = useState(false);
  const [trimStart, setTrimStart] = useState("0");
  const [trimStop, setTrimStop] = useState("-1");
  const [isTrimming, setIsTrimming] = useState(false);

  // LINSERT dialog
  const [insertDialog, setInsertDialog] = useState(false);
  const [insertPosition, setInsertPosition] =
    useState<RedisLInsertPosition>("after");
  const [insertPivot, setInsertPivot] = useState("");
  const [insertElement, setInsertElement] = useState("");
  const [isInserting, setIsInserting] = useState(false);

  // LMOVE dialog
  const [moveDialog, setMoveDialog] = useState(false);
  const [moveDest, setMoveDest] = useState("");
  const [moveSrcDir, setMoveSrcDir] = useState<RedisLMoveDirection>("right");
  const [moveDstDir, setMoveDstDir] = useState<RedisLMoveDirection>("left");
  const [isMoving, setIsMoving] = useState(false);

  const commitEdit = (index: number) => {
    const next = [...value];
    next[index] = editingValue;
    onChange(next);
    setEditingIndex(null);
  };

  const cancelEdit = () => setEditingIndex(null);

  const deleteItem = (index: number) => {
    const next = value.filter((_, i) => i !== index);
    onChange(next);
    if (editingIndex === index) setEditingIndex(null);
  };

  const commitAdd = () => {
    if (!addMode) return;
    if (addMode === "append") {
      onChange([...value, addValue]);
    } else {
      onChange([addValue, ...value]);
    }
    setAddValue("");
    setAddMode(null);
  };

  const cancelAdd = () => {
    setAddMode(null);
    setAddValue("");
  };

  // ── Query handlers ──────────────────────────────────────────────────────

  const handleLindex = async () => {
    if (!onLindex || lindexInput.trim() === "") return;
    const idx = parseInt(lindexInput.trim(), 10);
    if (isNaN(idx)) return;
    setIsLindexing(true);
    try {
      const result = await onLindex(idx);
      setLindexResult(result);
    } catch {
      setLindexResult(undefined);
    } finally {
      setIsLindexing(false);
    }
  };

  const handleLpos = async () => {
    if (!onLpos || !lposElement.trim()) return;
    setIsLposing(true);
    try {
      const positions = await onLpos(lposElement.trim(), undefined, 0);
      setLposResult(positions);
    } catch {
      setLposResult(null);
    } finally {
      setIsLposing(false);
    }
  };

  // ── Modify handlers ─────────────────────────────────────────────────────

  const handleLtrim = async () => {
    if (!onLtrim) return;
    const s = parseInt(trimStart.trim(), 10);
    const e = parseInt(trimStop.trim(), 10);
    if (isNaN(s) || isNaN(e)) return;
    setIsTrimming(true);
    try {
      await onLtrim(s, e);
      setTrimDialog(false);
    } finally {
      setIsTrimming(false);
    }
  };

  const handleLinsert = async () => {
    if (!onLinsert || !insertPivot.trim()) return;
    setIsInserting(true);
    try {
      await onLinsert(insertPosition, insertPivot.trim(), insertElement);
      setInsertDialog(false);
      setInsertPivot("");
      setInsertElement("");
    } finally {
      setIsInserting(false);
    }
  };

  const handleLmove = async () => {
    if (!onLmove || !moveDest.trim()) return;
    setIsMoving(true);
    try {
      await onLmove(moveDest.trim(), moveSrcDir, moveDstDir);
      setMoveDialog(false);
      setMoveDest("");
    } finally {
      setIsMoving(false);
    }
  };

  const hasOperations = onLtrim || onLinsert || onLmove;

  return (
    <div className="space-y-2">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {value.length} items
        </span>
        <div className="flex gap-1.5">
          {(onLindex || onLpos) && (
            <Button
              variant={showQueryPanel ? "secondary" : "outline"}
              size="sm"
              className="h-7"
              onClick={() => setShowQueryPanel((v) => !v)}
            >
              <SlidersHorizontal className="w-3 h-3 mr-1" />
              Query
            </Button>
          )}
          {onLinsert && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setInsertDialog(true)}
            >
              <Plus className="w-3 h-3 mr-1" />
              Insert
            </Button>
          )}
          {onLtrim && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-destructive hover:text-destructive"
              onClick={() => {
                setTrimStart("0");
                setTrimStop("-1");
                setTrimDialog(true);
              }}
            >
              <Scissors className="w-3 h-3 mr-1" />
              Trim
            </Button>
          )}
          {onLmove && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setMoveDialog(true)}
            >
              <Copy className="w-3 h-3 mr-1" />
              Move
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setAddMode("prepend")}
            disabled={addMode !== null}
          >
            <Plus className="w-3 h-3 mr-1" />
            Prepend
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setAddMode("append")}
            disabled={addMode !== null}
          >
            <Plus className="w-3 h-3 mr-1" />
            Append
          </Button>
        </div>
      </div>

      {/* ── Query Panel ──────────────────────────────────────────────────── */}
      {showQueryPanel && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          {/* LINDEX */}
          {onLindex && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                LINDEX
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-28"
                  placeholder="index"
                  value={lindexInput}
                  onChange={(e) => setLindexInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleLindex();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleLindex()}
                  disabled={isLindexing}
                >
                  {isLindexing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Search className="w-3 h-3 mr-1" />
                  )}
                  Get
                </Button>
                {lindexResult !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-muted-foreground"
                    onClick={() => setLindexResult(undefined)}
                  >
                    <X className="w-3 h-3 mr-1" /> Clear
                  </Button>
                )}
              </div>
              {lindexResult !== undefined && (
                <div className="text-xs">
                  <Badge variant="secondary" className="text-xs mr-1.5">
                    LINDEX {lindexInput.trim()}
                  </Badge>
                  {lindexResult !== null ? (
                    <span className="font-mono text-foreground">
                      {lindexResult}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">
                      (nil)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* LPOS */}
          {onLpos && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                LPOS
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-48"
                  placeholder="element value"
                  value={lposElement}
                  onChange={(e) => setLposElement(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleLpos();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleLpos()}
                  disabled={isLposing}
                >
                  {isLposing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Search className="w-3 h-3 mr-1" />
                  )}
                  Find
                </Button>
                {lposResult !== null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-muted-foreground"
                    onClick={() => setLposResult(null)}
                  >
                    <X className="w-3 h-3 mr-1" /> Clear
                  </Button>
                )}
              </div>
              {lposResult !== null && (
                <div className="text-xs">
                  <Badge variant="secondary" className="text-xs mr-1.5">
                    LPOS
                  </Badge>
                  {lposResult.length > 0 ? (
                    <span className="font-mono text-foreground">
                      [{lposResult.join(", ")}]
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">
                      (nil)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Data Table ───────────────────────────────────────────────────── */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px] text-xs">#</TableHead>
              <TableHead className="text-xs">Value</TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {addMode === "prepend" && (
              <TableRow className="bg-muted/20">
                <TableCell className="py-1.5 text-xs text-muted-foreground">
                  0
                </TableCell>
                <TableCell className="py-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    placeholder="new item"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                  />
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

            {value.length === 0 && addMode === null && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  {hasOperations
                    ? "Empty list — use Query or Insert/Trim/Move operations above"
                    : "Empty list"}
                </TableCell>
              </TableRow>
            )}

            {value.map((item, index) => (
              <TableRow key={index} className="group">
                <TableCell className="text-xs text-muted-foreground py-1.5">
                  {index}
                </TableCell>
                <TableCell className="py-1.5">
                  {editingIndex === index ? (
                    <Input
                      className="h-7 font-mono text-xs"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(index);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                  ) : (
                    <span
                      className="font-mono text-xs cursor-pointer hover:text-foreground/70 block truncate"
                      title={item}
                      onClick={() => {
                        setEditingIndex(index);
                        setEditingValue(item);
                      }}
                    >
                      {item || (
                        <span className="text-muted-foreground italic">
                          empty
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  {editingIndex === index ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => commitEdit(index)}
                      >
                        <Check className="w-3 h-3 text-green-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={cancelEdit}
                      >
                        <X className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deleteItem(index)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {addMode === "append" && (
              <TableRow className="bg-muted/20">
                <TableCell className="py-1.5 text-xs text-muted-foreground">
                  {value.length}
                </TableCell>
                <TableCell className="py-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={addValue}
                    onChange={(e) => setAddValue(e.target.value)}
                    placeholder="new item"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                  />
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
          </TableBody>
        </Table>
      </div>

      {/* ── LTRIM AlertDialog ────────────────────────────────────────────── */}
      <AlertDialog
        open={trimDialog}
        onOpenChange={(open) => {
          if (!open) setTrimDialog(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>LTRIM</AlertDialogTitle>
            <AlertDialogDescription>
              Trim the list to only include elements within the specified
              range. Elements outside the range will be removed. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Start</Label>
              <Input
                className="h-7 font-mono text-xs"
                value={trimStart}
                onChange={(e) => setTrimStart(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stop</Label>
              <Input
                className="h-7 font-mono text-xs"
                value={trimStop}
                onChange={(e) => setTrimStop(e.target.value)}
                placeholder="-1"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTrimming}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleLtrim()}
              disabled={isTrimming}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isTrimming && (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              )}
              Trim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── LINSERT Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={insertDialog}
        onOpenChange={(open) => {
          if (!open) setInsertDialog(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>LINSERT</DialogTitle>
            <DialogDescription>
              Insert an element before or after a pivot element in the list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Position</Label>
              <Select
                value={insertPosition}
                onValueChange={(v) =>
                  setInsertPosition(v as RedisLInsertPosition)
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">BEFORE</SelectItem>
                  <SelectItem value="after">AFTER</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Pivot element</Label>
              <Input
                className="h-7 font-mono text-xs"
                value={insertPivot}
                onChange={(e) => setInsertPivot(e.target.value)}
                placeholder="existing element value"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">New element</Label>
              <Input
                className="h-7 font-mono text-xs"
                value={insertElement}
                onChange={(e) => setInsertElement(e.target.value)}
                placeholder="value to insert"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInsertDialog(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isInserting || !insertPivot.trim()}
              onClick={() => void handleLinsert()}
            >
              {isInserting && (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              )}
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── LMOVE Dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={moveDialog}
        onOpenChange={(open) => {
          if (!open) setMoveDialog(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>LMOVE</DialogTitle>
            <DialogDescription>
              Atomically move an element from one end of this list to another
              list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Destination key</Label>
              <Input
                className="h-7 font-mono text-xs"
                value={moveDest}
                onChange={(e) => setMoveDest(e.target.value)}
                placeholder="destination list key"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Source direction</Label>
                <Select
                  value={moveSrcDir}
                  onValueChange={(v) =>
                    setMoveSrcDir(v as RedisLMoveDirection)
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">LEFT</SelectItem>
                    <SelectItem value="right">RIGHT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Destination direction</Label>
                <Select
                  value={moveDstDir}
                  onValueChange={(v) =>
                    setMoveDstDir(v as RedisLMoveDirection)
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">LEFT</SelectItem>
                    <SelectItem value="right">RIGHT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoveDialog(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isMoving || !moveDest.trim()}
              onClick={() => void handleLmove()}
            >
              {isMoving && (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              )}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

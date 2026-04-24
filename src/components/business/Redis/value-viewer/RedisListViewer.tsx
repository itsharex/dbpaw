import { useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
}

type AddMode = "append" | "prepend" | null;

export function RedisListViewer({ value, onChange }: Props) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [addValue, setAddValue] = useState("");

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {value.length} items
        </span>
        <div className="flex gap-1.5">
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
                  Empty list
                </TableCell>
              </TableRow>
            )}

            {value.map((item, index) => (
              <TableRow key={index} className="group">
                <TableCell className="text-xs text-muted-foreground py-1.5">
                  {index + 1}
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
                  {value.length + 1}
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
    </div>
  );
}

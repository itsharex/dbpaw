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
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}

export function RedisHashViewer({ value, onChange }: Props) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [showNewRow, setShowNewRow] = useState(false);
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");

  const entries = Object.entries(value);

  const commitEdit = (field: string) => {
    onChange({ ...value, [field]: editingValue });
    setEditingField(null);
  };

  const cancelEdit = () => setEditingField(null);

  const startEdit = (field: string, val: string) => {
    setEditingField(field);
    setEditingValue(val);
  };

  const deleteField = (field: string) => {
    const next = { ...value };
    delete next[field];
    onChange(next);
    if (editingField === field) setEditingField(null);
  };

  const commitNewRow = () => {
    const f = newField.trim();
    if (!f) return;
    onChange({ ...value, [f]: newValue });
    setNewField("");
    setNewValue("");
    setShowNewRow(false);
  };

  const cancelNewRow = () => {
    setShowNewRow(false);
    setNewField("");
    setNewValue("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {entries.length} fields
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => setShowNewRow(true)}
          disabled={showNewRow}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add field
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[35%] text-xs">Field</TableHead>
              <TableHead className="text-xs">Value</TableHead>
              <TableHead className="w-[72px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {showNewRow && (
              <TableRow className="bg-muted/20">
                <TableCell className="py-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={newField}
                    onChange={(e) => setNewField(e.target.value)}
                    placeholder="field name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNewRow();
                      if (e.key === "Escape") cancelNewRow();
                    }}
                  />
                </TableCell>
                <TableCell className="py-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="value"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNewRow();
                      if (e.key === "Escape") cancelNewRow();
                    }}
                  />
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={commitNewRow}
                    >
                      <Check className="w-3 h-3 text-green-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={cancelNewRow}
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {entries.length === 0 && !showNewRow && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  No fields
                </TableCell>
              </TableRow>
            )}

            {entries.map(([field, val]) => (
              <TableRow key={field} className="group">
                <TableCell className="font-mono text-xs text-muted-foreground py-1.5 truncate max-w-0">
                  <span title={field}>{field}</span>
                </TableCell>
                <TableCell className="py-1.5">
                  {editingField === field ? (
                    <Input
                      className="h-7 font-mono text-xs"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(field);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                  ) : (
                    <span
                      className="font-mono text-xs cursor-pointer hover:text-foreground/70 block truncate"
                      title={val}
                      onClick={() => startEdit(field, val)}
                    >
                      {val || (
                        <span className="text-muted-foreground italic">
                          empty
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  {editingField === field ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => commitEdit(field)}
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
                      onClick={() => deleteField(field)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

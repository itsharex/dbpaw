import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
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
  value: { id: string; fields: Record<string, string> }[];
  onChange: (v: { id: string; fields: Record<string, string> }[]) => void;
}

export function RedisStreamViewer({ value, onChange }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showNewRow, setShowNewRow] = useState(false);
  const [newId, setNewId] = useState("*");
  const [newFieldsRaw, setNewFieldsRaw] = useState("");

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const formatFields = (fields: Record<string, string>) => {
    const keys = Object.keys(fields);
    if (keys.length === 0) return "{}";
    if (keys.length <= 3) {
      return "{ " + keys.map((k) => `${k}: ${fields[k]}`).join(", ") + " }";
    }
    return `{ ${keys[0]}: ${fields[keys[0]]}, ${keys[1]}: ${fields[keys[1]]}, ... +${keys.length - 2} }`;
  };

  const parseFieldsRaw = (raw: string): Record<string, string> | null => {
    const result: Record<string, string> = {};
    const lines = raw.split(/\n|,/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return null;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!k) return null;
      result[k] = v;
    }
    return result;
  };

  const deleteEntry = (id: string) => {
    onChange(value.filter((e) => e.id !== id));
  };

  const commitNewRow = () => {
    const fields = parseFieldsRaw(newFieldsRaw);
    if (!fields) {
      return;
    }
    const id = newId.trim() || "*";
    onChange([{ id, fields }, ...value]);
    setNewId("*");
    setNewFieldsRaw("");
    setShowNewRow(false);
  };

  const cancelNewRow = () => {
    setShowNewRow(false);
    setNewId("*");
    setNewFieldsRaw("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {value.length} entries
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => setShowNewRow(true)}
          disabled={showNewRow}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add entry
        </Button>
      </div>

      {showNewRow && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="flex gap-2">
            <Input
              className="h-7 font-mono text-xs w-40"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="ID (* = auto)"
            />
          </div>
          <textarea
            className="w-full h-20 rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y"
            value={newFieldsRaw}
            onChange={(e) => setNewFieldsRaw(e.target.value)}
            placeholder="field1=value1&#10;field2=value2"
          />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="h-7" onClick={commitNewRow}>
              <Check className="w-3 h-3 mr-1 text-green-500" />
              Add
            </Button>
            <Button variant="ghost" size="sm" className="h-7" onClick={cancelNewRow}>
              <X className="w-3 h-3 mr-1 text-muted-foreground" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]" />
              <TableHead className="text-xs">Entry ID</TableHead>
              <TableHead className="text-xs">Fields</TableHead>
              <TableHead className="w-[72px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {value.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  No entries
                </TableCell>
              </TableRow>
            )}
            {value.map((entry) => (
              <>
                <TableRow key={entry.id} className="group">
                  <TableCell className="py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => toggleExpand(entry.id)}
                    >
                      {expandedIds.has(entry.id) ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground py-1.5 truncate max-w-0">
                    <span title={entry.id}>{entry.id}</span>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <span
                      className="font-mono text-xs cursor-pointer hover:text-foreground/70 block truncate"
                      title={formatFields(entry.fields)}
                      onClick={() => toggleExpand(entry.id)}
                    >
                      {formatFields(entry.fields)}
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deleteEntry(entry.id)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
                {expandedIds.has(entry.id) && (
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={4} className="py-2">
                      <div className="px-2 space-y-1">
                        {Object.entries(entry.fields).map(([k, v]) => (
                          <div key={k} className="flex gap-2 text-xs">
                            <span className="font-mono text-muted-foreground min-w-[80px]">
                              {k}
                            </span>
                            <span className="font-mono">{v}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

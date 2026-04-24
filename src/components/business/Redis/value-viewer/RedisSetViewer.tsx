import { useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
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

export function RedisSetViewer({ value, onChange }: Props) {
  const [filter, setFilter] = useState("");
  const [showNewRow, setShowNewRow] = useState(false);
  const [newMember, setNewMember] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  const filtered = filter.trim()
    ? value.filter((m) => m.includes(filter.trim()))
    : value;

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

  return (
    <div className="space-y-2">
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
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0"
          onClick={() => setShowNewRow(true)}
          disabled={showNewRow}
        >
          <Plus className="w-3 h-3 mr-1" />
          Add member
        </Button>
      </div>

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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteMember(member)}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

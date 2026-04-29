import { useState } from "react";
import { ArrowUpDown, Check, Info, Minus, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { RedisKeyExtra } from "@/services/api";
import { parseRedisZSetScore } from "../redis-utils";

interface ZSetMember {
  member: string;
  score: number;
}

interface Props {
  value: ZSetMember[];
  onChange: (v: ZSetMember[]) => void;
  extra?: RedisKeyExtra | null;
  onZsetIncrBy?: (member: string, amount: number) => void;
}

export function RedisZSetViewer({ value, onChange, extra, onZsetIncrBy }: Props) {
  const [sortAsc, setSortAsc] = useState(true);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editingScore, setEditingScore] = useState("");
  const [showNewRow, setShowNewRow] = useState(false);
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState("");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const isGeo = extra?.subtype === "geo";

  const sorted = [...value].sort((a, b) =>
    sortAsc ? a.score - b.score : b.score - a.score,
  );

  const commitEdit = (member: string) => {
    let score: number;
    try {
      score = parseRedisZSetScore(editingScore);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
      return;
    }
    onChange(value.map((m) => (m.member === member ? { member, score } : m)));
    setEditingMember(null);
    setScoreError(null);
  };

  const cancelEdit = () => {
    setEditingMember(null);
    setScoreError(null);
  };

  const deleteMember = (member: string) => {
    onChange(value.filter((m) => m.member !== member));
    if (editingMember === member) setEditingMember(null);
  };

  const commitAdd = () => {
    const m = newMember.trim();
    if (!m) return;
    let score: number;
    try {
      score = parseRedisZSetScore(newScore);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
      return;
    }
    const existing = value.findIndex((item) => item.member === m);
    if (existing >= 0) {
      const next = [...value];
      next[existing] = { member: m, score };
      onChange(next);
    } else {
      onChange([...value, { member: m, score }]);
    }
    setNewMember("");
    setNewScore("");
    setShowNewRow(false);
    setScoreError(null);
  };

  const cancelAdd = () => {
    setShowNewRow(false);
    setNewMember("");
    setNewScore("");
    setScoreError(null);
  };

  return (
    <div className="space-y-2">
      {isGeo && (
        <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900 rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>
            Geo spatial index detected. Scores are geohash values.
            Use Console for GEOPOS / GEODIST / GEORADIUS operations.
          </span>
          <Badge variant="outline" className="text-xs text-teal-600 border-teal-200 ml-auto">
            Geo
          </Badge>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {value.length} members
        </span>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => setSortAsc((a) => !a)}
          >
            <ArrowUpDown className="w-3 h-3 mr-1" />
            Score {sortAsc ? "↑" : "↓"}
          </Button>
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Member</TableHead>
              <TableHead className="w-[140px] text-xs">Score</TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {showNewRow && (
              <TableRow className="bg-muted/20">
                <TableCell className="py-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={newMember}
                    onChange={(e) => setNewMember(e.target.value)}
                    placeholder="member"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                  />
                </TableCell>
                <TableCell className="py-1.5">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={newScore}
                    onChange={(e) => {
                      setNewScore(e.target.value);
                      setScoreError(null);
                    }}
                    placeholder="0"
                    inputMode="decimal"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAdd();
                      if (e.key === "Escape") cancelAdd();
                    }}
                  />
                  {scoreError && (
                    <p className="mt-1 text-xs text-destructive">
                      {scoreError}
                    </p>
                  )}
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

            {sorted.length === 0 && !showNewRow && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  Empty sorted set
                </TableCell>
              </TableRow>
            )}

            {sorted.map(({ member, score }) => (
              <TableRow key={member} className="group">
                <TableCell
                  className="font-mono text-xs py-1.5 truncate max-w-0"
                  title={member}
                >
                  {member}
                </TableCell>
                <TableCell className="py-1.5">
                  {editingMember === member ? (
                    <Input
                      className="h-7 font-mono text-xs"
                      value={editingScore}
                      onChange={(e) => {
                        setEditingScore(e.target.value);
                        setScoreError(null);
                      }}
                      inputMode="decimal"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(member);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                  ) : (
                    <span
                      className="font-mono text-xs cursor-pointer hover:text-foreground/70"
                      onClick={() => {
                        setEditingMember(member);
                        setEditingScore(String(score));
                        setScoreError(null);
                      }}
                    >
                      {score}
                    </span>
                  )}
                  {editingMember === member && scoreError && (
                    <p className="mt-1 text-xs text-destructive">
                      {scoreError}
                    </p>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  {editingMember === member ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => commitEdit(member)}
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
                    <div className="flex items-center gap-0.5">
                      {onZsetIncrBy && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onZsetIncrBy(member, -1)}
                            title="Decrease score by 1"
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onZsetIncrBy(member, 1)}
                            title="Increase score by 1"
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </>
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

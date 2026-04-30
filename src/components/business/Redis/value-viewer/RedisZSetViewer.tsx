import { useState } from "react";
import {
  ArrowUpDown,
  Check,
  Info,
  Loader2,
  Minus,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
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
import type {
  RedisKeyExtra,
  RedisZRangeByLexResult,
  RedisZRangeByScoreResult,
} from "@/services/api";
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
  onZRangeByScore?: (
    min: string,
    max: string,
  ) => Promise<RedisZRangeByScoreResult>;
  onZRank?: (member: string, reverse: boolean) => Promise<number | null>;
  onZScore?: (member: string) => Promise<number | null>;
  onZMScore?: (members: string[]) => Promise<(number | null)[]>;
  onZRangeByLex?: (
    min: string,
    max: string,
  ) => Promise<RedisZRangeByLexResult>;
  onZPopMin?: (count?: number) => Promise<void>;
  onZPopMax?: (count?: number) => Promise<void>;
}

export function RedisZSetViewer({
  value,
  onChange,
  extra,
  onZsetIncrBy,
  onZRangeByScore,
  onZRank,
  onZScore,
  onZMScore,
  onZRangeByLex,
  onZPopMin,
  onZPopMax,
}: Props) {
  const [sortAsc, setSortAsc] = useState(true);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editingScore, setEditingScore] = useState("");
  const [showNewRow, setShowNewRow] = useState(false);
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState("");
  const [scoreError, setScoreError] = useState<string | null>(null);
  const isGeo = extra?.subtype === "geo";

  // Query panel state
  const [showQueryPanel, setShowQueryPanel] = useState(false);
  const [filterMin, setFilterMin] = useState("-inf");
  const [filterMax, setFilterMax] = useState("+inf");
  const [filterActive, setFilterActive] = useState(false);
  const [filteredMembers, setFilteredMembers] = useState<ZSetMember[] | null>(
    null,
  );
  const [filterTotal, setFilterTotal] = useState<number | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);

  // Rank lookup state
  const [rankMember, setRankMember] = useState("");
  const [rankResult, setRankResult] = useState<{
    rank: number;
    reverse: boolean;
  } | null>(null);
  const [isRanking, setIsRanking] = useState(false);

  // Score lookup state (ZSCORE / ZMSCORE)
  const [scoreMember, setScoreMember] = useState("");
  const [scoreResult, setScoreResult] = useState<{
    value: (number | null)[];
    members: string[];
  } | null>(null);
  const [isScoring, setIsScoring] = useState(false);

  // Lex range state (ZRANGEBYLEX)
  const [lexMin, setLexMin] = useState("-");
  const [lexMax, setLexMax] = useState("+");
  const [lexActive, setLexActive] = useState(false);
  const [lexMembers, setLexMembers] = useState<string[] | null>(null);
  const [lexTotal, setLexTotal] = useState<number | null>(null);
  const [isLexing, setIsLexing] = useState(false);

  // Pop confirmation state (ZPOPMIN / ZPOPMAX)
  const [popDialog, setPopDialog] = useState<{
    type: "min" | "max";
  } | null>(null);
  const [isPopping, setIsPopping] = useState(false);

  const displayMembers = filterActive && filteredMembers
    ? filteredMembers
    : [...value].sort((a, b) =>
        sortAsc ? a.score - b.score : b.score - a.score,
      );

  const handleFilter = async () => {
    if (!onZRangeByScore) return;
    setIsFiltering(true);
    try {
      const result = await onZRangeByScore(filterMin, filterMax);
      setFilteredMembers(result.members);
      setFilterTotal(result.total);
      setFilterActive(true);
    } catch {
      // Error handled by caller
    } finally {
      setIsFiltering(false);
    }
  };

  const clearFilter = () => {
    setFilterActive(false);
    setFilteredMembers(null);
    setFilterTotal(null);
  };

  const handleRankLookup = async (reverse: boolean) => {
    if (!onZRank || !rankMember.trim()) return;
    setIsRanking(true);
    try {
      const rank = await onZRank(rankMember.trim(), reverse);
      setRankResult(rank !== null ? { rank, reverse } : null);
    } catch {
      setRankResult(null);
    } finally {
      setIsRanking(false);
    }
  };

  const handleScoreLookup = async (multi: boolean) => {
    const raw = scoreMember.trim();
    if (!raw) return;
    const members = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (members.length === 0) return;
    setIsScoring(true);
    try {
      if (multi && onZMScore) {
        const scores = await onZMScore(members);
        setScoreResult({ value: scores, members });
      } else if (onZScore) {
        const score = await onZScore(members[0]);
        setScoreResult({
          value: [score],
          members: [members[0]],
        });
      }
    } catch {
      setScoreResult(null);
    } finally {
      setIsScoring(false);
    }
  };

  const handleLexRange = async () => {
    if (!onZRangeByLex) return;
    setIsLexing(true);
    try {
      const result = await onZRangeByLex(lexMin, lexMax);
      setLexMembers(result.members);
      setLexTotal(result.total);
      setLexActive(true);
    } catch {
      setLexMembers(null);
    } finally {
      setIsLexing(false);
    }
  };

  const clearLex = () => {
    setLexActive(false);
    setLexMembers(null);
    setLexTotal(null);
  };

  const handlePop = async () => {
    if (!popDialog) return;
    setIsPopping(true);
    try {
      if (popDialog.type === "min" && onZPopMin) {
        await onZPopMin();
      } else if (popDialog.type === "max" && onZPopMax) {
        await onZPopMax();
      }
    } finally {
      setIsPopping(false);
      setPopDialog(null);
    }
  };

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

  const hasQueryCapability = onZRangeByScore || onZRank || onZScore || onZMScore || onZRangeByLex;
  const hasPopCapability = onZPopMin || onZPopMax;

  return (
    <div className="space-y-2">
      {isGeo && (
        <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900 rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>
            Geo spatial index detected. Scores are geohash values. Use Console
            for GEOPOS / GEODIST / GEORADIUS operations.
          </span>
          <Badge
            variant="outline"
            className="text-xs text-teal-600 border-teal-200 ml-auto"
          >
            Geo
          </Badge>
        </div>
      )}

      {/* Toolbar */}
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
          {hasQueryCapability && (
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
          {hasPopCapability && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-destructive hover:text-destructive"
                onClick={() => setPopDialog({ type: "min" })}
                disabled={value.length === 0}
                title="Pop member with lowest score"
              >
                <ArrowDownToLine className="w-3 h-3 mr-1" />
                Pop Min
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-destructive hover:text-destructive"
                onClick={() => setPopDialog({ type: "max" })}
                disabled={value.length === 0}
                title="Pop member with highest score"
              >
                <ArrowUpFromLine className="w-3 h-3 mr-1" />
                Pop Max
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Query Panel */}
      {showQueryPanel && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          {/* Score Range Filter */}
          {onZRangeByScore && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Score Range
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-28"
                  value={filterMin}
                  onChange={(e) => setFilterMin(e.target.value)}
                  placeholder="-inf"
                />
                <span className="text-xs text-muted-foreground">~</span>
                <Input
                  className="h-7 font-mono text-xs w-28"
                  value={filterMax}
                  onChange={(e) => setFilterMax(e.target.value)}
                  placeholder="+inf"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleFilter()}
                  disabled={isFiltering}
                >
                  {isFiltering ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  Filter
                </Button>
                {filterActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-muted-foreground"
                    onClick={clearFilter}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              {filterActive && filterTotal !== null && (
                <div className="text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs mr-1.5">
                    ZCOUNT: {filterTotal}
                  </Badge>
                  Showing {filteredMembers?.length ?? 0} members matching score ∈{" "}
                  [{filterMin}, {filterMax}]
                </div>
              )}
            </div>
          )}

          {/* Rank Lookup */}
          {onZRank && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Member Rank
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-48"
                  value={rankMember}
                  onChange={(e) => {
                    setRankMember(e.target.value);
                    setRankResult(null);
                  }}
                  placeholder="member name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRankLookup(false);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleRankLookup(false)}
                  disabled={isRanking || !rankMember.trim()}
                >
                  {isRanking ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  ZRANK
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleRankLookup(true)}
                  disabled={isRanking || !rankMember.trim()}
                >
                  {isRanking ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  ZREVRANK
                </Button>
              </div>
              {rankResult !== null && (
                <div className="text-xs">
                  <Badge variant="secondary" className="text-xs mr-1.5">
                    {rankResult.reverse ? "ZREVRANK" : "ZRANK"}
                  </Badge>
                  <span className="text-muted-foreground">
                    Rank{" "}
                    <span className="font-mono text-foreground">
                      #{rankResult.rank}
                    </span>
                  </span>
                </div>
              )}
              {rankResult === null &&
                rankMember.trim() &&
                !isRanking && (
                  <div className="text-xs text-muted-foreground">
                    Member not found
                  </div>
                )}
            </div>
          )}

          {/* Score Lookup (ZSCORE / ZMSCORE) */}
          {(onZScore || onZMScore) && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Score Lookup
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-48"
                  value={scoreMember}
                  onChange={(e) => {
                    setScoreMember(e.target.value);
                    setScoreResult(null);
                  }}
                  placeholder="member (comma-sep for multi)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleScoreLookup(false);
                  }}
                />
                {onZScore && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => void handleScoreLookup(false)}
                    disabled={isScoring || !scoreMember.trim()}
                  >
                    {isScoring ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : null}
                    ZSCORE
                  </Button>
                )}
                {onZMScore && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => void handleScoreLookup(true)}
                    disabled={isScoring || !scoreMember.trim()}
                  >
                    {isScoring ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : null}
                    ZMSCORE
                  </Button>
                )}
              </div>
              {scoreResult && (
                <div className="text-xs space-y-0.5">
                  {scoreResult.members.map((m, i) => (
                    <div key={m} className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs font-mono">
                        {m}
                      </Badge>
                      <span className="text-muted-foreground">→</span>
                      {scoreResult.value[i] !== null ? (
                        <span className="font-mono text-foreground">
                          {scoreResult.value[i]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          (nil)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {scoreResult === null &&
                scoreMember.trim() &&
                !isScoring && (
                  <div className="text-xs text-muted-foreground">
                    Member not found
                  </div>
                )}
            </div>
          )}

          {/* Lex Range (ZRANGEBYLEX) */}
          {onZRangeByLex && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Lex Range{" "}
                <span className="text-muted-foreground/60 font-normal">
                  (all members must share the same score)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 font-mono text-xs w-28"
                  value={lexMin}
                  onChange={(e) => setLexMin(e.target.value)}
                  placeholder="-"
                />
                <span className="text-xs text-muted-foreground">~</span>
                <Input
                  className="h-7 font-mono text-xs w-28"
                  value={lexMax}
                  onChange={(e) => setLexMax(e.target.value)}
                  placeholder="+"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => void handleLexRange()}
                  disabled={isLexing}
                >
                  {isLexing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : null}
                  ZRANGEBYLEX
                </Button>
                {lexActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-muted-foreground"
                    onClick={clearLex}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              {lexActive && lexTotal !== null && (
                <div className="text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-xs mr-1.5">
                    ZLEXCOUNT: {lexTotal}
                  </Badge>
                  Showing {lexMembers?.length ?? 0} members in lex range [{lexMin}, {lexMax}]
                </div>
              )}
              {lexActive && lexMembers && lexMembers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {lexMembers.map((m) => (
                    <Badge
                      key={m}
                      variant="outline"
                      className="text-xs font-mono"
                    >
                      {m}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filter banner */}
      {filterActive && (
        <div className="flex items-center gap-2 text-xs rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-3 py-1.5">
          <SlidersHorizontal className="w-3 h-3 text-blue-500" />
          <span className="text-blue-700 dark:text-blue-300">
            Filtered: score ∈ [{filterMin}, {filterMax}] —{" "}
            {filteredMembers?.length ?? 0} results
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 ml-auto text-xs text-blue-600 dark:text-blue-400"
            onClick={clearFilter}
          >
            Show all
          </Button>
        </div>
      )}

      {/* Data table */}
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

            {displayMembers.length === 0 && !showNewRow && (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-center text-muted-foreground text-sm py-6"
                >
                  {filterActive
                    ? "No members match the score range"
                    : "Empty sorted set"}
                </TableCell>
              </TableRow>
            )}

            {displayMembers.map(({ member, score }) => (
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

      {/* Lex filter banner */}
      {lexActive && (
        <div className="flex items-center gap-2 text-xs rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 px-3 py-1.5">
          <SlidersHorizontal className="w-3 h-3 text-purple-500" />
          <span className="text-purple-700 dark:text-purple-300">
            Lex range [{lexMin}, {lexMax}] — {lexMembers?.length ?? 0} members
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 ml-auto text-xs text-purple-600 dark:text-purple-400"
            onClick={clearLex}
          >
            Show all
          </Button>
        </div>
      )}

      {/* Pop confirmation dialog */}
      <AlertDialog open={!!popDialog} onOpenChange={(open) => { if (!open) setPopDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {popDialog?.type === "min" ? "ZPOPMIN" : "ZPOPMAX"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove and return the member with the{" "}
              {popDialog?.type === "min" ? "lowest" : "highest"} score. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPopping}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handlePop()}
              disabled={isPopping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPopping ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Pop {popDialog?.type === "min" ? "Min" : "Max"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

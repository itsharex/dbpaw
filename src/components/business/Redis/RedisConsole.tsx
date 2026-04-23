import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";

interface HistoryEntry {
  id: number;
  command: string;
  output: string;
  isError: boolean;
}

interface RedisConsoleProps {
  connectionId: number;
  database: string;
}

export function RedisConsole({ connectionId, database }: RedisConsoleProps) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [navIndex, setNavIndex] = useState(-1);
  const cmdHistoryRef = useRef<string[]>([]);
  const nextIdRef = useRef(0);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const run = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      cmdHistoryRef.current = [trimmed, ...cmdHistoryRef.current.slice(0, 99)];
      setNavIndex(-1);
      setCommand("");
      setIsRunning(true);

      const id = nextIdRef.current++;
      try {
        const result = await api.redis.executeRaw(connectionId, database, trimmed);
        setHistory((prev) => [
          ...prev,
          { id, command: trimmed, output: result.output, isError: false },
        ]);
      } catch (e) {
        setHistory((prev) => [
          ...prev,
          {
            id,
            command: trimmed,
            output: e instanceof Error ? e.message : String(e),
            isError: true,
          },
        ]);
      } finally {
        setIsRunning(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [connectionId, database],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void run(command);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = navIndex + 1;
      const entry = cmdHistoryRef.current[next];
      if (entry !== undefined) {
        setNavIndex(next);
        setCommand(entry);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = navIndex - 1;
      if (next < 0) {
        setNavIndex(-1);
        setCommand("");
      } else {
        const entry = cmdHistoryRef.current[next];
        if (entry !== undefined) {
          setNavIndex(next);
          setCommand(entry);
        }
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-background text-sm">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Terminal className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium">Redis Console</span>
        <span className="text-xs text-muted-foreground">{database}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHistory([])}
          disabled={history.length === 0}
        >
          <Trash2 className="w-3 h-3 mr-1" />
          Clear
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 font-mono">
        {history.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Type a Redis command and press Enter. Use ↑↓ to navigate history.
            <br />
            Examples: <span className="text-foreground">GET mykey</span> ·{" "}
            <span className="text-foreground">HGETALL myhash</span> ·{" "}
            <span className="text-foreground">KEYS *</span> ·{" "}
            <span className="text-foreground">INFO server</span>
          </p>
        ) : (
          history.map((entry) => (
            <div key={entry.id} className="mb-4">
              <div className="flex items-start gap-2 text-muted-foreground mb-1">
                <span className="text-green-500 dark:text-green-400 shrink-0">❯</span>
                <span>{entry.command}</span>
              </div>
              <pre
                className={[
                  "whitespace-pre-wrap break-all text-xs pl-5 leading-relaxed",
                  entry.isError ? "text-destructive" : "text-foreground",
                ].join(" ")}
              >
                {entry.output}
              </pre>
            </div>
          ))
        )}
        <div ref={outputEndRef} />
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0 items-center">
        <span className="text-green-500 dark:text-green-400 font-mono shrink-0">❯</span>
        <Input
          ref={inputRef}
          className="flex-1 font-mono text-sm h-8"
          placeholder="Enter Redis command…"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          autoFocus
        />
        <Button
          size="sm"
          className="h-8"
          onClick={() => void run(command)}
          disabled={isRunning || !command.trim()}
        >
          {isRunning ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Play className="w-3 h-3 mr-1" />
          )}
          Run
        </Button>
      </div>
    </div>
  );
}

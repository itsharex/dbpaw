import { useState } from "react";
import { Braces } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

function tryParseJson(s: string): unknown | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function RedisStringViewer({ value, onChange }: Props) {
  const [formatted, setFormatted] = useState(false);
  const parsed = tryParseJson(value);
  const isJson = parsed !== null;

  const displayValue =
    formatted && isJson ? JSON.stringify(parsed, null, 2) : value;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{value.length} chars</span>
        <div className="flex items-center gap-2">
          {isJson && (
            <Badge variant="secondary" className="text-xs">
              JSON
            </Badge>
          )}
          {isJson && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setFormatted((f) => !f)}
            >
              <Braces className="w-3 h-3 mr-1" />
              {formatted ? "Raw" : "Beautify"}
            </Button>
          )}
        </div>
      </div>
      <Textarea
        className="min-h-[320px] font-mono text-sm"
        value={displayValue}
        onChange={(e) => {
          setFormatted(false);
          onChange(e.target.value);
        }}
        placeholder="String value"
      />
    </div>
  );
}

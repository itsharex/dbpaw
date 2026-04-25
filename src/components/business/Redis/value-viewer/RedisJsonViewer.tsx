import { useState, useEffect } from "react";
import { AlertTriangle, AlignLeft, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onChange: (v: string) => void;
  moduleMissing?: boolean;
}

export function RedisJsonViewer({ value, onChange, moduleMissing }: Props) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(value);
    setError(null);
  }, [value]);

  const validate = (raw: string): boolean => {
    try {
      JSON.parse(raw);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      return false;
    }
  };

  const handleChange = (raw: string) => {
    setText(raw);
    validate(raw);
    onChange(raw);
  };

  const prettify = () => {
    try {
      const parsed = JSON.parse(text);
      const pretty = JSON.stringify(parsed, null, 2);
      setText(pretty);
      setError(null);
      onChange(pretty);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const minify = () => {
    try {
      const parsed = JSON.parse(text);
      const compact = JSON.stringify(parsed);
      setText(compact);
      setError(null);
      onChange(compact);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div className="space-y-2">
      {moduleMissing && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            RedisJSON module is not loaded on this server. Displaying raw string value.
            Editing will overwrite the key as a plain string.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={prettify}
            title="Prettify JSON"
          >
            <AlignLeft className="w-3 h-3 mr-1" />
            Prettify
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={minify}
            title="Minify JSON"
          >
            <Save className="w-3 h-3 mr-1" />
            Minify
          </Button>
        </div>
        {error && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <X className="w-3 h-3" />
            {error}
          </span>
        )}
      </div>

      <textarea
        className="w-full min-h-[240px] rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

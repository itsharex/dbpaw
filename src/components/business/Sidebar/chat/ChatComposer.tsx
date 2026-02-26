import type { KeyboardEventHandler } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AIProviderConfig } from "@/services/api";

export interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSend: () => void;
  isLoading: boolean;
  providers: AIProviderConfig[];
  selectedProviderId: string;
  onProviderChange: (value: string) => void;
}

export function ChatComposer({
  input,
  onInputChange,
  onKeyDown,
  onSend,
  isLoading,
  providers,
  selectedProviderId,
  onProviderChange,
}: ChatComposerProps) {
  return (
    <div className="shrink-0 min-w-0 border-t border-border/70 p-3">
      <div className="min-w-0 rounded-xl border border-border/80 bg-muted/20 p-2">
        <Textarea
          placeholder="Describe SQL to generate or optimize..."
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-[84px] w-full min-w-0 resize-none border-0 bg-transparent px-2 py-1 shadow-none focus-visible:ring-0"
          rows={3}
        />
        <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-border/70 px-1 pt-2">
          <div className="min-w-0 flex-1">
            <Select value={selectedProviderId} onValueChange={onProviderChange}>
              <SelectTrigger className="h-8 w-full min-w-0 border-border/70 bg-background text-xs">
                <SelectValue placeholder="Select AI provider" />
              </SelectTrigger>
              <SelectContent align="start">
                {providers.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} / {p.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || isLoading || !selectedProviderId}
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg"
            title="Send"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

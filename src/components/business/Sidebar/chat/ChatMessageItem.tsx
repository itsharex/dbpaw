import type { AIMessage } from "@/services/api";
import { AIMarkdownMessage } from "../AIMarkdownMessage";

export interface ChatMessageItemProps {
  message: AIMessage;
  variant: "user" | "assistant";
}

export function ChatMessageItem({ message, variant }: ChatMessageItemProps) {
  if (variant === "user") {
    return (
      <div className="ml-auto min-w-0 max-w-[86%] rounded-xl border border-border/80 bg-muted/40 px-3 py-2">
        <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <AIMarkdownMessage
      content={message.content}
      className="min-w-0 w-full max-w-full"
    />
  );
}

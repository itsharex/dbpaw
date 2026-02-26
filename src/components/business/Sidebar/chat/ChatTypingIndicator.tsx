import { AIMarkdownMessage } from "../AIMarkdownMessage";

export interface ChatTypingIndicatorProps {
  streamingContent: string;
  streamStatus: string;
}

export function ChatTypingIndicator({
  streamingContent,
  streamStatus,
}: ChatTypingIndicatorProps) {
  return (
    <div className="min-w-0 w-full max-w-full">
      <AIMarkdownMessage content={streamingContent || streamStatus || "Thinking..."} />
    </div>
  );
}

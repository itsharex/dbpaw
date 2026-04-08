import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/components/ui/utils";
import {
  getAutocompleteToken,
  getColumnAutocompleteOptions,
  replaceAutocompleteToken,
  type ColumnAutocompleteOption,
} from "./columnAutocomplete";

interface ColumnAutocompleteInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  options: ColumnAutocompleteOption[];
  placeholder: string;
  className?: string;
}

export function ColumnAutocompleteInput({
  value,
  onValueChange,
  onSubmit,
  options,
  placeholder,
  className,
}: ColumnAutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursorIndex, setCursorIndex] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const token = useMemo(
    () => getAutocompleteToken(value, cursorIndex),
    [value, cursorIndex],
  );

  const filteredOptions = useMemo(
    () => getColumnAutocompleteOptions(options, token),
    [options, token],
  );

  const hasSuggestions = filteredOptions.length > 0;

  useEffect(() => {
    setActiveIndex(0);
    setIsOpen(hasSuggestions);
  }, [hasSuggestions, token?.text]);

  const syncCursor = useCallback(() => {
    const nextCursor = inputRef.current?.selectionStart ?? value.length;
    setCursorIndex(nextCursor);
  }, [value.length]);

  const acceptSuggestion = useCallback(
    (option: ColumnAutocompleteOption) => {
      if (!token) return;

      const nextValue = replaceAutocompleteToken(value, token, option.name);
      const nextCursor = token.from + option.name.length;
      onValueChange(nextValue);
      setCursorIndex(nextCursor);
      setIsOpen(false);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [onValueChange, token, value],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isOpen && hasSuggestions) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((idx) => (idx + 1) % filteredOptions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (idx) => (idx - 1 + filteredOptions.length) % filteredOptions.length,
        );
        return;
      }

      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        acceptSuggestion(filteredOptions[activeIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
    }

    if (event.key === "Enter") {
      onSubmit();
    }
  };

  return (
    <Popover open={isOpen && hasSuggestions} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className={className}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setCursorIndex(
              event.target.selectionStart ?? event.target.value.length,
            );
          }}
          onClick={syncCursor}
          onKeyUp={syncCursor}
          onKeyDown={handleKeyDown}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[260px] p-1 shadow-lg"
      >
        <div className="max-h-56 overflow-auto">
          {filteredOptions.map((option, index) => (
            <button
              key={option.name}
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left font-mono text-xs",
                index === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-muted",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => acceptSuggestion(option)}
            >
              <span className="truncate">{option.name}</span>
              {option.type ? (
                <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                  {option.type}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

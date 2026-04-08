export interface ColumnAutocompleteOption {
  name: string;
  type?: string;
}

export interface AutocompleteToken {
  from: number;
  to: number;
  text: string;
}

export const MAX_COLUMN_AUTOCOMPLETE_OPTIONS = 8;

export function getAutocompleteToken(
  value: string,
  cursorIndex: number,
): AutocompleteToken | null {
  const beforeCursor = value.slice(0, cursorIndex);
  const match = beforeCursor.match(/[A-Za-z_][A-Za-z0-9_$]*$/);
  if (!match || match.index === undefined) return null;

  return {
    from: match.index,
    to: cursorIndex,
    text: match[0],
  };
}

export function replaceAutocompleteToken(
  value: string,
  token: AutocompleteToken,
  replacement: string,
) {
  return `${value.slice(0, token.from)}${replacement}${value.slice(token.to)}`;
}

export function getColumnAutocompleteOptions(
  options: ColumnAutocompleteOption[],
  token: AutocompleteToken | null,
) {
  const text = token?.text.toLowerCase();
  if (!text) return [];

  return options
    .filter((option) => option.name.toLowerCase().startsWith(text))
    .slice(0, MAX_COLUMN_AUTOCOMPLETE_OPTIONS);
}

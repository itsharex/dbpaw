export function normalizeDatabaseOptions(
  databases: string[],
  fallback?: string | null,
): string[] {
  const normalized = databases
    .map((name) => name.trim())
    .filter((name, index, arr) => !!name && arr.indexOf(name) === index);

  const fallbackName = fallback?.trim();
  if (fallbackName && !normalized.includes(fallbackName)) {
    normalized.unshift(fallbackName);
  }

  return normalized;
}

export function resolvePreferredDatabase(params: {
  preferredDatabase?: string | null;
  connectionDatabase?: string | null;
  availableDatabases?: string[];
}): string | undefined {
  const options = normalizeDatabaseOptions(
    params.availableDatabases ?? [],
    params.connectionDatabase,
  );
  const preferred = params.preferredDatabase?.trim();

  if (preferred && options.includes(preferred)) {
    return preferred;
  }

  if (params.connectionDatabase?.trim()) {
    const connectionDatabase = params.connectionDatabase.trim();
    if (options.includes(connectionDatabase)) {
      return connectionDatabase;
    }
  }

  if (options.length > 0) {
    return options[0];
  }

  return preferred || params.connectionDatabase?.trim() || undefined;
}

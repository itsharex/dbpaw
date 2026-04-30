/**
 * Shared Redis key-type color mappings.
 *
 * TYPE_COLORS  — lightweight class string for sidebar list badges (keyed by raw keyType)
 * TYPE_BADGE   — label + class string for detail-panel header badges (keyed by TS kind)
 */

/* ------------------------------------------------------------------ */
/*  Sidebar list badges – keyed by raw backend keyType string         */
/* ------------------------------------------------------------------ */

export const TYPE_COLORS: Record<string, string> = {
  string:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  hash: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  list:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  set: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  zset: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  stream:
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  "ReJSON-RL":
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

/* ------------------------------------------------------------------ */
/*  Detail-panel header badges – keyed by discriminated-union kind     */
/* ------------------------------------------------------------------ */

export const TYPE_BADGE: Record<string, { label: string; className: string }> =
  {
    string: {
      label: "string",
      className:
        "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    },
    hash: {
      label: "hash",
      className:
        "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
    },
    list: {
      label: "list",
      className:
        "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
    },
    set: {
      label: "set",
      className:
        "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800",
    },
    zSet: {
      label: "zset",
      className:
        "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800",
    },
    stream: {
      label: "stream",
      className:
        "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:border-cyan-800",
    },
    json: {
      label: "json",
      className:
        "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    },
  };

/**
 * Map a raw backend keyType to a human-friendly sidebar label.
 * Falls back to the raw value when no alias exists.
 */
export const TYPE_DISPLAY_LABEL: Record<string, string> = {
  "ReJSON-RL": "json",
};

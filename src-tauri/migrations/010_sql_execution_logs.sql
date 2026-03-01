CREATE TABLE IF NOT EXISTS sql_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sql TEXT NOT NULL,
  source TEXT,
  connection_id INTEGER,
  database TEXT,
  success INTEGER NOT NULL,
  error TEXT,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sql_execution_logs_executed_at
ON sql_execution_logs (executed_at DESC);

export interface ColumnDef {
  id: string;
  name: string;
  dataType: string;
  length: string;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string;
  comment: string;
}

export interface StarRocksDistribution {
  type: "hash" | "random";
  /** Column names used when type === "hash" */
  columns: string[];
  /** Number of buckets, e.g. "10", or "AUTO" */
  buckets: string;
}

export interface CreateTableDef {
  tableName: string;
  schema: string;
  columns: ColumnDef[];
  starrocksDistribution?: StarRocksDistribution;
}

export type DbDriver =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "tidb"
  | "starrocks"
  | "sqlite"
  | "duckdb"
  | "clickhouse"
  | "mssql"
  | "oracle";

/** Per-driver ordered list of common data types shown as presets in the UI. */
export const TYPE_PRESETS: Record<DbDriver, string[]> = {
  postgres: [
    "INTEGER",
    "BIGINT",
    "SERIAL",
    "BIGSERIAL",
    "SMALLINT",
    "VARCHAR(255)",
    "TEXT",
    "BOOLEAN",
    "NUMERIC",
    "FLOAT8",
    "TIMESTAMP",
    "TIMESTAMPTZ",
    "DATE",
    "JSONB",
    "UUID",
  ],
  mysql: [
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "VARCHAR(255)",
    "TEXT",
    "LONGTEXT",
    "TINYINT(1)",
    "DECIMAL(10,2)",
    "FLOAT",
    "DOUBLE",
    "DATETIME",
    "TIMESTAMP",
    "DATE",
    "JSON",
  ],
  mariadb: [
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "VARCHAR(255)",
    "TEXT",
    "LONGTEXT",
    "TINYINT(1)",
    "DECIMAL(10,2)",
    "FLOAT",
    "DOUBLE",
    "DATETIME",
    "TIMESTAMP",
    "DATE",
    "JSON",
  ],
  tidb: [
    "INT",
    "BIGINT",
    "SMALLINT",
    "VARCHAR(255)",
    "TEXT",
    "TINYINT(1)",
    "DECIMAL(10,2)",
    "FLOAT",
    "DOUBLE",
    "DATETIME",
    "TIMESTAMP",
    "DATE",
    "JSON",
  ],
  starrocks: [
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "VARCHAR(255)",
    "STRING",
    "BOOLEAN",
    "DECIMAL(10,2)",
    "FLOAT",
    "DOUBLE",
    "DATETIME",
    "DATE",
    "JSON",
  ],
  sqlite: ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"],
  duckdb: [
    "INTEGER",
    "BIGINT",
    "SMALLINT",
    "HUGEINT",
    "VARCHAR",
    "TEXT",
    "BOOLEAN",
    "DOUBLE",
    "FLOAT",
    "DECIMAL(10,2)",
    "TIMESTAMP",
    "DATE",
    "JSON",
    "UUID",
  ],
  clickhouse: [
    "Int32",
    "Int64",
    "UInt32",
    "UInt64",
    "Float32",
    "Float64",
    "String",
    "FixedString(32)",
    "DateTime",
    "Date",
    "UUID",
    "Boolean",
    "Nullable(String)",
    "Nullable(Int64)",
  ],
  mssql: [
    "INT",
    "BIGINT",
    "SMALLINT",
    "TINYINT",
    "NVARCHAR(255)",
    "NVARCHAR(MAX)",
    "NCHAR(10)",
    "BIT",
    "DECIMAL(18,2)",
    "FLOAT",
    "DATETIME2",
    "DATE",
    "UNIQUEIDENTIFIER",
  ],
  oracle: [
    "NUMBER",
    "NUMBER(10)",
    "NUMBER(10,2)",
    "VARCHAR2(255)",
    "NVARCHAR2(255)",
    "CLOB",
    "CHAR(1)",
    "DATE",
    "TIMESTAMP",
    "FLOAT",
  ],
};

/** Whether the driver supports AUTO_INCREMENT / AUTOINCREMENT syntax */
export function supportsAutoIncrement(driver: DbDriver): boolean {
  return ["mysql", "mariadb", "tidb", "starrocks", "sqlite"].includes(driver);
}

/** Whether the driver supports column COMMENT syntax */
function supportsColumnComment(driver: DbDriver): boolean {
  return ["mysql", "mariadb", "tidb", "starrocks", "clickhouse"].includes(
    driver,
  );
}

function quoteIdentifier(name: string, driver: DbDriver): string {
  switch (driver) {
    case "mysql":
    case "mariadb":
    case "tidb":
    case "starrocks":
    case "clickhouse":
      return `\`${name}\``;
    case "mssql":
      return `[${name}]`;
    default:
      return `"${name}"`;
  }
}

function buildTableRef(
  schema: string,
  tableName: string,
  driver: DbDriver,
): string {
  const quotedTable = quoteIdentifier(tableName, driver);

  switch (driver) {
    case "mysql":
    case "mariadb":
    case "tidb":
    case "starrocks":
    case "clickhouse":
    case "sqlite":
      // these drivers don't use schema prefix (or schema == database)
      return quotedTable;
    case "mssql":
      return schema.trim()
        ? `[${schema}].${quotedTable}`
        : `[dbo].${quotedTable}`;
    case "oracle":
      return schema.trim() ? `"${schema}".${quotedTable}` : quotedTable;
    default:
      // postgres
      return schema.trim() ? `"${schema}".${quotedTable}` : quotedTable;
  }
}

/** String-like column types whose DEFAULT values must be single-quoted. */
const STRING_TYPES =
  /^(ENUM|SET|VARCHAR|NVARCHAR|CHAR|NCHAR|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT)$/i;

/** SQL keywords / expressions that must NOT be quoted. */
const UNQUOTED_EXPR =
  /^(NULL|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NOW\s*\(\s*\))$/i;

/**
 * Returns the properly formatted DEFAULT expression for a column.
 * Bare words (e.g. `user`) are quoted when the column type is string-like.
 */
export function formatDefault(value: string, dataType: string): string {
  const v = value.trim();
  if (
    v.startsWith("'") ||
    v.startsWith('"') ||
    UNQUOTED_EXPR.test(v) ||
    /^\w+\s*\(/.test(v) ||
    /^-?\d+(\.\d+)?$/.test(v)
  ) {
    return v;
  }
  if (STRING_TYPES.test(dataType.trim())) {
    return `'${v.replace(/'/g, "''")}'`;
  }
  return v;
}

function buildColumnLine(
  col: ColumnDef,
  driver: DbDriver,
  multiPk: boolean,
): string {
  const quotedName = quoteIdentifier(col.name, driver);

  // Build type string — if length is provided and the base type doesn't
  // already include parentheses, append it.
  let typeStr = col.dataType.trim();
  if (col.length.trim() && !typeStr.includes("(")) {
    typeStr = `${typeStr}(${col.length.trim()})`;
  }

  const parts: string[] = [`${quotedName} ${typeStr}`];

  if (col.notNull) {
    parts.push("NOT NULL");
  }

  if (col.defaultValue.trim()) {
    parts.push(`DEFAULT ${formatDefault(col.defaultValue, col.dataType)}`);
  }

  // AUTO_INCREMENT / AUTOINCREMENT
  if (col.autoIncrement && supportsAutoIncrement(driver)) {
    if (driver === "sqlite") {
      // SQLite: AUTOINCREMENT only works on INTEGER PRIMARY KEY columns
      parts.push("AUTOINCREMENT");
    } else {
      parts.push("AUTO_INCREMENT");
    }
  }

  // Inline PRIMARY KEY only when there is a single PK column
  if (col.primaryKey && !multiPk) {
    parts.push("PRIMARY KEY");
  }

  // COMMENT clause (MySQL family + ClickHouse)
  if (col.comment.trim() && supportsColumnComment(driver)) {
    const escaped = col.comment.replace(/'/g, "''");
    parts.push(`COMMENT '${escaped}'`);
  }

  return parts.join(" ");
}

export function generateCreateTableSQL(
  def: CreateTableDef,
  driver: DbDriver,
): string {
  const { tableName, schema, columns, starrocksDistribution } = def;

  if (!tableName.trim() || columns.length === 0) return "";

  const tableRef = buildTableRef(schema, tableName.trim(), driver);
  const pkCols = columns.filter((c) => c.primaryKey);
  const multiPk = pkCols.length > 1;

  const colLines = columns
    .filter((c) => c.name.trim() && c.dataType.trim())
    .map((c) => buildColumnLine(c, driver, multiPk));

  const constraints: string[] = [];
  if (multiPk) {
    const pkList = pkCols
      .map((c) => quoteIdentifier(c.name, driver))
      .join(", ");
    constraints.push(`PRIMARY KEY (${pkList})`);
  }

  const allLines = [...colLines, ...constraints];
  if (allLines.length === 0) return "";

  const body = allLines.map((l) => `  ${l}`).join(",\n");
  let sql = `CREATE TABLE ${tableRef} (\n${body}\n)`;

  // Driver-specific table-level clauses
  if (driver === "clickhouse") {
    sql += "\nENGINE = MergeTree()\nORDER BY tuple()";
  } else if (driver === "mysql" || driver === "mariadb") {
    sql +=
      "\nENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci";
  } else if (driver === "starrocks") {
    sql += buildStarRocksDistributedBy(starrocksDistribution);
  }

  return sql + ";";
}

function buildStarRocksDistributedBy(
  dist: StarRocksDistribution | undefined,
): string {
  if (!dist) {
    // Fallback placeholder — will still produce invalid SQL, but at least
    // it's visible in the preview and the validation will catch it.
    return "\nDISTRIBUTED BY HASH(/* column */) BUCKETS 10";
  }

  const buckets = dist.buckets.trim() || "10";

  if (dist.type === "random") {
    return `\nDISTRIBUTED BY RANDOM BUCKETS ${buckets}`;
  }

  // HASH distribution
  const cols = dist.columns
    .filter((c) => c.trim())
    .map((c) => quoteIdentifier(c, "starrocks"))
    .join(", ");

  if (!cols) {
    return `\nDISTRIBUTED BY HASH(/* column */) BUCKETS ${buckets}`;
  }

  return `\nDISTRIBUTED BY HASH(${cols}) BUCKETS ${buckets}`;
}

# /new-db — Scaffold a new database driver for DbPaw

Scaffold all boilerplate needed to add a new database type to DbPaw.

**Usage:** `/new-db <DbName> <DefaultPort> <RustCrate> [network|file] [mysql-family]`

**Examples:**
- `/new-db Redis 6379 redis-rs network`
- `/new-db CockroachDB 26257 sqlx network`
- `/new-db LanceDB 0 lancedb file`

---

## Parse $ARGUMENTS

Extract the following variables from `$ARGUMENTS`:

- `DB_NAME` — display name, e.g. `Redis` (keep original casing)
- `DRIVER_ID` — lowercase of DB_NAME, e.g. `redis`
- `DEFAULT_PORT` — integer, e.g. `6379`; use `0` if file-based
- `RUST_CRATE` — crate name on crates.io, e.g. `redis`
- `IS_FILE_BASED` — `true` if `DEFAULT_PORT == 0` OR `file` flag is present; else `false`
- `IS_MYSQL_FAMILY` — `true` if `mysql-family` flag is present; else `false`
- `ENV_PREFIX` — `DRIVER_ID` uppercased, e.g. `REDIS`

If `$ARGUMENTS` is empty or unclear, ask the user before proceeding.

---

## Execution Steps

Work through each step in order. After completing each numbered step, confirm with a brief status message before continuing.

---

### Step 1 — Create the Rust driver file

**CREATE** `src-tauri/src/db/drivers/{DRIVER_ID}.rs`

Use the most appropriate reference driver as a template:
- **sqlx-based (most SQL databases):** copy structure from `src-tauri/src/db/drivers/mysql.rs`
- **HTTP-based:** copy structure from `src-tauri/src/db/drivers/clickhouse.rs`
- **File-based / embedded:** copy structure from `src-tauri/src/db/drivers/duckdb.rs`

The file must contain:

1. **Struct definition:**
   ```rust
   pub struct {DbName}Driver {
       // connection pool or client
       pub ssh_tunnel: Option<crate::ssh::SshTunnel>,
   }
   ```

2. **`connect()` function** that:
   - Handles SSH tunnel if `IS_FILE_BASED == false`:
     ```rust
     let mut ssh_tunnel = None;
     if let Some(true) = form.ssh_enabled {
         let tunnel = crate::ssh::start_ssh_tunnel(form)
             .map_err(|e| format!("[CONN_FAILED] SSH tunnel failed: {}", e))?;
         // Override host/port to tunnel local endpoint
         ssh_tunnel = Some(tunnel);
     }
     ```
   - Builds connection string / config
   - Creates a connection pool or client
   - Returns `Ok(Self { ..., ssh_tunnel })`
   - Maps all connection errors via `super::conn_failed_error(&e)`

3. **`#[async_trait] impl DatabaseDriver for {DbName}Driver`** implementing all 13 methods:
   - `test_connection` — run a simple health-check query (e.g. `SELECT 1`)
   - `list_databases` — query the database catalog
   - `list_tables` — query information_schema or equivalent; return `Vec<TableInfo>`
   - `get_table_structure` — return column definitions as `TableStructure`
   - `get_table_metadata` — return row count, indexes, size as `TableMetadata`
   - `get_table_ddl` — return `CREATE TABLE ...` DDL string
   - `get_table_data` — paginated SELECT with optional sort/filter; return `TableDataResponse`
   - `get_table_data_chunk` — same signature as `get_table_data`; implement identically unless streaming is needed
   - `execute_query` — run arbitrary SQL; return `QueryResult`
   - `execute_query_with_id` — only override if the DB supports cancellable queries; otherwise leave as default (already inherited from trait)
   - `get_schema_overview` — return counts of tables/views per schema as `SchemaOverview`
   - `close` — close pool / drop resources

   Error prefix conventions (must be followed exactly — frontend parses these):
   - Connection errors: `[CONN_FAILED] ...`
   - Query errors: `[QUERY_ERROR] ...`
   - Validation errors: `[VALIDATION_ERROR] ...`
   - Unsupported operations: `[NOT_SUPPORTED] ...`

   Use `super::strip_trailing_statement_terminator(&sql)` before executing user queries.

---

### Step 2 — Register the driver in `mod.rs`

**UPDATE** `src-tauri/src/db/drivers/mod.rs`

1. Add at the top with the other `use self::` imports (keep alphabetical order):
   ```rust
   use self::{DRIVER_ID}::{DbName}Driver;
   ```

2. Add with the other `pub mod` declarations (keep alphabetical order):
   ```rust
   pub mod {DRIVER_ID};
   ```

3. Add a match arm inside the `connect()` function (before the `_ => Err(...)` catch-all):
   ```rust
   "{DRIVER_ID}" => {
       let driver = {DbName}Driver::connect(form).await?;
       Ok(Box::new(driver) as Box<dyn DatabaseDriver>)
   }
   ```

---

### Step 3 — Add SSH default port

**UPDATE** `src-tauri/src/ssh.rs`

In the `default_port` match block at approximately line 48:

```rust
let default_port: i64 = match config.driver.to_ascii_lowercase().as_str() {
    "mysql" => 3306,
    "mssql" => 1433,
    "clickhouse" => 9000,
    "sqlite" => 0,
    // ADD THIS LINE:
    "{DRIVER_ID}" => {DEFAULT_PORT},
    _ => 5432,
};
```

If `IS_FILE_BASED == true`, use `0` as the port value.

---

### Step 4 — Update connection input normalization

**UPDATE** `src-tauri/src/connection_input/mod.rs`

- If `IS_MYSQL_FAMILY == true`: add `| "{DRIVER_ID}"` to the mysql-family match on line 57:
  ```rust
  if matches!(driver.as_str(), "mysql" | "mariadb" | "tidb" | "{DRIVER_ID}") {
  ```

- If `IS_FILE_BASED == true`: add `| "{DRIVER_ID}"` to the file-based match on line 65:
  ```rust
  if matches!(driver.as_str(), "sqlite" | "duckdb" | "{DRIVER_ID}") {
  ```

- If neither: no change needed to this file.

---

### Step 5 — Add Cargo dependency

**UPDATE** `src-tauri/Cargo.toml`

Add the new crate under `[dependencies]`. Look up the latest stable version before adding.

```toml
{RUST_CRATE} = "LATEST_VERSION"
```

Add any required feature flags based on the driver's needs (async runtime, TLS, connection pooling, etc.).

---

### Step 6 — Register in frontend driver registry

**UPDATE** `src/lib/driver-registry.tsx`

This is the **single frontend entry point** — all other frontend files (`api.ts`, `rules.ts`,
`ConnectionList.tsx`, `helpers.tsx`) derive their data from this registry automatically.

**6a.** Add `"{DRIVER_ID}"` to the `DRIVER_IDS` tuple (lines 16–25):

```typescript
const DRIVER_IDS = [
  "postgres",
  // ... existing entries ...
  "{DRIVER_ID}",  // ADD THIS
] as const;
```

**6b.** Add a `DriverConfig` entry to `DRIVER_REGISTRY` (lines 55–152), before the closing `];`:

```typescript
{
  id: "{DRIVER_ID}",
  label: "{DB_NAME}",
  defaultPort: {DEFAULT_PORT},   // use null if IS_FILE_BASED == true
  isFileBased: {IS_FILE_BASED},
  isMysqlFamily: {IS_MYSQL_FAMILY},
  supportsSSLCA: false,          // true only if driver verifies SSL CA certs
  supportsSchemaBrowsing: false, // true if driver exposes named schemas (like postgres/mssql)
  supportsCreateDatabase: true,  // false for file-based and read-only drivers
  importCapability: "supported", // "supported" | "read_only_not_supported" | "unsupported"
  icon: () => renderSimpleIcon(si{DbName}), // or <Database className="w-4 h-4" /> if no simple-icons entry
},
```

For the icon: check if `simple-icons` exports `si{DbName}`. If yes, add the import at the top of the file:
```typescript
import { ..., si{DbName} } from "simple-icons";
```
If no matching icon exists, use `<Database className="w-4 h-4" />` (already imported from lucide-react).

---

### Step 7 — Create integration test files

**CREATE** `src-tauri/tests/common/{DRIVER_ID}_context.rs`

Follow the exact pattern of `src-tauri/tests/common/mysql_context.rs`:

```rust
mod shared;

use dbpaw_lib::models::ConnectionForm;
use std::env;
use std::time::Duration;
use testcontainers::clients::Cli;
use testcontainers::core::WaitFor;
use testcontainers::{Container, GenericImage, RunnableImage};

pub use shared::{connect_with_retry, should_reuse_local_db};

pub fn {DRIVER_ID}_form_from_test_context<'a>(
    docker: Option<&'a Cli>,
) -> (Option<Container<'a, GenericImage>>, ConnectionForm) {
    if should_reuse_local_db() {
        return (None, {DRIVER_ID}_form_from_local_env());
    }
    shared::ensure_docker_available();

    let docker = docker.expect("docker client is required when IT_REUSE_LOCAL_DB is not enabled");
    let image = GenericImage::new("{docker_image}", "{docker_tag}")
        .with_env_var("{ENV_PREFIX}_PASSWORD", "123456")
        .with_env_var("{ENV_PREFIX}_DATABASE", "test_db")
        .with_wait_for(WaitFor::seconds(5))
        .with_exposed_port({DEFAULT_PORT});
    let runnable =
        RunnableImage::from(image).with_container_name(shared::unique_container_name("{DRIVER_ID}"));
    let container = docker.run(runnable);
    let port = container.get_host_port_ipv4({DEFAULT_PORT});

    shared::wait_for_port("127.0.0.1", port, Duration::from_secs(45));

    let mut form = ConnectionForm {
        driver: "{DRIVER_ID}".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(i64::from(port)),
        username: Some("root".to_string()),
        password: Some("123456".to_string()),
        database: Some("test_db".to_string()),
        ..Default::default()
    };
    apply_{DRIVER_ID}_env_overrides(&mut form);
    (Some(container), form)
}

fn {DRIVER_ID}_form_from_local_env() -> ConnectionForm {
    let mut form = ConnectionForm {
        driver: "{DRIVER_ID}".to_string(),
        host: Some(shared::env_or("{ENV_PREFIX}_HOST", "localhost")),
        port: Some(shared::env_i64("{ENV_PREFIX}_PORT", {DEFAULT_PORT})),
        username: Some(shared::env_or("{ENV_PREFIX}_USER", "root")),
        password: Some(shared::env_or("{ENV_PREFIX}_PASSWORD", "123456")),
        database: Some(shared::env_or("{ENV_PREFIX}_DB", "test_db")),
        ..Default::default()
    };
    apply_{DRIVER_ID}_env_overrides(&mut form);
    form
}

fn apply_{DRIVER_ID}_env_overrides(form: &mut ConnectionForm) {
    if let Ok(host) = env::var("{ENV_PREFIX}_HOST") { form.host = Some(host); }
    if let Ok(port) = env::var("{ENV_PREFIX}_PORT") {
        form.port = Some(port.parse::<i64>().expect("{ENV_PREFIX}_PORT should be a valid number"));
    }
    if let Ok(user) = env::var("{ENV_PREFIX}_USER") { form.username = Some(user); }
    if let Ok(password) = env::var("{ENV_PREFIX}_PASSWORD") { form.password = Some(password); }
    if let Ok(database) = env::var("{ENV_PREFIX}_DB") { form.database = Some(database); }
}
```

Replace `{docker_image}` and `{docker_tag}` with the official Docker Hub image name and tag for this database.

---

**CREATE** `src-tauri/tests/{DRIVER_ID}_integration.rs`

Follow the pattern of `src-tauri/tests/mysql_integration.rs`:

```rust
#[path = "common/{DRIVER_ID}_context.rs"]
mod {DRIVER_ID}_context;

use dbpaw_lib::db::drivers::{DRIVER_ID}::{DbName}Driver;
use dbpaw_lib::db::drivers::DatabaseDriver;
use testcontainers::clients::Cli;

#[tokio::test]
#[ignore]
async fn test_{DRIVER_ID}_integration_flow() {
    let docker = (!{DRIVER_ID}_context::should_reuse_local_db()).then(Cli::default);
    let (_container, form) = {DRIVER_ID}_context::{DRIVER_ID}_form_from_test_context(docker.as_ref());
    let database = form.database.clone();

    let driver: {DbName}Driver =
        {DRIVER_ID}_context::connect_with_retry(|| {DbName}Driver::connect(&form)).await;

    // 1. test_connection
    let result = driver.test_connection().await;
    assert!(result.is_ok(), "Connection failed: {:?}", result.err());

    // 2. list_databases
    let dbs = driver.list_databases().await;
    assert!(dbs.is_ok(), "list_databases failed: {:?}", dbs.err());
    assert!(!dbs.unwrap().is_empty());

    // 3. Per-database operations
    if let Some(db_name) = database {
        let table_name = "test_{DRIVER_ID}_integration";

        // list_tables
        let tables = driver.list_tables(Some(db_name.clone())).await;
        assert!(tables.is_ok(), "list_tables failed: {:?}", tables.err());

        // execute_query: create table (adapt DDL to target database SQL dialect)
        let _ = driver.execute_query(format!(
            "CREATE TABLE IF NOT EXISTS {} (id INT PRIMARY KEY, name VARCHAR(50))",
            table_name
        )).await.expect("create table failed");

        // execute_query: insert
        let _ = driver.execute_query(format!(
            "DELETE FROM {} WHERE id = 1", table_name
        )).await;
        driver.execute_query(format!(
            "INSERT INTO {} (id, name) VALUES (1, 'DbPaw')", table_name
        )).await.expect("insert failed");

        // execute_query: select
        let result = driver.execute_query(format!(
            "SELECT * FROM {} WHERE id = 1", table_name
        )).await.expect("select failed");
        assert_eq!(result.row_count, 1);
        if let Some(row) = result.data.first() {
            assert_eq!(row.get("name").and_then(|v| v.as_str()), Some("DbPaw"));
        }

        // get_table_structure
        let structure = driver.get_table_structure(db_name.clone(), table_name.to_string()).await;
        assert!(structure.is_ok(), "get_table_structure failed: {:?}", structure.err());

        // get_table_data
        let data = driver.get_table_data(
            db_name.clone(), table_name.to_string(),
            1, 20, None, None, None, None,
        ).await;
        assert!(data.is_ok(), "get_table_data failed: {:?}", data.err());

        // get_table_ddl
        let ddl = driver.get_table_ddl(db_name.clone(), table_name.to_string()).await;
        assert!(ddl.is_ok(), "get_table_ddl failed: {:?}", ddl.err());

        // get_schema_overview
        let overview = driver.get_schema_overview(Some(db_name.clone())).await;
        assert!(overview.is_ok(), "get_schema_overview failed: {:?}", overview.err());

        // cleanup
        let _ = driver.execute_query(format!("DROP TABLE {}", table_name)).await;
        println!("{DB_NAME} integration test passed");
    }
}
```

---

**CREATE** `src-tauri/tests/{DRIVER_ID}_command_integration.rs`

Follow the pattern of `src-tauri/tests/mysql_command_integration.rs`. Key points:
- Import `{DRIVER_ID}_context` with `#[path = "common/{DRIVER_ID}_context.rs"]`
- Use `connection::test_connection_ephemeral`, `metadata::*`, `query::execute_by_conn_direct`
- Test: ephemeral connect, list databases, list tables, execute query, get table structure

---

### Step 8 — Update i18n (file-based drivers only)

**Only if `IS_FILE_BASED == true`**, update all three locale files:
- `src/lib/i18n/locales/en.ts`
- `src/lib/i18n/locales/zh.ts`
- `src/lib/i18n/locales/ja.ts`

Look for the `sqliteFilePath` / `duckdbFilePath` section and add analogous entries:
- `en.ts`: `{DRIVER_ID}FilePath: "{DB_NAME} File"`, `{DRIVER_ID}Path: "/path/to/db.{DRIVER_ID}"`
- `zh.ts`: appropriate Chinese translation
- `ja.ts`: appropriate Japanese translation

---

### Step 9 — Update test integration script

**UPDATE** `scripts/test-integration.sh`

Add a named case for the new driver and include it in the `all)` block. Follow the exact pattern of existing cases in the file.

---

## Final Verification

Run these three checks and fix any errors before declaring done:

```bash
bun run typecheck
bun run lint
cargo check --manifest-path src-tauri/Cargo.toml
```

Report the result of each check to the user.

---

## Common Pitfalls

- **Don't forget `ssh.rs`** — missing a case means SSH tunnel uses wrong default port silently
- **Error prefixes are parsed by the frontend** — must use `[CONN_FAILED]`, `[QUERY_ERROR]`, `[VALIDATION_ERROR]`, `[NOT_SUPPORTED]` exactly
- **`execute_query_with_id`** — do NOT override this unless the database actually supports query cancellation; the trait provides a sensible default
- **`get_table_data` vs `get_table_data_chunk`** — both must be implemented; they share the same signature; implement identically unless the driver has streaming support
- **Port type** — `ConnectionForm` uses `i64` for port; cast to `u16` with `form.port.unwrap_or({DEFAULT_PORT}) as u16` after validation
- **`strip_trailing_statement_terminator`** — call `super::strip_trailing_statement_terminator(&sql)` before executing user-provided SQL

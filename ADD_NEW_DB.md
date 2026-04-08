# ADD_NEW_DB — DbPaw 新增数据库驱动操作手册

本文档记录新增一个数据库驱动类型时需要修改的全部文件，包含精确路径、行号和改法。

---

## 术语约定

- `{driver}` — 小写 driver ID，与前端 `DRIVER_IDS` 保持一致（例：`oracle`）
- `{DriverName}` — PascalCase（例：`Oracle`）
- `network` 型 — 通过 host:port 连接（postgres、mysql、mssql、clickhouse 等）
- `file` 型 — 通过本地文件路径连接（sqlite、duckdb）

---

## Step 1：创建 Rust Driver 文件

**文件：** `src-tauri/src/db/drivers/{driver}.rs`（新建）

参考模板选择：
- **PostgreSQL-like**（独立 schema、SSl CA、sqlx）→ 复制 `postgres.rs`
- **MySQL-like**（共享驱动、MySQL 协议）→ 复制 `mysql.rs`
- **HTTP API 型**（ClickHouse-like）→ 复制 `clickhouse.rs`
- **嵌入式/文件型**（无网络连接）→ 复制 `duckdb.rs`

必须实现 `DatabaseDriver` trait 的全部方法（定义见 `src-tauri/src/db/drivers/mod.rs:64-121`）：

```
test_connection, get_databases, get_table_names, get_table_structure,
get_table_info, get_table_data, execute_query, cancel_query,
get_schema_names, get_table_ddl, get_schema_overview, close
```

---

## Step 2：注册到 `drivers/mod.rs`

**文件：** `src-tauri/src/db/drivers/mod.rs`

### 2a. 顶部 use 语句（第 1-6 行附近）

在现有的 `use self::...` 行中加入：

```rust
use self::{driver}::{DriverName}Driver;
```

### 2b. mod 声明（第 13-18 行附近）

在现有的 `pub mod ...` 行中加入：

```rust
pub mod {driver};
```

### 2c. `connect()` match 分支（第 133-163 行）

在 `_ =>` 分支前加入：

```rust
"{driver}" => {
    let driver = {DriverName}Driver::connect(form).await?;
    Ok(Box::new(driver) as Box<dyn DatabaseDriver>)
}
```

**注意（MySQL family）：** 如果是 MySQL 协议兼容的变体（如 PolarDB），可以复用 `MysqlDriver`，直接在第 139 行的现有 arm 里加 `| "{driver}"`：

```rust
"mysql" | "tidb" | "mariadb" | "{driver}" => {
```

---

## Step 3：SSH 默认端口（仅 network 型）

**文件：** `src-tauri/src/ssh.rs`，第 48-54 行

在 `_ => 5432` 之前加入一行：

```rust
"{driver}" => {PORT},
```

**示例（当前内容）：**

```rust
let default_port: i64 = match config.driver.to_ascii_lowercase().as_str() {
    "mysql" => 3306,
    "mssql" => 1433,
    "clickhouse" => 9000,
    "sqlite" => 0,
    // ← 在这里加新 driver
    _ => 5432, // postgres and unknown drivers
};
```

**注意：**
- file 型 driver 不走 SSH 隧道的端口逻辑，但若要防止 fallback 到 5432，可加 `"sqlite" => 0,` 同款的占位。
- 端口 0 不会通过第 56-58 行的校验（`1..=65535`），file 型 driver 传 `port=None` 即可，无需额外处理。
- 忘记加这一行不会 crash，但 SSH 连接会用 5432 作为默认端口，导致隧道目标端口错误。

---

## Step 4：连接表单校验

**文件：** `src-tauri/src/connection_input/mod.rs`

### 4a. network 型 — 无需修改

第 69-71 行的 `else if form.host.is_none()` 已覆盖所有 network 型 driver。

### 4b. file 型 — 第 65 行

在现有的 `matches!` 中加入新 driver：

```rust
if matches!(driver.as_str(), "sqlite" | "duckdb" | "{driver}") {
```

### 4c. MySQL family（支持 host:port 嵌入语法）— 第 57 行

如果新 driver 允许 `host:port` 写法（如 `localhost:3307`），在现有 `matches!` 中加入：

```rust
if matches!(driver.as_str(), "mysql" | "mariadb" | "tidb" | "{driver}") {
```

---

## Step 5：import/export 事务语法（如支持 import）

**文件：** `src-tauri/src/commands/transfer.rs`，第 615-628 行（`import_transaction_sql` 函数）

根据 driver 支持的事务语法加入 match arm：

```rust
// BEGIN / COMMIT / ROLLBACK（与 postgres 相同）
"postgres" | "sqlite" | "duckdb" | "{driver}" => Ok(("BEGIN", "COMMIT", "ROLLBACK")),

// 或 START TRANSACTION（MySQL 系）
"mysql" | "mariadb" | "tidb" | "{driver}" => Ok(("START TRANSACTION", "COMMIT", "ROLLBACK")),

// 不支持 import
"{driver}" => Err("[UNSUPPORTED] Driver {driver} is read-only in this import flow".to_string()),
```

---

## Step 6：create_database 支持（如支持）

**文件：** `src-tauri/src/commands/connection.rs`

两处需要改（`create_database_by_id` 约第 262 行，`create_database_by_id_direct` 约第 343 行）：

**6a. 从"不支持"排除列表移除**（file 型专用黑名单，network 型无需改）：

```rust
// 第 262、343 行：
if matches!(driver.as_str(), "sqlite" | "duckdb") {  // 不要在此加 network 型 driver
```

**6b. 在 match 中加入建库 SQL**（第 269-319、350-400 行）：

```rust
"{driver}" => {
    let sql = format!("CREATE DATABASE {}", quote_ident(&db_name));
    super::execute_with_retry(&state, id, None, |driver| {
        let sql_clone = sql.clone();
        async move { driver.execute_query(sql_clone).await.map(|_| ()) }
    })
    .await
}
```

---

## Step 7：前端 driver-registry.tsx（必改）

**文件：** `src/lib/driver-registry.tsx`

### 7a. DRIVER_IDS（第 16-25 行）

在 `as const` 数组中加入新 driver ID：

```typescript
const DRIVER_IDS = [
  "postgres",
  "mysql",
  // ...
  "{driver}",   // ← 加在这里
] as const;
```

### 7b. DRIVER_REGISTRY（第 55-152 行）

在数组末尾（`];` 之前）加入一条记录：

```typescript
{
  id: "{driver}",
  label: "DisplayName",
  defaultPort: 1234,        // file 型填 null
  isFileBased: false,       // file 型填 true
  isMysqlFamily: false,     // MySQL 协议兼容时填 true
  supportsSSLCA: false,     // 支持 SSL CA 证书验证时填 true（需后端也支持）
  supportsSchemaBrowsing: false,   // 支持 schema 列表时填 true
  supportsCreateDatabase: true,    // 支持 CREATE DATABASE 时填 true
  importCapability: "supported",   // "supported" | "read_only_not_supported" | "unsupported"
  icon: () => renderSimpleIcon(si{DriverName}),  // 或 <Database className="w-4 h-4" />
},
```

**图标规则：**
- 优先从 `simple-icons` 导入：`import { si{DriverName} } from "simple-icons";`
- 无 simple-icons 时用 `<Server className="w-4 h-4" />`（通用服务器图标）或 `<Database className="w-4 h-4" />`

**这一个文件改完，以下前端逻辑自动生效（无需再改）：**
- `src/services/api.ts` — `Driver` 类型
- `src/lib/connection-form/rules.ts` — MySQL family / file-based 数组
- `src/components/business/Sidebar/connection-list/helpers.tsx` — 图标映射
- `src/components/business/Sidebar/ConnectionList.tsx` — SelectItem、默认 port、SSL/file 条件渲染

---

## Step 8：i18n（仅 file 型 driver）

**文件：** `src/lib/i18n/locales/en.ts`、`zh.ts`、`ja.ts`

file 型 driver 需要在三个 locale 文件里加"文件路径"标签和占位符。

在 `en.ts` 中搜索 `duckdbFilePath`（约第 221 行）附近加入：

```typescript
{driver}FilePath: "{DriverName} File Path",
{driver}Path: "/path/to/db.{driver}",
```

zh.ts 和 ja.ts 同理加入对应翻译。

---

## Step 9：Cargo.toml 依赖

**文件：** `src-tauri/Cargo.toml`

按驱动依赖类型选择：

| 类型 | 做法 |
|------|------|
| 使用 sqlx（postgres/mysql 系）| 在 sqlx `features` 列表加 driver 名（第 34 行） |
| 独立 crate（如 DuckDB）| 加一行 `{driver} = { version = "x.y", features = [...] }` |
| HTTP 协议（如 ClickHouse）| 加 HTTP client 依赖（参考 clickhouse.rs 的 import） |
| 微软协议（MSSQL）| 使用 `tiberius`（已有，无需重复加） |

---

## Step 10：集成测试骨架

**新建 3 个文件**（参考同类 driver 复制修改）：

```
src-tauri/tests/common/{driver}_context.rs    ← testcontainers 容器配置
src-tauri/tests/{driver}_integration.rs       ← DatabaseDriver trait 方法直接测试
src-tauri/tests/{driver}_command_integration.rs  ← Tauri command 层测试
```

在 `src-tauri/tests/common/mod.rs` 中加入模块声明：

```rust
pub mod {driver}_context;
```

更新 `scripts/test-integration.sh` 加入新 driver（搜索其他 driver 名的赋值行）。

**可选：** 如果 driver 支持多语句事务，创建：

```
src-tauri/tests/{driver}_stateful_command_integration.rs
```

参考 `postgres_stateful_command_integration.rs`。

---

## 验证 Checklist

每次新增 driver 后执行：

```bash
# 必须全部通过
bun run typecheck
bun run lint
cargo check --manifest-path src-tauri/Cargo.toml

# 有条件时执行
bun run test:unit
IT_DB={driver} bun run test:integration   # 需要 Docker
```

快速一键验证：

```bash
bun run test:smoke   # typecheck + lint + unit tests
```

---

## 常见陷阱

| 陷阱 | 后果 | 解法 |
|------|------|------|
| 忘记改 `ssh.rs` 默认端口 | SSH 隧道目标端口错误（fallback 到 5432） | Step 3 |
| file 型 driver 未加入 `connection_input` 的 matches! | 校验报"host cannot be empty"而不是"file path" | Step 4b |
| 前端 `DRIVER_IDS` 加了但 `DRIVER_REGISTRY` 没加 | TypeScript 编译报错，图标/port 逻辑异常 | Step 7 |
| 图标使用了不存在的 simple-icons 导出名 | 前端运行时崩溃 | 验证 `si{DriverName}` 是否存在于 `simple-icons` 包 |
| 忘记改 `import_transaction_sql` | import 功能对新 driver 返回"不支持"或使用错误事务语法 | Step 5 |
| MySQL family 新 driver 未加入 `connection_input` 的 mysql arm | `host:port` 嵌入写法不被解析 | Step 4c |
| i18n 只改了 en.ts | 中文/日文界面显示 key 字符串而非翻译文本 | Step 8 三个文件都要改 |

---

## 文件改动汇总

| 文件 | 类型 | 条件 |
|------|------|------|
| `src-tauri/src/db/drivers/{driver}.rs` | 新建 | 必须 |
| `src-tauri/src/db/drivers/mod.rs` | 改 | 必须（3处） |
| `src-tauri/src/ssh.rs` | 改 | network 型 |
| `src-tauri/src/connection_input/mod.rs` | 改 | file 型或 MySQL family |
| `src-tauri/src/commands/transfer.rs` | 改 | 支持 import 时 |
| `src-tauri/src/commands/connection.rs` | 改 | 支持 create database 时 |
| `src-tauri/Cargo.toml` | 改 | 必须 |
| `src/lib/driver-registry.tsx` | 改 | 必须（前端唯一入口） |
| `src/lib/i18n/locales/en.ts` | 改 | file 型 |
| `src/lib/i18n/locales/zh.ts` | 改 | file 型 |
| `src/lib/i18n/locales/ja.ts` | 改 | file 型 |
| `src-tauri/tests/common/{driver}_context.rs` | 新建 | 集成测试 |
| `src-tauri/tests/{driver}_integration.rs` | 新建 | 集成测试 |
| `src-tauri/tests/{driver}_command_integration.rs` | 新建 | 集成测试 |
| `src-tauri/tests/common/mod.rs` | 改 | 集成测试 |
| `scripts/test-integration.sh` | 改 | 集成测试 |

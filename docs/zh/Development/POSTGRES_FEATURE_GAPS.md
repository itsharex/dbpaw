# PostgreSQL 功能缺口分析

> 评估日期：2026-04-30
> 评估范围：PostgreSQL 连接、对象浏览、查询执行、元数据/DDL、函数/存储过程、前端体验

---

## 一、结论

PostgreSQL 的核心连接、表/视图浏览、表数据分页、建表/改表、索引管理、SQL 编辑、导入导出已有完整覆盖。类型系统映射非常全面（含数组、JSONB、几何、时间类型、高精度数值等），29 个集成测试覆盖了主要场景。

但从 PostgreSQL 用户的完整工作流看，仍有以下缺口：

1. **DDL 生成不完整** — 只有基本 `CREATE TABLE`，缺少约束、索引、注释，用户复制 DDL 建表会丢失关键信息。（P0-1）
2. **`get_table_structure()` 数据不完整** — `primary_key` 始终为 `false`，`comment` 始终为 `None`。（P1-1, P1-2）
3. **无服务器信息面板 / EXPLAIN ANALYZE / 专用类型查看器** — 相比 Redis 的 `RedisServerInfoView`，PostgreSQL 缺少数据库级概览和性能工具。（P2）

---

## 二、当前覆盖情况

| 领域 | 状态 | 说明 |
|------|------|------|
| 基础连接 | 已支持 | 用户名/密码认证，端口默认 5432 |
| SSL/TLS | 已支持 | 支持 SSL + CA 证书（verify_ca 模式） |
| SSH 隧道 | 已支持 | 复用通用 SSH 隧道能力 |
| 数据库列表 | 已支持 | 查询 `pg_database`，过滤模板数据库 |
| 创建数据库 | 已支持 | 支持 encoding / lc_collate / lc_ctype 选项 |
| Schema 浏览 | 已支持 | 按 schema 分组显示表，懒加载列信息 |
| 表/视图浏览 | 已支持 | 查询 `information_schema.tables`，支持 schema 过滤 |
| 函数/存储过程浏览 | 已支持 | 查询 `pg_proc` + `pg_namespace`，按 `prokind` 区分 function/procedure，排除系统 schema |
| 函数/存储过程 DDL | 已支持 | `pg_get_functiondef(oid)` 获取完整 DDL，侧边栏显示 Procedures/Functions 节点 |
| 表结构 | 已支持 | 列信息完整，`primary_key` 和 `comment` 字段正确返回 (2026-04-30 修复) |
| 表元数据 | 已支持 | 主键、索引、外键、列注释（通过 `get_table_metadata()`） |
| 表 DDL | 已支持 | 完整 DDL：列+PK+UNIQUE+CHECK+FK+索引+表/列注释+IDENTITY (2026-04-30 重写) |
| 表数据分页 | 已支持 | `OFFSET ... LIMIT`，支持排序和过滤 |
| 查询执行 | 已支持 | 多语句拆分、dollar-quoting、SELECT 结构化结果、DML 返回 affected rows |
| 建表/改表 | 大部分支持 | ADD/DROP/RENAME/TYPE/NOT NULL/DEFAULT/COMMENT ON COLUMN |
| 索引管理 | 已支持 | btree/hash/gist/gin/brin、CONCURRENTLY、IF NOT EXISTS |
| 导入导出 | 已支持 | SQL 文件导入（含 dollar-quoting）+ CSV/JSON/SQL 多格式导出 |
| 服务器信息 | **未实现** | 无 `pg_stat_*`、`pg_settings` 等 UI |
| 执行计划 | **未实现** | 无 EXPLAIN ANALYZE 集成 |

---

## 三、问题分级

### P0：优先修复，直接影响 PostgreSQL 日常使用

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | 表 DDL 生成不完整 | `get_table_ddl()` 只有基本 CREATE TABLE，缺主键/外键/唯一/检查约束、索引、表注释。用户复制 DDL 建表会丢失关键信息 | 参考 MSSQL 的 DDL 生成逻辑，补齐约束和索引 |

### P0 已完成

- ~~P0-1: 前端侧边栏不加载 PostgreSQL 函数/存储过程~~ ✅ (2026-04-30)
- ~~P0-2: 后端 `list_routines()` / `get_routine_ddl()` 未实现~~ ✅ (2026-04-30)
- ~~P0-3: 表 DDL 生成不完整~~ ✅ (2026-04-30) — 完整 DDL 含 PK/UNIQUE/CHECK/FK/索引/注释/identity

### P1：重要，影响数据完整性和专业用户体验

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| ~~1~~ | ~~`get_table_structure()` 的 `primary_key` 始终为 `false`~~ | ✅ 已修复 (2026-04-30) | 查询 `pg_index` 设置 `primary_key` 字段 |
| ~~2~~ | ~~`get_table_structure()` 缺少列注释~~ | ✅ 已修复 (2026-04-30) | 查询 `pg_description` 补充注释 |
| ~~3~~ | ~~DDL 不包含表注释~~ | ✅ 已修复 (2026-04-30) | 查询 `obj_description(oid, 'pg_class')` 并输出 `COMMENT ON TABLE` |

### P2：增强项，可在基础问题收敛后推进

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | 无 PostgreSQL 服务器信息面板 | Redis 有 `RedisServerInfoView`，PostgreSQL 没有 `pg_stat_activity`、`pg_settings`、`pg_stat_database` 等信息的 UI | 新增 ServerInfo 组件，展示活跃连接、配置参数、数据库统计 |
| 2 | 无 EXPLAIN ANALYZE 集成 | 用户需要手动执行 EXPLAIN 并阅读文本输出 | SQL 编辑器增加"执行计划"按钮，解析 `EXPLAIN (ANALYZE, FORMAT JSON)` 结果并可视化 |
| 3 | 无专用类型查看器 | JSONB、Array、几何类型等只能通过通用 `ComplexValueViewer` 以 JSON 格式展示 | 为 JSONB 提供树形查看器，为 Array 提供表格查看器，为几何类型提供 Well-Known Text 展示 |
| 4 | 无行级编辑 API | 所有驱动统一缺失，行编辑必须手写 SQL | 通用能力，需整体规划 |

---

## 四、推荐实施路线

### ✅ 阶段 1：函数/存储过程支持（已完成 2026-04-30）

目标：让 PostgreSQL 的函数和存储过程在侧边栏可见，支持 DDL 查看。

完成内容：

1. ✅ 后端 `list_routines()`：查询 `pg_proc` + `pg_namespace`，按 `prokind` 区分 function/procedure
2. ✅ 后端 `get_routine_ddl()`：使用 `pg_get_functiondef(oid)` 获取完整 DDL
3. ✅ 前端 `DriverConfig` 新增 `supportsRoutines` 标志，解除 MSSQL 限制
4. ✅ `RoutineMetadataView` 组件已支持渲染 DDL 文本
5. ✅ 集成测试 `test_postgres_routines` 覆盖 function 和 procedure 两种类型
6. ✅ 前端单测 `supportsRoutines` 覆盖全部 13 个 driver

### 阶段 2：完整化 Table DDL ✅ (2026-04-30)

目标：让 PostgreSQL 的 "查看 DDL" 从"仅参考"提升到"可复制重建常见表结构"。

完成内容：

1. ✅ `load_pg_columns()` — 列信息（类型、nullable、default、identity）
2. ✅ `load_pg_constraints()` — 查询 `pg_constraint` 获取 PK/UNIQUE/CHECK/FK
3. ✅ `load_pg_indexes()` — 查询 `pg_index` 获取非约束索引（含 `pg_get_indexdef` 完整语句）
4. ✅ `load_pg_comments()` — 查询 `pg_description` 获取表和列注释
5. ✅ `render_pg_create_table_ddl()` — 组装完整 DDL（含约束、索引、注释）
6. ✅ `get_table_ddl()` 重写为调用上述分层辅助方法
7. ✅ 支持 IDENTITY 列（GENERATED ALWAYS/BY DEFAULT AS IDENTITY）
8. ✅ 集成测试覆盖：PK、UNIQUE、CHECK、FK、索引、注释、identity 列

验收标准：

- ✅ 常见业务表的主键、唯一约束、默认约束、check、外键、索引可还原
- ✅ 注释不丢失
- ✅ DDL 输出顺序稳定

### 阶段 3：get_table_structure 数据修复 ✅ (2026-04-30)

目标：让 `get_table_structure()` 返回准确的主键和注释信息。

完成内容：

1. ✅ 查询 `pg_index` 设置 `primary_key` 字段
2. ✅ 查询 `pg_description` 补充 `comment` 字段
3. ✅ 集成测试验证主键和注释字段

验收标准：

- ✅ `get_table_structure()` 返回的列信息中 `primary_key` 正确标记
- ✅ `comment` 字段不再为 `None`

### 阶段 4：服务器信息与性能工具（P2，按需排期）

目标：提供 PostgreSQL 数据库级概览和性能分析能力。

任务：

1. 服务器信息面板：
   - `pg_stat_activity` — 活跃连接和查询
   - `pg_settings` — 配置参数
   - `pg_stat_database` — 数据库级统计
   - `pg_stat_user_tables` — 表级统计（行数、扫描次数等）
2. EXPLAIN ANALYZE 集成：
   - SQL 编辑器增加"执行计划"按钮
   - 执行 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
   - 解析 JSON 结果并以树形/表格可视化
3. 专用类型查看器：
   - JSONB → 树形查看器
   - Array → 表格查看器
   - 几何类型 → Well-Known Text 展示

验收标准：

- 服务器信息面板可查看活跃连接、配置、统计
- EXPLAIN ANALYZE 结果可视化展示
- JSONB/Array 有更好的展示体验

---

## 五、技术注意事项

### 1. PostgreSQL 函数 vs 存储过程

PostgreSQL 11 之前只有 `FUNCTION`，11+ 引入了 `PROCEDURE`（支持事务控制）。查询时需区分：

```sql
-- 函数
SELECT proname, pg_get_functiondef(oid) 
FROM pg_proc 
WHERE pronamespace = 'schema_oid'::regnamespace 
  AND prokind = 'f';

-- 存储过程 (PG 11+)
SELECT proname, pg_get_functiondef(oid) 
FROM pg_proc 
WHERE pronamespace = 'schema_oid'::regnamespace 
  AND prokind = 'p';
```

`prokind` 取值：`f` = function, `p` = procedure, `a` = aggregate, `w` = window。

对于 PG 11 之前的版本，所有 routines 都是 function，前端应统一显示为 Functions。

### 2. DDL 生成应复用元数据查询

MSSQL 的 DDL 已实现分层加载（`load_mssql_columns` / `load_mssql_key_constraints` / ...），PostgreSQL 应采用类似模式：

- `load_pg_columns(schema, table)` — 列信息 + 类型 + nullable + default
- `load_pg_constraints(schema, table)` — PK/UNIQUE/CHECK/FK 约束
- `load_pg_indexes(schema, table)` — 索引
- `load_pg_comments(schema, table)` — 表和列注释
- `render_pg_create_table_ddl(...)` — 组装完整 DDL

`get_table_metadata()` 已有部分查询，应复用而非重复。

### 3. 标识符引用一致性

PostgreSQL 使用双引号 `"identifier"`，代码中已正确实现。DDL 生成时需确保：

- 保留字（如 `user`、`order`、`group`）必须引用
- 含大写字母或特殊字符的标识符必须引用
- Schema 限定使用 `"schema"."table"` 格式

### 4. 侧边栏对象树保持简洁

建议维持默认简洁树：

```
Connection
└── Database
    └── Schema
        ├── Tables
        ├── Procedures  (PG 11+)
        └── Functions
```

高级对象（Trigger、Sequence、Type、Extension、Foreign Table 等）可作为后续按需加载节点。

---

## 六、关键文件参考

| 文件 | 作用 |
|------|------|
| `src-tauri/src/db/drivers/postgres.rs` | PostgreSQL 驱动主实现（1657 行） |
| `src-tauri/src/db/drivers/mod.rs` | `DatabaseDriver` trait 定义 |
| `src-tauri/src/db/drivers/mssql.rs` | MSSQL 驱动，DDL / routine 实现参考 |
| `src-tauri/src/db/drivers/mysql.rs` | MySQL 驱动，`get_table_structure` 主键实现参考 |
| `src-tauri/src/commands/metadata.rs` | 元数据命令入口 |
| `src-tauri/src/commands/query.rs` | 查询执行命令 |
| `src/components/business/Sidebar/ConnectionList.tsx` | 侧边栏连接列表（`fetchSqlRoutinesAsRoutineInfo` ~L1527） |
| `src/components/business/Metadata/RoutineMetadataView.tsx` | Routine DDL 查看组件 |
| `src/lib/sql-gen/createTable.ts` | CREATE TABLE SQL 生成 |
| `src/lib/sql-gen/alterTable.ts` | ALTER TABLE SQL 生成 |
| `src/lib/sql-gen/manageIndexes.ts` | 索引管理 SQL 生成 |
| `src-tauri/tests/postgres_integration.rs` | PostgreSQL 集成测试（18 个） |
| `src-tauri/tests/postgres_command_integration.rs` | PostgreSQL 命令层集成测试（11 个） |

---

## 七、与 SQL Server 实施经验的关系

SQL Server 的 P0 修复（2026-04-29）提供了可复用的经验：

1. **DDL 分层加载** — MSSQL 的 `load_mssql_*` 系列函数模式可直接借鉴到 PostgreSQL 的 `load_pg_*` 函数。
2. **Routine 支持** — MSSQL 的 `listRoutines` / `getRoutineDDL` 实现路径（查询系统表 → 返回定义文本）对 PostgreSQL 完全适用，只是系统表不同（`pg_proc` vs `sys.objects`）。
3. **集成测试模式** — 使用 testcontainers 启动 PostgreSQL 容器，与 MSSQL 的测试模式一致。
4. **前端组件复用** — `RoutineMetadataView` 已支持渲染 DDL 文本，只需确保 PostgreSQL 的 DDL 输出格式兼容。

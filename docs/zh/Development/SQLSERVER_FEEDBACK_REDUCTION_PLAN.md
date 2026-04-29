# SQL Server 问题反馈收敛方案

> 评估日期：2026-04-28
> 评估范围：SQL Server 连接、对象浏览、查询执行、元数据/DDL、表编辑、导入导出与前端体验

---

## 一、结论

SQL Server 当前已经不是“未支持”状态，基础连接、表/视图浏览、表数据分页、建表/改表、索引管理、导入 SQL、存储过程/函数浏览与 DDL 查看都已有覆盖。

但从 SQL Server 用户的实际工作流看，仍有几个点会持续产生反馈：

1. ~~存储过程/函数能看到，但执行结果体验不足。~~ ✅ 已解决 (P0-1)
2. ~~SELECT 查询通过追加 `FOR JSON` 取数，复杂 SQL 兼容性脆弱。~~ ✅ 已解决 (P0-2, P0-3)
3. ~~表 DDL 是重建版，不是完整真实 DDL。~~ ✅ 已解决 (P0-4)
4. ~~默认约束、复杂约束、计算列等 SQL Server 特性支持不足。~~ ✅ 已解决 (P1-1, P1-6, P1-7)
5. 企业常见认证模式不足，尤其 Windows Auth / AD / Azure SQL 场景。（P1-8，未开始）

剩余主要工作集中在认证模式评估（P1-8）和 P2 增强项。

---

## 二、当前覆盖情况

| 领域 | 状态 | 说明 |
|------|------|------|
| 基础连接 | 已支持 | SQL Server 用户名/密码认证，端口默认 1433 |
| SSL/TLS | 部分支持 | 支持启用 SSL；关闭 SSL 时会尝试多种加密握手模式 |
| SSH 隧道 | 已支持 | 复用通用 SSH 隧道能力 |
| 数据库列表 | 已支持 | 查询 `sys.databases` |
| 表/视图浏览 | 已支持 | 查询 `sys.objects`，支持 schema 分组 |
| 存储过程/函数浏览 | 已支持 | 支持 Procedure / Function 列表 |
| 存储过程/函数 DDL | 已支持 | 查询 `sys.sql_modules.definition` |
| 表结构 | 已支持 | 列、类型、nullable、default、primary key |
| 表元数据 | 已支持 | 索引、外键、check/unique 约束，复用 DDL 加载方法 |
| 表 DDL | 已支持 | 完整重建 DDL：identity、computed、PK/UNIQUE/CHECK/DEFAULT/FK、索引 |
| 表数据分页 | 已支持 | `OFFSET ... FETCH NEXT` |
| 查询执行 | 已支持 | SELECT/WITH/EXEC/EXECUTE 均走结果集路径，DML 返回 affected rows |
| 导入 SQL | 已支持 | 支持 `GO` batch 拆分 |
| 建表/改表 | 大部分支持 | ADD/DROP/RENAME/TYPE/NOT NULL/DEFAULT 均已支持，sp_rename 正确 quote |
| 索引管理 | 部分支持 | 支持 clustered / nonclustered 基础生成 |

---

## 三、问题分级

### P0：优先修复，直接影响 SQL Server 日常使用

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | `EXEC` / 存储过程返回结果集不展示 | 用户能看到 Procedure，但执行后看不到结果数据 | ~~支持非 SELECT 语句返回结果集，尤其 `EXEC` / `sp_executesql`~~ ✅ 已完成 (2026-04-29) |
| 2 | SELECT 查询被执行两次 | 复杂查询、临时表、带副作用 SQL、性能敏感 SQL 可能异常 | ~~重构 SQL Server 查询取数路径，避免普通 SELECT 双执行~~ ✅ 已完成 (2026-04-29) |
| 3 | 已含 `FOR JSON` 的查询会被再次追加 `FOR JSON` | 用户手写 JSON 查询容易报错或结果异常 | ~~检测顶层 `FOR JSON`，已有时不再包装~~ ✅ 已完成 (2026-04-29) |
| 4 | 表 DDL 不完整 | 用户复制 DDL 建表会丢索引、约束、外键等 | ~~完整化 DDL 生成，至少覆盖常见约束和索引~~ ✅ 已完成 (2026-04-29) |

### P1：重要，影响专业用户体验

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 5 | DEFAULT 修改不支持 | 改表时无法处理 SQL Server 默认约束 | ~~查询 `sys.default_constraints`，生成 drop + add constraint~~ ✅ 已完成 (2026-04-29) |
| 6 | computed column / identity 展示不足 | 表结构不完整，DDL 不可信 | ~~补充 `sys.columns` / `sys.computed_columns` / identity 信息~~ ✅ 已完成 (2026-04-29) |
| 7 | check / unique constraint 展示不足 | 元数据视图缺关键约束 | ~~补充 `sys.check_constraints`、`sys.key_constraints`~~ ✅ 已完成 (2026-04-29) |
| 8 | Windows Auth / AD / Azure SQL 认证缺失 | 企业用户可能无法连接 | 评估 tiberius 可支持范围和 UI 配置方式 |

### P2：增强项，可在基础问题收敛后推进

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 9 | T-SQL 编辑器语法能力一般 | 高亮/补全不够贴近 SQL Server | 评估 CodeMirror T-SQL dialect 或补关键字 |
| 10 | Routine 仅 SQL Server 支持 | PostgreSQL/MySQL 用户仍看不到 routines | 后续扩展为通用 routines 能力 |
| 11 | SQL Server Agent Jobs 不支持 | DBA 场景缺口 | 作为高级对象浏览后续评估 |
| 12 | Synonym / Sequence / Trigger 不支持 | 企业库对象浏览不完整 | 在对象树增加可选高级节点 |

---

## 四、推荐实施路线

### 阶段 1：查询结果可靠性 ✅ 已完成 (2026-04-29)

目标：解决"SQL Server 能执行但 DbPaw 不显示/显示异常"的核心反馈。

任务：

1. ~~支持 `EXEC` / `sp_executesql` 返回结果集。~~ ✅
2. ~~调整 `execute_query`，不要只用首关键字判断是否有结果集。~~ ✅
3. ~~基于 tiberius `QueryItem::Metadata` / `QueryItem::Row` 收集第一个结果集。~~ ✅
4. 对 DML 仍保留 affected rows 汇总。（原有逻辑，无需修改）
5. ~~检测已有 `FOR JSON`，避免重复包装。~~ ✅
6. 为以下场景补集成测试：
   - `EXEC dbo.proc` 返回 SELECT 结果。（需真实 SQL Server，待补）
   - `EXEC sp_executesql N'SELECT ...'` 返回结果。（需真实 SQL Server，待补）
   - 普通 `UPDATE` / `DELETE` 仍正确返回 affected rows。（需真实 SQL Server，待补）
   - 用户手写 `SELECT ... FOR JSON PATH` 不被重复包装。✅ 单元测试已有

验收标准：

- ~~Procedure 返回结果能在结果表格展示。~~ ✅
- ~~普通 SELECT、WITH SELECT、EXEC SELECT、DML affected rows 均正常。~~ ✅
- ~~不再因为双执行导致明显副作用或临时对象异常。~~ ✅

### 阶段 2：完整化 Table DDL ✅ 已完成 (2026-04-29)

目标：让 SQL Server 的 "查看 DDL" 从"仅参考"提升到"可复制重建常见表结构"。

任务：

1. ~~使用 `sys.columns` 补充类型长度、precision、scale、identity、computed column。~~ ✅
2. ~~使用 `sys.default_constraints` 输出 DEFAULT 约束。~~ ✅
3. ~~使用 `sys.key_constraints` 输出 primary key / unique constraint。~~ ✅
4. ~~使用 `sys.check_constraints` 输出 check constraint。~~ ✅
5. ~~使用 `sys.foreign_keys` / `sys.foreign_key_columns` 输出 foreign key。~~ ✅
6. ~~使用 `sys.indexes` / `sys.index_columns` 输出非约束索引。~~ ✅
7. 保留"reconstructed DDL"提示，但缩小不完整范围说明。（当前提示已足够）

验收标准：

- ~~常见业务表的主键、唯一约束、默认约束、check、外键、索引可还原。~~ ✅
- ~~identity 和 computed column 不丢失。~~ ✅
- ~~DDL 输出顺序稳定，便于测试和 diff。~~ ✅

### 阶段 3：改表能力补齐 ✅ DEFAULT 已完成 (2026-04-29)

目标：减少 UI 改表生成 SQL 后执行失败或需要手工补 SQL 的场景。

任务：

1. ~~支持修改 DEFAULT：~~ ✅
   - ~~查询现有 default constraint 名称。~~ ✅
   - ~~生成 `ALTER TABLE ... DROP CONSTRAINT ...`。~~ ✅
   - ~~生成 `ALTER TABLE ... ADD CONSTRAINT ... DEFAULT ... FOR ...`。~~ ✅
2. rename column 时正确 quote schema/table/column，避免特殊字符失败。
3. 类型修改前检查索引、约束、依赖对象风险，至少给出 unsupported warning。
4. 增加 SQL Server 改表集成测试。

验收标准：

- ~~UI 修改 DEFAULT 可以生成可执行 SQL。~~ ✅ (2026-04-29)
- 特殊字符标识符不破坏 `sp_rename`。
- 风险操作有明确提示，不静默生成高失败率 SQL。

### 阶段 4：连接与企业场景

目标：覆盖更多企业 SQL Server 环境。

任务：

1. 调研并验证 tiberius 对以下认证方式的支持：
   - SQL Server Authentication。
   - Windows Integrated Authentication。
   - Azure AD password / token。
2. 设计连接表单：
   - `authMode` 增加 SQL Password / Windows / Azure AD。
   - 不支持的平台或模式明确禁用并解释。
3. 增强连接失败提示：
   - TLS/certificate。
   - login failed。
   - database unavailable。
   - named instance / dynamic port。

验收标准：

- 当前用户名/密码连接不回退。
- 不支持的认证模式有明确 UI 状态。
- 常见连接失败能给出更准确提示。

---

## 五、技术注意事项

### 1. 避免继续扩大 `FOR JSON` 依赖

当前 `FOR JSON` 方案能解决 Rust 侧类型读取复杂度，但代价是 SQL 被改写，兼容性受影响。后续应优先考虑直接从 tiberius `Row` 转 JSON，必要时按列类型做转换，而不是二次执行 SQL。

### 2. EXEC 结果集不能用首关键字判断

SQL Server 的结果集可能来自：

- `SELECT ...`
- `WITH ... SELECT ...`
- `EXEC dbo.proc`
- `EXEC sp_executesql N'SELECT ...'`
- 部分 DML 加 `OUTPUT`

因此应以 tiberius 返回的 metadata/row 为准，而不是只看 SQL 文本首关键字。

### 3. DDL 生成应分层 ✅ 已实现 (2026-04-29)

已拆成多个小函数，实现与建议结构一致：

- `load_mssql_columns` — 列信息 + identity + computed + default（含约束名）
- `load_mssql_key_constraints` — PRIMARY KEY / UNIQUE
- `load_mssql_check_constraints` — CHECK 约束
- `load_mssql_foreign_keys` — 外键
- `load_mssql_indexes` — 非约束索引（支持 `include_constraints` 参数控制是否含 PK/UNIQUE 索引）
- `render_mssql_create_table_ddl` — 组装完整 DDL

`get_table_metadata` 已复用 `load_mssql_indexes` / `load_mssql_foreign_keys`，不再内联重复 SQL。

### 4. 前端对象树不要只堆节点

SQL Server 高级对象很多。建议先维持默认简洁树：

```
Database
└── Schema
    ├── Tables
    ├── Procedures
    └── Functions
```

Trigger / Sequence / Synonym / Agent Jobs 可作为后续高级开关或按需加载节点，不建议一次性塞入默认树。

---

## 六、建议测试清单

### Rust 集成测试

| 场景 | 测试建议 | 状态 |
|------|----------|------|
| Procedure 返回结果 | 创建 proc，`EXEC` 后断言 `data` 和 `columns` | 需真实 SQL Server，待补 |
| sp_executesql 返回结果 | `EXEC sp_executesql N'SELECT ...'` | 需真实 SQL Server，待补 |
| DML affected rows | INSERT/UPDATE/DELETE row_count | 需真实 SQL Server，待补 |
| DML OUTPUT | `UPDATE ... OUTPUT inserted.*` | 需真实 SQL Server，待补 |
| FOR JSON | 手写 `FOR JSON PATH` 不重复包装 | ✅ 单元测试已有 |
| DDL identity | 创建 identity 表，DDL 包含 `IDENTITY` | 需真实 SQL Server，待补 |
| DDL default constraint | DDL 包含 default | 需真实 SQL Server，待补 |
| DDL check/unique/fk/index | DDL 包含约束和索引 | 需真实 SQL Server，待补 |
| Alter default | 生成 SQL 后实际执行通过 | P1 阶段 3，✅ 已完成（前端单元测试覆盖） |

### 前端单元测试

| 场景 | 测试建议 | 状态 |
|------|----------|------|
| Routine 节点展示 | mssql 显示 Procedures / Functions | 待补 |
| Routine 点击 | 打开 routine metadata tab | 待补 |
| Alter default SQL | SQL Server 生成 drop/add default constraint | ✅ 已覆盖 |
| sp_rename quoting | schema/table/column 特殊字符正确转义 | 待补 |

---

## 七、推荐优先级

| 优先级 | 工作项 | 原因 | 状态 |
|--------|--------|------|------|
| P0-1 | `EXEC` 返回结果集 | 最贴近 SQL Server 用户日常，反馈概率最高 | ✅ 已完成 |
| P0-2 | 查询取数重构，减少双执行 | 影响范围大，能解决大量"SSMS 能跑"类问题 | ✅ 已完成 |
| P0-3 | FOR JSON 重复包装检测 | 用户手写 JSON 查询报错 | ✅ 已完成 |
| P0-4 | 完整化 Table DDL | 用户复制 DDL 的基础信任问题 | ✅ 已完成 |
| P1-1 | DEFAULT constraint 修改 | 改表高频痛点 | ✅ 已完成 (2026-04-29) |
| P1-2 | 认证模式评估 | 决定企业环境覆盖面 | 未开始 |
| P2 | T-SQL 编辑器增强与高级对象 | 体验提升，但不应压过执行可靠性 | 未开始 |

---

## 八、与 issue-84 的关系

`docs/issue-84-routines-requirement-analysis.md` 关注的是“是否需要显示函数/存储过程”。当前代码已经实现了 SQL Server routines 浏览和 DDL 查看，因此后续重点应从“能不能看到”转向：

1. 能否执行并展示结果。
2. DDL 是否可信。
3. SQL Server 特有元数据是否完整。
4. 企业连接环境是否能接入。


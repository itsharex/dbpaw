# 创建连接两阶段改造计划

## Summary

将当前“新建数据库连接”的单页表单改为两阶段流程：

1. 先选择数据库类型。
2. 再根据数据库类型填写对应连接参数。

目标是让 MySQL、PostgreSQL、SQLite/DuckDB、Redis 等差异明显的连接类型在 UI 上更清晰，减少用户在不相关字段中的困惑，并为后续非 SQL 数据源扩展留出结构空间。

## Key Changes

- 新建连接弹窗增加 `createStep: "type" | "details"` 状态。
- `dialogMode === "create"` 时启用两阶段流程；`dialogMode === "edit"` 时直接进入参数编辑页。
- 第一阶段使用 `DRIVER_REGISTRY` 渲染数据库类型卡片，展示：
  - 数据库图标
  - 数据库名称
  - 类型标签，例如 SQL、Key-Value、File-based
  - 可选能力提示，例如默认端口、测试中、只读、文件型
- 第二阶段复用现有连接表单，但按数据库类型进一步隐藏不相关字段。
- 选择数据库类型后，初始化该类型的默认表单，避免从其他类型残留无关字段。

## Implementation Changes

- 在 `ConnectionList.tsx` 中拆分创建弹窗内容：
  - `type` 阶段：数据库类型选择页。
  - `details` 阶段：连接参数页。
- 使用 `DRIVER_REGISTRY` 作为类型选择数据源，复用已有图标配置。
- 保持编辑连接行为稳定：
  - 编辑连接不展示第一阶段。
  - 编辑页顶部展示当前数据库类型和图标。
  - 暂不支持在编辑时切换 driver，避免字段语义混乱。
- 扩展连接表单规则能力：
  - 保留现有 `isFileBasedDriver`、`requiresUsername`、`requiresPasswordOnCreate`。
  - 增加更明确的表单能力判断，例如是否展示 host/port、username、database、schema、SSL、SSH。
- Redis 表单单独收敛：
  - 不展示 SQL 语义的 `schema`。
  - `username` 不作为必填。
  - `password` 可选。
  - `database` 后续如需展示，应使用 Redis database index 语义，不复用 SQL 文案。

## UI Behavior

- 点击“新增连接”后先进入数据库类型选择页。
- 用户选择类型后进入参数填写页。
- 参数页顶部显示所选数据库类型图标和名称，并提供“返回选择类型”按钮。
- SQLite/DuckDB 只展示文件路径和相关可选密码字段。
- Redis 只展示 Redis 需要的网络连接字段。
- SQL 网络型数据库展示 host、port、username、password、database/schema、SSL、SSH 等字段。
- “测试连接”和“连接/保存”按钮只在参数填写页展示。

## Test Plan

- 单元测试：
  - `DRIVER_REGISTRY` 中所有 driver 都能渲染类型选择卡片。
  - 不同 driver 的默认端口初始化正确。
  - Redis 不要求 username/password。
  - SQLite/DuckDB 要求 filePath。
  - SQL 网络型数据库仍按现有规则校验 host、port、username、password。
- 组件行为测试或手动验证：
  - 新建连接默认显示类型选择页。
  - 选择 MySQL 后进入 MySQL 参数页，默认端口为 3306。
  - 选择 Redis 后进入 Redis 参数页，默认端口为 6379，隐藏 schema。
  - 选择 SQLite/DuckDB 后只展示文件路径相关字段。
  - 编辑现有连接时直接进入参数页，不出现类型选择页。
  - 测试连接和创建连接仍调用现有 `api.connections.testEphemeral` 与 `api.connections.create`。

## Assumptions

- 第一版只改前端创建连接体验，不改后端 `ConnectionForm` wire shape。
- 第一版不引入新的连接存储字段。
- 第一版不支持编辑已有连接时切换数据库类型。
- 类型选择卡片直接复用 `DRIVER_REGISTRY`，不单独维护另一份数据库类型列表。
- Redis 的更细粒度配置，例如 ACL 用户名、database index、cluster/sentinel，可后续单独设计。

# Redis 实现架构与后续计划

本文记录当前 Redis 接入的实现架构、已支持能力、已知限制和后续要做的事情。目标是避免后续继续补丁叠补丁，并为 Elasticsearch、MongoDB 等非 SQL 数据源提供可复用的接入方向。

## 当前架构

Redis 没有实现 SQL 数据库使用的 `DatabaseDriver`。它按非 SQL 数据源接入，使用独立后端 datasource、Tauri command 和前端视图。

### 后端分层

- `src-tauri/src/datasources/redis.rs`：Redis 原生能力层，负责连接、数据库列表、key 扫描、value 读取、写入、删除、重命名和 TTL。
- `src-tauri/src/commands/redis.rs`：Tauri command 层，负责按 connection id 读取连接配置、校验 driver 类型，并调用 datasource。
- `src-tauri/src/commands/connection.rs`：`test_connection_ephemeral` 对 Redis 分流，避免走 SQL driver。
- `src-tauri/src/connection_input/mod.rs`：连接表单标准化，Redis 支持 `host:port` 输入。
- `src-tauri/src/ssh.rs`：Redis 默认 SSH 目标端口是 `6379`。

### 前端分层

- `src/lib/driver-registry.tsx`：Redis 注册为 `kind: "kv"`，默认端口 `6379`。
- `src/lib/connection-form/rules.ts`：Redis 用户名、密码不是必填，允许 host 内嵌端口。
- `src/services/api.ts`：暴露 `api.redis.*`。
- `src/components/business/Sidebar/ConnectionList.tsx`：Redis 数据库和 key 树加载。
- `src/components/business/Redis/RedisKeyView.tsx`：Redis key 创建、编辑、删除视图。
- `src/App.tsx`：新增 `redis-key` tab 类型，并路由到 `RedisKeyView`。

## 当前已支持能力

### 连接

- 支持 Redis 单机连接。
- 支持 Redis 无密码连接。
- 支持 Redis password。
- 支持 Redis ACL username/password。
- 支持 Redis Cluster，当前通过 `host` 中填写多个逗号分隔 seed 节点识别，例如 `10.0.0.1:6379,10.0.0.2:6379`。
- Cluster 模式只支持 `db0`，符合 Redis Cluster 不支持多 DB 的约束。
- 支持 SSL/TLS 开关的基础连接路径。

### 数据浏览与 CRUD

- 单机模式支持 `SCAN` key。
- Cluster 模式当前支持跨 master 获取 key。
- 支持读取 key 类型和 TTL。
- 支持读取和编辑以下类型：
  - `string`
  - `hash`
  - `list`
  - `set`
  - `zset`
- 支持创建 key。
- 支持覆盖保存 key。
- 支持删除 key。
- 支持重命名 key。
- 支持设置 TTL 或持久化。

## 已知架构问题

### 1. Cluster key 浏览不适合生产大集群

当前 Cluster key 浏览使用 all-master `KEYS` 后再截断结果。这个方案简单可用，但在生产大集群上有阻塞风险。

更合理的方案是实现 Cluster-aware SCAN：

- 对每个 master 节点维护独立 cursor。
- 前端保存并传回每个节点的 cursor 状态。
- 后端聚合每一批扫描结果。
- cursor 全部归零时才认为扫描完成。

### 2. 前端没有使用后端 cursor

后端 `scan_keys` 返回了 cursor，但前端目前固定从 cursor `0` 拉取，limit 是 `200`。这会导致 key 数量超过 200 后无法继续加载。

需要在 Sidebar 中加入：

- load more。
- search 时重置 cursor。
- refresh 时重置 cursor 并重新扫描。
- 显示当前结果是否只是部分结果。

### 3. 集合类型编辑是全量覆盖

当前 `redis_update_key` 实际调用 `set_key`，即先删除旧 key，再按当前表单内容重建 key。

这对小 key 可用，但对大 hash/list/set/zset 风险很高：

- 不能只改一个 hash field。
- 不能只删除一个 list item。
- 不能只新增一个 set member。
- 保存失败时可能造成数据不完整。

后续应提供字段/成员级 command，例如：

- `redis_hash_set_field`
- `redis_hash_delete_field`
- `redis_list_set_item`
- `redis_list_push`
- `redis_set_add_member`
- `redis_set_remove_member`
- `redis_zset_add_member`
- `redis_zset_remove_member`

### 4. 大 value 没有分页

当前 list/zset 只读取前 199 个成员，hash/set 读取方式还不够安全。大 key 会带来性能和 UI 卡顿问题。

需要按类型提供分页或 cursor：

- hash：`HSCAN`
- set：`SSCAN`
- zset：`ZRANGE` with offset/limit
- list：`LRANGE` with offset/limit

### 5. 连接选项承载方式不够可扩展

Cluster 通过逗号分隔 host 隐式识别。短期可接受，但不适合继续扩展 Sentinel、TLS 证书、超时、只读副本等能力。

建议后续在连接模型中增加非 SQL datasource options，例如：

```json
{
  "mode": "standalone | cluster | sentinel",
  "seedNodes": ["127.0.0.1:6379"],
  "sentinels": [],
  "serviceName": "",
  "connectTimeoutMs": 5000,
  "readTimeoutMs": 10000
}
```

这类结构未来也可以服务 MongoDB、Elasticsearch。

## 离可用还差什么

### P0：达到安全可用的最低要求

- 将 Cluster key 浏览从 `KEYS` 改为安全的 Cluster-aware `SCAN`，或者在 UI 中明确限制大集群浏览。
- 前端支持 key 分页和 load more，真正使用后端 cursor。
- 为 delete、rename、overwrite 增加危险操作确认。
- 为 TTL、JSON value、zset score 增加前端校验。
- 为 hash/list/set/zset 增加大 value 分页能力。
- 为 Redis 增加真实集成测试，覆盖单机、无密码、有密码、ACL、Cluster。

### P1：提升产品可用性

- 增加显式 Redis 模式选择：standalone、cluster、sentinel。
- 增加 seed nodes 独立输入，不再依赖 host 字符串约定。
- 确认并补齐 Redis over SSH 的实际连接链路。
- 补齐 TLS CA/client cert 配置。
- 创建、删除、重命名后自动刷新 Sidebar key 树。
- 支持集合类型的字段/成员级编辑。
- 增加 binary-safe 显示策略，避免二进制 value 被错误解码或保存。

### P2：高级能力

- Redis 命令行 console。
- Stream 专用视图。
- RedisJSON 专用视图。
- Geo、Bitmap、HyperLogLog 的基础查看能力。
- 批量删除、批量 TTL 修改、按 pattern 批处理。
- 导入导出。
- 操作日志和只读模式。

## 推荐推进顺序

1. 先补 key 浏览链路：单机 SCAN 分页、前端 load more、Cluster 安全扫描。
2. 再补写操作安全：确认弹窗、输入校验、创建/删除/重命名后的树刷新。
3. 再补大 value 能力：hash/list/set/zset 分页和局部编辑。
4. 再抽象连接 options：显式 standalone/cluster/sentinel，为 MongoDB、Elasticsearch 预留结构。
5. 最后补高级类型和 console。

## 对后续非 SQL 数据源的启发

Redis 当前方向是正确的：非 SQL 数据源不应该强行伪装成 SQL 表模型。后续 MongoDB、Elasticsearch 应继续使用 datasource 架构：

- MongoDB：database、collection、document、index、aggregation。
- Elasticsearch：cluster、index、mapping、document、search query。
- Redis：database、key、type、value、ttl。

长期建议在前端 Sidebar 中抽象通用的 datasource tree node，避免继续把 Redis key 适配成 `TableInfo`。这样可以减少 MongoDB、Elasticsearch 接入时的结构错位。

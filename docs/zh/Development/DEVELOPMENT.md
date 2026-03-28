# 开发指南

## 前提条件

- Rust（最新稳定版）
- Bun（推荐）或 Node.js（v18+）
- Tauri 所需的平台工具链：https://tauri.app/start/prerequisites/

## 环境准备

```bash
git clone https://github.com/codeErrorSleep/dbpaw.git
cd dbpaw
bun install
```

## 启动

仅前端（Mock 模式）—— 推荐用于 UI 开发：

```bash
bun dev:mock
```

完整应用（Tauri + Rust）—— 用于端到端功能验证：

```bash
bun tauri dev
```

## 构建

```bash
bun tauri build
```

## 测试

一键跑全量测试：

```bash
bun run test:all
```

或按需执行：

```bash
bun run test:unit
bun run test:service
bun run test:rust:unit
bun run test:integration
```

### 集成测试自动化（MySQL + Postgres）

- 默认执行 `bun run test:integration` 会自动启动/销毁 MySQL 与 Postgres 容器（无需手动起库）。
- 可通过 `IT_DB` 指定目标数据库：
  ```bash
  IT_DB=mysql bun run test:integration
  IT_DB=postgres bun run test:integration
  IT_DB=all bun run test:integration
  ```
- 如需复用你本地已经启动的数据库（兼容旧流程），可设置：
  ```bash
  IT_REUSE_LOCAL_DB=1 bun run test:integration
  ```

### 集成测试常见环境变量（可选覆盖）

- MySQL: `MYSQL_HOST` `MYSQL_PORT` `MYSQL_USER` `MYSQL_PASSWORD` `MYSQL_DB`
- Postgres: `POSTGRES_HOST` `POSTGRES_PORT` `POSTGRES_USER` `POSTGRES_PASSWORD` `POSTGRES_DB`
- 兼容 Postgres 常见别名: `PG_HOST` `PG_PORT` `PGUSER` `PGPASSWORD` `PGDATABASE`

### 排障建议

- 镜像拉取慢：先手动执行 `docker pull mysql:8.0` 和 `docker pull postgres:16-alpine` 预热。
- 端口冲突：集成测试默认使用 Docker 动态映射端口，通常不会冲突；如本地复用模式冲突，请调整 `*_PORT`。
- Apple 芯片兼容：若首次拉取较慢，建议预先拉取镜像并等待 Docker Desktop 完成架构层初始化。

### 推荐工作流

- 日常开发：优先执行 `test:unit` + `test:service`。
- 提交前：按需执行 `test:integration` 做数据库回归。
- PR：CI 会固定执行集成测试作为质量兜底。

### 功能开发后怎么跑测试（实践版）

1. 开发过程中（高频、快速反馈）

- 先跑：
  ```bash
  bun run test:unit
  bun run test:service
  ```
- 适用：前端逻辑、业务逻辑、小范围改动的快速验证。

2. 改动涉及数据库行为时（中频）

- 跑：
  ```bash
  IT_DB=all bun run test:integration
  ```
- 或按需只跑单库：
  ```bash
  IT_DB=mysql bun run test:integration
  IT_DB=postgres bun run test:integration
  ```
- 适用：连接参数、驱动逻辑、执行 SQL、表/库元数据、DDL/DML、类型映射相关改动。

3. 提交前（低频但建议）

- 至少跑一次：
  ```bash
  IT_DB=all bun run test:integration
  ```
- PR 流水线会再次自动跑，作为最终兜底。

### 这套集成测试覆盖什么 / 不覆盖什么

- 能覆盖：
  - Rust 数据库层真实连库能力
  - 常见数据库操作链路（连接、建表、查询、元数据、DDL）
  - 驱动兼容与类型映射问题
- 不覆盖：
  - 前端 UI 的“点点点”交互流程（这属于 E2E/UI 自动化范畴）
  - 纯视觉样式问题

### 什么时候可以不跑集成测试

- 仅改文案、样式、纯前端展示层，且不影响数据库交互。
- 仅改与数据库完全无关的代码。
- 快速迭代中间版本可不跑；合并前建议补跑一次。

### 容器清理说明

- 默认模式（未设置 `IT_REUSE_LOCAL_DB=1`）下，测试使用 testcontainers 拉起临时容器，测试结束后会自动销毁。
- 设置 `IT_REUSE_LOCAL_DB=1` 时，测试会连接你手动准备的数据库实例，不会自动删除你自己的容器。

## 代码格式化

```bash
bun run format
```

## 🌐 官网

- 官方官网位于 `website/` 目录，基于 [Astro](https://astro.build/) 构建。
- 本地开发：
  ```bash
  bun run website:dev
  ```
- 生产构建：
  ```bash
  bun run website:build
  ```

### 版本同步机制

- 官网会从以下地址拉取最新版本：
  `https://api.github.com/repos/codeErrorSleep/dbpaw/releases/latest`
- 官网展示的版本号与下载链接由 GitHub Releases 资产自动生成。
- 若构建时 GitHub API 不可用，官网会自动回退到 `website/src/config/fallback.ts`，确保构建不中断。

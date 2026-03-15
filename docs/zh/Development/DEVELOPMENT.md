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

## 代码格式化

```bash
bun run format
```

## 官网

官网代码位于 `website/`。

```bash
bun run website:dev
bun run website:build
```

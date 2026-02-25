# DbPaw

![DbPaw Logo](public/product-icon.png)

[English](README.md) | 简体中文

> **一个现代化的 AI 驱动数据库客户端，适用于新时代。**

[![Release](https://img.shields.io/github/v/release/codeErrorSleep/dbpaw?style=flat-square)](https://github.com/codeErrorSleep/dbpaw/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg?style=flat-square)](https://tauri.app)

**DbPaw** 是一个轻量级、跨平台的数据库管理工具，基于 [Tauri](https://tauri.app) 和 [React](https://react.dev) 构建。它结合了原生 Rust 后端的高性能和现代化 Web UI，为您提供无缝的 SQL 编辑和数据探索体验。

## ✨ 特性

- **🔌 多数据库支持**：轻松连接 **PostgreSQL** 和 **MySQL** 数据库。
- **🤖 AI 智能辅助**：集成 AI 侧边栏，帮助您编写复杂的 SQL 查询、解释执行计划并优化性能。
- **🔒 安全连接**：支持 **SSH 隧道**，安全访问远程数据库。
- **📝 高级 SQL 编辑器**：
  - 语法高亮和自动补全。
  - **已保存查询**库，用于组织您常用的脚本。
  - 一键格式化 SQL。
- **📊 交互式数据网格**：
  - 高效查看、过滤和排序表数据。
  - 可视化数据关系。
- **🎨 现代化 UI**：
  - 使用 **TailwindCSS** 和 **Shadcn/UI** 精心设计。
  - 内置**深色模式**支持，夜间编码更舒适。
- **🚀 高性能**：基于 Rust 构建，确保低内存占用和极速启动。

## 📥 安装

前往 [Releases](https://github.com/codeErrorSleep/dbpaw/releases) 页面下载适合您操作系统的最新版本。

### macOS 用户

如果在打开应用时遇到"DbPaw 已损坏"或"无法识别的开发者"警告：

1. 将 `DbPaw.app` 移动到 `/Applications` 文件夹。
2. 打开**终端**并运行以下命令：
   ```bash
   sudo xattr -d com.apple.quarantine /Applications/DbPaw.app
   ```
3. 现在可以正常打开应用。

_注意：这是因为应用尚未经过 Apple 公证。_

## 🛠️ 开发

如果您想贡献代码或从源码构建，请按照以下步骤操作：

### 前提条件

- [Rust](https://www.rust-lang.org/tools/install) (最新稳定版)
- [Bun](https://bun.sh/) 或 Node.js (v18+)

### 设置

1. **克隆仓库**

   ```bash
   git clone https://github.com/codeErrorSleep/dbpaw.git
   cd dbpaw
   ```

2. **安装前端依赖**

   ```bash
   bun install
   ```

3. **运行开发模式**

   **仅前端（模拟模式）** - 推荐用于 UI 开发：

   ```bash
   bun dev:mock
   ```

   **完整应用（Tauri + Rust）** - 用于完整功能测试：

   ```bash
   bun tauri dev
   ```

4. **构建生产版本**
   ```bash
   bun tauri build
   ```

## 🏗️ 技术栈

- **核心**: [Tauri v2](https://v2.tauri.app/) (Rust)
- **前端**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **样式**: [TailwindCSS v4](https://tailwindcss.com/), [Shadcn/UI](https://ui.shadcn.com/)
- **状态管理**: React Hooks & Context
- **编辑器**: [Monaco Editor](https://microsoft.github.io/monaco-editor/) / CodeMirror

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

## 📄 许可证

本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](LICENSE) 文件。

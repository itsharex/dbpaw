# 贡献指南

感谢你愿意为 DbPaw 贡献力量！

## 你可以做什么

- 通过 GitHub Issues 反馈 Bug / 体验问题
- 改进文档（修正错别字、补充说明、更新截图）
- 提交 PR 贡献代码

## 快速开始

开发与构建命令请先阅读：[开发指南](../Development/DEVELOPMENT.md)。

## 提交代码变更

1. Fork 仓库并新建分支
2. 让改动尽量聚焦，方便 Review
3. 在提交前跑格式化与测试：
   ```bash
   bun run format
   bun run test:all
   ```
4. 提交 PR 时建议包含：
   - 改了什么、为什么要改
   - UI 改动的截图或录屏
   - 验证步骤（如何确认改动有效）

## 参与翻译

DbPaw 使用 i18next，翻译文件以 TypeScript 形式维护：

- 目录：`src/lib/i18n/locales/*.ts`
- 现有语言：`en`、`zh`、`ja`

新增语言时，需要新增 locale 文件，并在 `src/lib/i18n/index.ts` 中补齐 resources 与 supported languages。

# コントリビューションガイド

DbPaw への貢献に興味を持っていただき、ありがとうございます！

## できること

- GitHub Issues での不具合報告 / UX フィードバック
- ドキュメント改善（誤字、説明の追加、スクリーンショット更新）
- PR によるコード貢献

## はじめに

開発・ビルド手順はまずこちら：[開発ガイド](../Development/DEVELOPMENT.md)。

## コード変更の提出

1. リポジトリを Fork してブランチを作成
2. 変更は小さく、レビューしやすく保つ
3. 提出前にフォーマットとテストを実行：
   ```bash
   bun run format
   bun run test:all
   ```
4. PR には以下を含めるのがおすすめ：
   - 変更内容と理由
   - UI 変更のスクリーンショット / 録画
   - 検証手順

## 翻訳

DbPaw は i18next を利用し、翻訳は TypeScript で管理しています：

- パス：`src/lib/i18n/locales/*.ts`
- 既存言語：`en`、`zh`、`ja`

新しい言語を追加する場合は locale ファイルを追加し、`src/lib/i18n/index.ts` で resources と supported languages を更新してください。

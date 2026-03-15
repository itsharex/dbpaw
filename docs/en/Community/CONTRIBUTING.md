# Contributing

Thanks for your interest in contributing to DbPaw!

## Ways to help

- Report bugs and UX issues via GitHub Issues
- Improve documentation (typos, clarity, screenshots)
- Submit code changes via Pull Requests

## Getting started

For build and dev commands, see [Development Guide](../Development/DEVELOPMENT.md).

## Submitting code changes

1. Fork the repository and create a feature branch
2. Keep changes focused and easy to review
3. Run formatting and tests:
   ```bash
   bun run format
   bun run test:all
   ```
4. Open a Pull Request with:
   - what changed and why
   - screenshots or screen recordings for UI changes
   - steps to verify

## Translations

DbPaw uses i18next and keeps translations in TypeScript:

- Files: `src/lib/i18n/locales/*.ts`
- Existing languages: `en`, `zh`, `ja`

To add a new language, add a new locale file and wire it up in `src/lib/i18n/index.ts` (resources and supported languages).

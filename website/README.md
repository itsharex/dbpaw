# DbPaw Website (Astro)

Marketing site for DbPaw powered by Astro.

## Commands

```bash
bun run start
bun run build
```

## Data source

- Latest release metadata comes from `https://api.github.com/repos/codeErrorSleep/dbpaw/releases/latest`.
- If GitHub API is unavailable during build, the site falls back to `src/config/fallback.ts`.

## Cloudflare Pages

- Build command: `bun run website:build` (from repo root)
- Output directory: `website/dist`

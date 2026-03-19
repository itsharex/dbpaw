# Development

## Prerequisites

- Rust (latest stable)
- Bun (recommended) or Node.js (v18+)
- Platform toolchain required by Tauri: https://tauri.app/start/prerequisites/

## Setup

```bash
git clone https://github.com/codeErrorSleep/dbpaw.git
cd dbpaw
bun install
```

## Run

Frontend-only (Mock Mode) — recommended for UI work:

```bash
bun dev:mock
```

Full app (Tauri + Rust) — for end-to-end testing:

```bash
bun tauri dev
```

## Build

```bash
bun tauri build
```

## Tests

Run everything:

```bash
bun run test:all
```

Or run a subset:

```bash
bun run test:unit
bun run test:service
bun run test:rust:unit
bun run test:integration
```

## Formatting

```bash
bun run format
```

## Website

The marketing website lives in `website/`.

```bash
bun run website:dev
bun run website:build
```

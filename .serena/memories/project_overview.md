# EVE Flipper Project Overview

- Name: `eve-flipper`
- Purpose: Community-driven, local-first trading/industry analysis tool for EVE Online.
- Main runtime model: Go backend serving embedded frontend UI on `127.0.0.1:13370` by default.
- Persistence: SQLite for config/history/local state.

## Tech Stack
- Backend: Go `1.25.x`
- Frontend: React `19`, TypeScript `5`, Vite `6`, Tailwind CSS
- Desktop variants: Wails (`github.com/wailsapp/wails/v2`) and Tauri-related frontend tooling
- DB engine: `modernc.org/sqlite`

## High-Level Structure
- `cmd/`: command entrypoints/util tools
- `internal/`: backend app code
  - `api/` HTTP handlers and streaming
  - `config/` configuration/watchlist models
  - `db/` SQLite and persistence logic
  - `engine/` scanner/profit/trading logic
  - `esi/` EVE ESI client integration
  - `graph/` route/pathfinding logic
  - `sde/` static data export ingestion
- `frontend/`: React TypeScript app
- `data/`: SDE datasets and wiki RAG mirror
- `tools/`: supporting/debugging tools

## Documentation Source for This Workspace
- Local wiki mirror: `data/wiki-rag/ilyaux__Eve-flipper/mirror`
- Includes feature docs such as `Regional-Trade.md`, `Industry-Analysis.md`, `API-Reference.md`, etc.

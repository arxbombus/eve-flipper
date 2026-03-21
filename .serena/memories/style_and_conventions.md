# Style and Conventions

## Backend (Go)
- Follow `gofmt` formatting and idiomatic Go package organization.
- Add godoc comments for exported functions/types.
- Keep package boundaries clean (`engine`, `esi`, `db`, etc.).
- Prefer named constants over magic numbers.
- Write focused `*_test.go` tests for logic changes.

## Frontend (TypeScript/React)
- Use functional components and hooks.
- Keep API calls centralized in frontend library modules (see project docs/contributing guidance).
- Keep shared types in dedicated type modules.
- Use Tailwind utilities and existing project design tokens (`eve-*` theme guidance from contributing docs).

## General
- Keep changes scoped and minimal for community maintainability.
- Preserve local-first behavior and avoid assumptions that require cloud dependencies.
- Prefer explicit, readable logic over clever shortcuts in trading calculations.

# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React UI; feature folders (`components/`, `stores/`, `hooks/`, `types/`, `utils/`) keep presentation, state, and helpers separated.
- `src-tauri/` hosts the Rust core; `src/core/` drives download orchestration, `commands/` exposes Tauri bindings, and `downloaders/` implements protocol adapters.
- `public/` holds static assets, `docs/` aggregates architecture/setup references, and `scripts/` carries repeatable PowerShell or batch tasks. Extend these directories rather than scattering artifacts elsewhere.

## Build, Test, and Development Commands
- `pnpm dev` starts the desktop shell with hot reload; run `pnpm dev:clean` when caches drift.
- `pnpm build` creates the production bundle and `pnpm tauri build` produces installers for each OS.
- `pnpm lint`, `pnpm lint:fix`, `pnpm format`, and `pnpm type-check` gate code quality; include them in pre-push workflows.
- `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm test:coverage` exercise unit, integration, end-to-end, and coverage runs. Execute `cargo test` inside `src-tauri` for Rust suites.

## Coding Style & Naming Conventions
- Prettier (2-space indent, double quotes, trailing commas when legal) and ESLint rules apply to all TypeScript; Husky + lint-staged run these on staged files.
- React components and Zustand stores use PascalCase, hooks use `useCamelCase`, and shared utilities keep camelCase. Rust modules stay snake_case and should pass `cargo fmt`.
- Order imports by library → shared aliases → relative paths; avoid default exports except for React components.

## Testing Guidelines
- Co-locate component tests under `__tests__`, reserve `.integration.test.tsx` for cross-module scenarios, and `.e2e.test.tsx` for Vitest UI flows.
- Prefer Vitest's `vi.mock` for network and filesystem seams; keep end-to-end flows calling actual Tauri commands when feasible.
- New Rust features demand matching specs in `src-tauri/src/core/*_tests.rs`; add both unit and integration coverage where meaningful.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) with succinct, impact-focused subjects.
- Bundle related code, tests, and docs together; isolate refactors or formatting-only work into separate commits.
- Pull requests should summarize changes, list verification commands (`pnpm test`, `cargo test`), link issues or tasks, and include UI media or config notes needed for reviewers.

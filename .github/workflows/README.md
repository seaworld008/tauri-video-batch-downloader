# GitHub Actions Workflows

This directory keeps the GitHub Actions pipeline intentionally quota-aware:
cheap checks run first, expensive platform builds run only after the repository
is already known to be healthy.

## Continuous Integration (`ci.yml`)

Triggers:

- Pushes to `main` that touch non-documentation files
- Pull requests targeting `main`
- Manual dispatch

Job order:

1. `Fast Preflight`: installs Node dependencies, then runs TypeScript, ESLint,
   and Prettier checks.
2. `Frontend Tests`: runs Vitest unit and integration suites after preflight.
3. `Rust Static Checks`: runs `cargo fmt` and `cargo clippy -D warnings` before
   slower Rust tests.
4. `Backend Tests`: runs `cargo test`.
5. `Ubuntu Tauri Build Smoke`: runs only for pull requests and manual dispatch,
   not for every push to `main`.
6. `CI Success`: aggregates required job states.

Quota controls:

- Frontend and Rust jobs are gated by the fast preflight, so formatting or lint
  failures stop before heavy jobs start.
- Rust clippy runs before Rust tests to catch static failures sooner.
- Full Windows/macOS/Linux packaging is removed from regular CI and handled by
  `release.yml`.
- Coverage upload is not part of every CI run; add it back as a manual or
  scheduled workflow if project coverage reporting becomes a release gate.

## Release (`release.yml`)

Triggers:

- Pushing a `v*` tag builds all platforms.
- Manual dispatch builds an existing tag and lets the operator choose `all`,
  `windows`, `macos`, or `linux`.

Release stages:

1. `Release Preflight`: resolves the tag, validates it exists, then runs the
   same local quality gates plus frontend tests, Rust clippy, and Rust tests.
2. `Build <platform>`: runs only after preflight succeeds.
3. `Publish Draft Release`: uploads artifacts only for tag pushes or manual runs
   with `publish=true`.
4. `Release Summary`: prints final build/publish state.

Supported hosted runners:

| Target              | Runner           | Rust target                |
| ------------------- | ---------------- | -------------------------- |
| Windows x64         | `windows-latest` | `x86_64-pc-windows-msvc`   |
| macOS Intel         | `macos-15-intel` | `x86_64-apple-darwin`      |
| macOS Apple Silicon | `macos-14`       | `aarch64-apple-darwin`     |
| Linux x64           | `ubuntu-22.04`   | `x86_64-unknown-linux-gnu` |

Important details:

- Linux uses Tauri v2's `libwebkit2gtk-4.1-dev` dependency.
- The frontend build step is `pnpm exec vite build`, so the workflow does not
  accidentally run a nested `tauri build` before the matrix build.
- `strategy.fail-fast` is enabled for release builds to stop sibling platform
  jobs when a platform reveals a systemic failure.
- Artifacts are retained for 14 days. Draft release uploads include
  `CHECKSUMS.txt`.

Manual release dry run:

```bash
gh workflow run release.yml -f tag=v1.2.3 -f platforms=linux -f publish=false
```

Manual draft release publish:

```bash
gh workflow run release.yml -f tag=v1.2.3 -f platforms=all -f publish=true
```

## Security Audit (`security.yml`)

Triggers:

- Dependency file changes on `main`
- Pull requests that change dependency files
- Weekly schedule
- Manual dispatch

Quota controls:

- Pull requests run `actions/dependency-review-action` only.
- Full Rust audit, npm audit, and CodeQL are not run on every source-only push.
- CodeQL runs on schedule/manual dispatch, not on every dependency push.
- Audit artifacts are retained for 14 days.

Full manual audit:

```bash
gh workflow run security.yml
```

## Required Secrets

Optional signing and updater secrets:

```bash
WINDOWS_CERTIFICATE
WINDOWS_CERTIFICATE_PASSWORD
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
KEYCHAIN_PASSWORD
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
TAURI_PRIVATE_KEY
TAURI_KEY_PASSWORD
```

## Local Preflight

Run these before spending GitHub Actions minutes:

```bash
pnpm type-check
pnpm lint
pnpm exec prettier --check "src/**/*.{ts,tsx,css,json}" "*.html" ".github/workflows/*.yml" ".github/workflows/README.md" "README.md" "AGENTS.md" "docs/**/*.md"
pnpm exec vitest run
pnpm exec vitest run --config vitest.config.integration.ts
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## References

- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/)

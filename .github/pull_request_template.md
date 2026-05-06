## Summary

<!-- What changed and why? -->

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation
- [ ] Test
- [ ] Build/release

## Validation

- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm exec vitest run`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Real Tauri app smoke test, when UI or IPC changed

## Download-specific checklist

- [ ] State transitions are covered by tests when touching download lifecycle
      code.
- [ ] Pause/resume behavior preserves `.part` files and resume metadata.
- [ ] Import changes cover duplicate rows, invalid rows, completed tasks, and
      resumable tasks.
- [ ] Event contract changes update Rust emitters, TypeScript parsers, and tests
      together.
- [ ] No private URLs, cookies, tokens, or sample paid content are committed.

## Notes

<!-- Known risks, follow-up work, screenshots, or release notes. -->

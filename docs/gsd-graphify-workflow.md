# GSD + graphify workflow

## Purpose

This repo uses:

- **Hermes** for orchestration, skills, memory, and environment-level workflow control
- **GSD** for planning, roadmap, phased execution, and review workflows
- **graphify** for codebase graph context, architecture recall, and low-cost refresh after code changes

Together they support continuous iterative development without losing big-picture context.

---

## Installed locations

- GSD local runtime files: `./.codex/`
- Graphify outputs: `./graphify-out/`
- Graphify sync helper: `./scripts/graphify-sync.sh`
- Unified repo workflow entrypoint: `./scripts/ai-workflow.sh`
- Graphify git hooks: `.git/hooks/post-commit`, `.git/hooks/post-checkout` (verify in the primary checkout; worktree tests may not support direct hook install)

---

## Recommended workflow

### 1. Check environment and repo state first

```bash
./scripts/ai-workflow.sh doctor
./scripts/ai-workflow.sh context
```

Use this when:
- entering the project after a gap
- after global toolchain upgrades
- before significant architectural changes

### 2. Rebuild or refresh codebase understanding

Run in Codex when needed:

```text
$gsd-map-codebase
```

### 3. Planning is a separate brownfield concern

If `.planning/` already exists, reuse it.

If `.planning/` does not exist and the repo needs a real brownfield planning baseline, use the dedicated bootstrap path instead of pretending the normal repo-integration flow creates it automatically.

### 4. Keep graph context fresh after code changes

```bash
./scripts/graphify-sync.sh smart
```

Behavior:
- if code changed -> rebuild code graph cheaply
- if only docs/media changed -> no automatic semantic refresh
- if graph output missing -> run `graphify update .`

### 4. Force a full graph refresh when needed

```bash
./scripts/graphify-sync.sh force
```

Use this when:
- graph outputs are stale
- semantic/doc changes matter
- you want a full rebuild instead of code-only refresh

### 5. Serve the graph for tool-based exploration

```bash
./scripts/graphify-sync.sh serve
```

---

## Practical guidance

### Use GSD for
- phase planning
- work breakdown
- execution flow
- review loops
- milestone/roadmap management

### Use graphify for
- understanding architecture
- tracing core call chains
- locating central hubs like `DownloadManager`
- seeing which modules changed shape after refactors

### Best combined pattern
1. `./scripts/ai-workflow.sh doctor`
2. `./scripts/ai-workflow.sh context`
3. `$gsd-map-codebase` when architecture understanding needs refresh
4. if `.planning/` exists, use GSD phase planning commands; if it does not exist and is needed, bootstrap planning separately
5. implement/refactor
6. `./scripts/ai-workflow.sh sync`
7. repeat

---

## Notes

- `.planning/` and `graphify-out/` are local workflow artifacts and are git-ignored by default.
- `graphify-out/GRAPH_REPORT.md` is the fastest entry point for architecture recall.
- `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` are the stable graph outputs to expect; do not require `manifest.json` by default.
- For brownfield work, prefer graphify first, then let GSD plan on top of that refreshed codebase understanding.
- If `graphify --help` warns about an older installed skill version after Hermes-side install is updated, check other installed platform targets (for example Claude) before treating it as a Hermes-specific failure.

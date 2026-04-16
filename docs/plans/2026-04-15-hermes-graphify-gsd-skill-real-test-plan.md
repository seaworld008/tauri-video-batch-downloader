# Hermes + graphify + GSD Skills Real Test Plan

> For Hermes: use this document to validate `hermes-graphify-gsd-nonintrusive-workflow` and `hermes-graphify-gsd-project-integration` against a real brownfield repository without assuming a clean greenfield project.

Goal: use `tauri-video-batch-downloader` as the real-world validation target for the two new skills, with special focus on first-install behavior, global toolchain bootstrap, repo-level integration, and upgrade-safe behavior.

Architecture: test in layers. First validate the generic skill's bootstrap logic and prerequisites. Then validate the repo integration skill against this brownfield Tauri project. Capture failures as skill gaps rather than patching around them ad hoc.

Tech Stack: Hermes Agent, graphify, GSD, Python 3, Node/npm/npx, git, Tauri brownfield repo.

---

## 1. Testing Strategy

This project is under active development. Do not treat the current working tree as a disposable sandbox.

Use three environments conceptually:

1. Live machine state audit
- validate what is already installed now
- record drift between skill expectations and reality

2. Fresh-install simulation
- simulate what the skill would do on a machine where Hermes exists but graphify/GSD do not
- do not require the current repo to be reset
- focus on command correctness and prerequisite logic

3. Repo-integration validation
- use `tauri-video-batch-downloader` as the brownfield sample
- verify docs/scripts/planning/graphify assumptions against a real repo

Recommended safety rule:
- if later we perform write-heavy testing, prefer a temporary clone or git worktree of this repo instead of the active main worktree

---

## 2. Scope

### In scope
- `hermes-graphify-gsd-nonintrusive-workflow`
- `hermes-graphify-gsd-project-integration`
- first-install policy
- Hermes prerequisite enforcement
- automatic graphify install/upgrade
- automatic GSD install/upgrade
- global configuration behavior
- repo-local integration behavior
- brownfield compatibility
- upgrade-safe contract

### Out of scope for this phase
- changing Hermes upstream repo code
- changing graphify upstream package code
- changing GSD upstream repo code
- rewriting this project's workflow files to match the skills before validation is complete

---

## 3. Acceptance Criteria

The skills pass this phase only if all of the following are true:

1. Hermes prerequisite is enforced
- if `hermes` is missing, the skill stops and asks for manual Hermes installation
- the skill does not auto-install Hermes

2. First-install flow is explicit and correct
- graphify install path uses the current upstream package reality (`graphifyy` package, `graphify` CLI)
- graphify global Hermes integration command is documented correctly
- GSD install path uses current upstream `npx get-shit-done-cc@latest ...`
- GSD global SDK installation is included

3. Repo integration is brownfield-safe
- the repo skill does not assume a blank repo
- it supports existing `.planning/`, `.codex/`, and `graphify-out/`
- it prefers extending existing workflow files over replacing them blindly

4. Upgrade-safe contract is clear
- thin wrappers and repo-local scripts are the first repair point after upstream changes
- upstream repo edits are not the default fix path

5. Validation steps are operational
- commands listed in the skills are executable or intentionally conditional
- success criteria are specific enough to verify with shell output

---

## 4. Test Matrix

## Scenario A — Hermes missing

Purpose:
- verify the skills stop early and do not auto-install Hermes

Setup expectation:
- simulate an environment where `hermes` is absent from PATH

What to validate:
- skill instructions say Hermes must be installed first
- bootstrap template exits with a clear error
- no graphify/GSD install is attempted before Hermes check

Pass signal:
- failure is explicit, early, and instructive

Fail signal:
- skill tries to install Hermes automatically
- skill proceeds to graphify/GSD install even though Hermes is missing

---

## Scenario B — First install on online machine with Hermes already installed

Purpose:
- verify default bootstrap behavior for a new user

Setup expectation:
- `hermes` exists
- graphify may be absent or outdated
- GSD may be absent or outdated
- network access exists

What to validate:
- graphify install/upgrade command is:
  `python3 -m pip install --user -U graphifyy`
- graphify Hermes integration command is:
  `~/.local/bin/graphify install --platform hermes || graphify install --platform hermes`
- GSD global install/upgrade command is:
  `npx -y get-shit-done-cc@latest --codex --global --sdk`
- skill states that Codex is the default runtime unless user specifies another runtime

Pass signal:
- commands are current and aligned with upstream docs
- global installation and configuration happen before repo integration

Fail signal:
- skill still points to stale GSD source-only flow as default
- skill omits graphify Hermes integration
- skill forgets `--sdk`

---

## Scenario C — Existing machine with outdated graphify/GSD

Purpose:
- verify the skill upgrades instead of only installing when missing

What to validate:
- wording explicitly says install or upgrade
- commands are idempotent enough for repeated use
- wrapper logic does not assume first install only

Pass signal:
- repeated bootstrap is safe and documented as upgrade-friendly

Fail signal:
- skill only documents one-time installation
- repeated use risks drift or inconsistent paths

---

## Scenario D — Repo integration against this brownfield Tauri repo

Purpose:
- validate repo-level assumptions against a real active project

Repository facts to verify against:
- `AGENTS.md` exists
- `README.md` exists
- `.planning/` exists
- `.codex/` exists
- `graphify-out/` exists
- `scripts/graphify-sync.sh` exists
- `scripts/ai-workflow.sh` exists

What to validate:
- repo integration skill does not insist on recreating these from scratch
- it allows reuse/verification of existing files
- checklist explicitly supports brownfield extension
- graphify sync semantics match the current low-cost refresh model

Pass signal:
- skill fits the repo's current workflow shape
- no instruction would unnecessarily destroy or replace current workflow state

Fail signal:
- skill assumes greenfield repo bootstrapping only
- skill ignores existing workflow artifacts

---

## Scenario E — Upgrade contract simulation

Purpose:
- verify the skills guide future repairs to wrappers/scripts first

What to validate:
- if graphify entrypoint changes, wrapper is the first repair target
- if GSD CLI location changes, wrapper is the first repair target
- if project script assumptions drift, repo-local scripts are patched first
- upstream source edits remain non-default

Pass signal:
- repair order is explicit and consistent in skill text

Fail signal:
- skill mixes local repair guidance with upstream patching as equivalent first steps

---

## Scenario F — Offline or partially connected environment

Purpose:
- verify failure mode is understandable when online install is impossible

What to validate:
- skills clearly state they assume Hermes is already installed in an online-capable environment for first bootstrap
- first-install instructions do not pretend offline bootstrap will work automatically

Pass signal:
- dependency on network access is explicit

Fail signal:
- skill implies latest graphify/GSD can always be installed regardless of connectivity

---

## 5. Test Execution Order

### Phase 1 — Documentation and command validation
1. Read both skills
2. Read bundled bootstrap templates
3. Compare commands against upstream Hermes / graphify / GSD docs
4. Record mismatches

### Phase 2 — Local machine reality check
1. Check live `hermes`, `graphify`, `gsd-sdk`
2. Compare installed state with skill expectations
3. Identify hidden assumptions in templates

### Phase 3 — Brownfield repo fit check
1. Check current repo structure
2. Compare repo state with the project-integration skill outputs
3. Mark where the skill is too strict, too vague, or too greenfield-centric

### Phase 4 — Deferred real execution
Later, when ready, run the bootstrap and integration steps in a safe sandbox clone or worktree of this repo.

---

## 6. Concrete Commands for Validation

### Machine state audit
```bash
command -v hermes
hermes --version

command -v graphify
graphify --help

command -v gsd-sdk
gsd-sdk --version
```

### Repo state audit
```bash
cd /data/ai-coding/tauri-video-batch-downloader
git status -sb
./scripts/graphify-sync.sh status
./scripts/ai-workflow.sh doctor
./scripts/ai-workflow.sh context
```

### Upstream command validation
```bash
curl -L https://raw.githubusercontent.com/safishamsi/graphify/main/README.md
curl -L https://raw.githubusercontent.com/gsd-build/get-shit-done/main/README.md
npx -y get-shit-done-cc@latest --help
```

### Later sandbox execution
```bash
# example only — do not run on active dirty worktree without intent
cd /data/ai-coding
git clone /data/ai-coding/tauri-video-batch-downloader tauri-video-batch-downloader-skill-test
cd tauri-video-batch-downloader-skill-test
```

---

## 7. Evidence to Capture

For each scenario, capture:
- command used
- exit code
- key stdout/stderr lines
- whether the result matches skill text
- whether the failure indicates a skill gap or an environment-specific issue

Suggested result format:

```text
Scenario: B — first install with Hermes preinstalled
Check: graphify install command
Observed: python3 -m pip install --user -U graphifyy
Expected: matches skill
Result: PASS
Notes: upstream README still documents graphifyy package name
```

---

## 8. Expected Outputs of This Testing Round

This phase should produce:
1. this test plan
2. a later execution log per scenario
3. a list of skill patches required after real sandbox execution
4. optionally, a reusable eval checklist that can be applied to other repos

---

## 9. Immediate Next Actions

1. Use this repo to validate the skills at the documentation and command-contract level
2. Do not yet mutate the active development worktree for destructive workflow testing
3. When ready, create a safe clone/worktree and run the actual bootstrap/integration commands there
4. Patch the skills immediately after any mismatch is discovered

---

## 10. Current Assessment

At this moment, the two skills are ready for:
- command-contract verification
- first-install logic verification
- brownfield fit verification

They are not yet fully proven until we run the deferred sandbox execution against a real clone/worktree of this project.

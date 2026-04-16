# Hermes + graphify + GSD Skills Finalization Summary

Date: 2026-04-15
Status: validated against a real sandbox of `tauri-video-batch-downloader`

---

## 1. Final Conclusion

The Hermes + graphify + GSD workflow is now mature enough to be treated as the project's standard AI-assisted development baseline.

The following skills have been created, tested, and iteratively improved through real execution rather than only documentation drafting:

- `hermes-graphify-gsd-nonintrusive-workflow`
- `hermes-graphify-gsd-project-integration`
- companion bootstrap path: `gsd-graphify-brownfield-bootstrap`

This means the workflow is no longer a purely conceptual setup. It has been exercised through:
- first-install logic validation
- upgrade validation
- negative-path testing when Hermes is missing
- brownfield repo integration testing
- graphify/GSD real command execution
- environment cleanup and post-upgrade verification

---

## 2. Role of Each Skill

### 2.1 `hermes-graphify-gsd-nonintrusive-workflow`

Purpose:
- define the global, upgrade-safe, non-intrusive integration model
- enforce Hermes as a prerequisite
- automate graphify and GSD installation/upgrade after Hermes exists
- document wrapper strategy and repair order
- explain cross-platform graphify version warning behavior

Use this when:
- setting up the overall workflow on a machine
- reasoning about installation, upgrade, and global integration
- deciding what should be fixed locally vs upstream

### 2.2 `hermes-graphify-gsd-project-integration`

Purpose:
- apply the workflow inside one specific repository
- bootstrap repo-local scripts and docs
- wire graphify and GSD into the repo's day-to-day iteration loop
- stay brownfield-safe

Use this when:
- integrating the workflow into an actual project repo
- adding `graphify-sync.sh`, `ai-workflow.sh`, AGENTS workflow guidance, README workflow docs, and `.gitignore` entries

### 2.3 `gsd-graphify-brownfield-bootstrap`

Purpose:
- create or seed a meaningful `.planning/` baseline for a brownfield repo

Use this when:
- the repository does not yet have a real planning baseline
- a repo needs manual brownfield planning synthesis rather than only tool wiring

Important boundary:
- `.planning/` bootstrap is not the main responsibility of `hermes-graphify-gsd-project-integration`
- use the brownfield bootstrap skill when planning artifacts must be created deliberately

---

## 3. What Was Proven in Real Testing

The workflow has now been validated against a sandbox worktree of this project.

### Proven behaviors
- Hermes is a hard prerequisite and is not auto-installed by the skills
- graphify and GSD can be automatically installed or upgraded after Hermes exists
- GSD global Codex + SDK installation works via:
  `npx -y get-shit-done-cc@latest --codex --global --sdk`
- local Codex runtime installation works via:
  `npx -y get-shit-done-cc@latest --codex --local`
- graphify sync bootstrap works on a real repo
- `ai-workflow.sh doctor/context` style repo checks work in practice
- the non-intrusive repair model holds under real break/fix cycles

### Real issues discovered and resolved
1. system `python3` may exist without `pip`
2. `pip install --user` fails inside virtualenvs
3. `graphify hook install` may fail inside git worktrees because `.git` is a file
4. `manifest.json` is no longer a safe required graphify output assumption
5. `.planning/` responsibility was too ambiguous before explicit boundary clarification
6. graphify version warnings may be caused by stale installs in another platform target, not Hermes itself

---

## 4. Operational Rules Going Forward

### 4.1 Machine-level rule
Before repo integration:
1. verify Hermes exists
2. upgrade/install graphify
3. upgrade/install GSD
4. then do repo integration

### 4.2 Repo-level rule
Inside this repo, prefer:
1. graph refresh
2. graph/report reading
3. planning state reading
4. GSD phase/plan execution
5. implementation and tests
6. graph refresh again

### 4.3 Repair-order rule
If something breaks after future upgrades, fix in this order:
1. wrappers
2. repo-local scripts
3. repo docs
4. only then consider upstream code changes

### 4.4 Graphify warning rule
If graphify warns that the installed skill version is older than the package version:
- do not assume Hermes integration failed immediately
- inspect other installed graphify platform targets such as Claude
- update every platform target you actually use

---

## 5. Recommended Use in This Project

For this project, the most practical operating model is:

1. treat the skills as the stable workflow definition
2. use `graphify-out/GRAPH_REPORT.md` as the fast architecture entrypoint
3. use `.planning/` as the execution-state layer when it exists
4. use `gsd-graphify-brownfield-bootstrap` only when planning context truly needs to be created or reseeded
5. keep the active development worktree separate from destructive workflow experiments; prefer sandbox clones/worktrees for workflow validation

---

## 6. Current Status of the Ecosystem

At the end of this validation round:
- Hermes is updated and verified
- graphify is updated and verified
- GSD is updated and verified
- graphify's cross-platform warning behavior is understood and documented
- Hermes repo cleanup has been completed
- the skills are now good enough to be used as the default workflow baseline for future development work

---

## 7. Practical Next Step

From this point onward, the highest-value path is not more foundation work but actual use:
- use these skills in the next real development tasks for `tauri-video-batch-downloader`
- only patch the skills again when real project usage reveals a new mismatch

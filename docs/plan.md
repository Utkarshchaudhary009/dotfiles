# agenv — Implementation Plan

> **Status:** Active development.
>
> **Source of truth:** This file is the implementation roadmap for non-trivial work. Code, chat history, TODOs, and agent memory must not silently override it.

## Product Goal

Build `agenv` into a dependable, portable developer-environment manager that makes a user's configuration available across machines with minimal cognitive effort.

The system should handle discovery, capture, encryption, Git, restoration, synchronization, conflict detection, and verification **under the hood**. The user should primarily express intent, understand the resulting state, and follow the next action when one is required.

## Product Principles

1. **Intent over mechanism.** Users express what they want; `agenv` determines how to accomplish it.
2. **Automation by default.** Safely infer and perform as much work as possible without unnecessary questions.
3. **State-driven behavior.** Understand local, repository, and environment state before deciding what to do.
4. **Safety over automation.** Never silently destroy, overwrite, expose, or discard meaningful user state.
5. **Canonical state.** `agenv.json` and repository files are the canonical environment representation; local registry metadata is convenience state only.
6. **Conventional CLI.** Keep commands predictable, concise, scriptable, and familiar.
7. **Action-driven output.** Explain what happened and, when action is required, give the exact recommended next command.
8. **Human-first, agent-native.** Human output stays readable; the same state must be available through stable structured output for agents and automation.
9. **Evidence over optimism.** Work is complete only when its verification has actually passed.
10. **Smallest complete change.** Prefer the simplest complete solution and avoid speculative architecture.

## Progress Rules

Use GitHub-style checkboxes as the only progress tracker in this file.

- `[ ]` = incomplete or not verified
- `[x]` = implemented and verified

Never mark work complete merely because code exists. Verification evidence must exist first.

Phases are ordered. If scope or architecture changes, update this plan before or with the implementation change.

---

# Phase 1 — Capture Engine

**Goal:** Make discovery and disk-to-repository capture safe, predictable, and reusable by higher-level workflows.

### Tasks

- [x] Introduce shared capture/diff logic for tracked files.
- [x] Support explicit file, directory, and category capture.
- [x] Support recapturing drifted tracked files.
- [x] Detect unchanged, repository-missing, target-missing, locked, and conflicting states.
- [x] Add safe handling for collisions, unsafe symlinks, and sensitive files.
- [x] Provide actionable errors for missing encryption tooling, keys, authentication, and paths.
- [x] Add regression coverage for capture and add workflows.

### Verification

- [x] Typecheck passes.
- [x] Full test suite passes on the implementing branch.
- [x] Capture does not silently overwrite local changes.
- [x] Sensitive captures are encrypted according to policy.

---

# Phase 2 — Scan & Status

**Goal:** Turn environment discovery and state inspection into reliable foundations for automatic workflows.

### Tasks

- [x] Make scanning read-only and deterministic.
- [x] Make scanner results reusable by capture and synchronization workflows.
- [x] Add safe `scan --apply` behavior where appropriate.
- [x] Redesign `status` around a concise summary-first view.
- [x] Report actionable local, remote, missing, locked, and conflict states.
- [x] Ensure status never requires users to understand internal Git/filesystem terminology.

### Verification

- [x] Repeated scans produce stable results for the same machine state.
- [x] Applying scan results is idempotent where safe.
- [x] Status correctly identifies every supported actionable state.
- [x] Status tests cover success, drift, missing files, and conflicts.

---

# Phase 3 — Sync Reconciliation

**Goal:** Make synchronization an intelligent state transition rather than a sequence of user-managed Git operations.

### Tasks

- [ ] Treat local state, canonical repository state, and remote state as one reconciliation model.
- [ ] Automatically capture safe local changes.
- [ ] Automatically restore safe remote changes.
- [ ] Detect divergent changes before destructive operations.
- [ ] Resolve conflicts explicitly and preserve recoverability.
- [ ] Make retry behavior safe after Git, encryption, or filesystem failures.
- [ ] Hide Git choreography from the normal user workflow.

### Verification

- [ ] No-change sync is a no-op.
- [ ] Local-only changes are captured safely.
- [ ] Remote-only changes are restored safely.
- [ ] Non-overlapping changes reconcile automatically.
- [ ] Conflicting changes are surfaced without silent data loss.
- [ ] Real Git-backed end-to-end tests cover the major reconciliation paths.

---

# Phase 4 — CLI UX Transformation

**Goal:** Transform `agenv` from a command collection into a conventional, conversational, agent-centric CLI that keeps most complexity under the hood.

## UX Model

The primary interaction loop is:

```text
Understand intent
      ↓
Inspect current state
      ↓
Automatically perform safe work
      ↓
Explain the resulting state
      ↓
Recommend the next action
      ↓
Continue until the desired state is reached
```

The user should not need to understand the internal sequence of scan → capture → encrypt → Git → restore → verify. `agenv` should own that choreography.

### Tasks

- [ ] Audit the command surface and remove, merge, or demote commands that expose internal implementation steps.
- [ ] Define a small set of primary intent-oriented commands for the common lifecycle.
- [ ] Make `agenv` with no command act as a state-aware entry point that tells the user what matters and what to do next.
- [ ] Make common commands automatically perform safe prerequisite and follow-up work.
- [ ] Standardize output around: **result → relevant detail → next action**.
- [ ] Use conventional CLI conventions for stdout/stderr, exit codes, help, and quiet/verbose behavior.
- [ ] Make normal output concise and avoid exposing internal Git, filesystem, encryption, or implementation choreography unless useful.
- [ ] Make errors actionable: explain the problem, give the reason when useful, and provide the recovery command.
- [ ] Ask questions only when the system cannot safely infer intent or a destructive/ambiguous choice requires confirmation.
- [ ] Prefer one recommended next action over a menu of possible commands.
- [ ] Add progressive disclosure so advanced controls remain available without burdening the common path.
- [ ] Define a shared state model that powers both human output and agent output.
- [ ] Add stable structured output for agent/script consumption without making JSON the default human interface.
- [ ] Ensure every actionable state has a deterministic recommended command.
- [ ] Ensure successful terminal states explicitly say when nothing more needs to be done.
- [ ] Update `SKILL.md`, command reference, examples, and help output to reflect the transformed UX.

### Design Acceptance Criteria

- [ ] A new user can complete the common lifecycle without reading the full command reference.
- [ ] A user can run `agenv` and immediately understand the current state and next action.
- [ ] Common workflows require the fewest reasonable user decisions.
- [ ] Internal implementation stages are not exposed as required user steps.
- [ ] Every error with a known recovery path provides that path.
- [ ] Human and agent interfaces expose the same underlying state model.
- [ ] Agent workflows can progress by reading the recommended action rather than scraping arbitrary prose.

### Verification

- [ ] Test every primary user journey from a clean machine/environment.
- [ ] Test all actionable states and verify their recommended next commands.
- [ ] Test non-interactive/agent execution paths.
- [ ] Verify structured output schemas with automated tests.
- [ ] Verify help, documentation, and implementation agree.

---

# Phase 5 — Environment & Remote Lifecycle

**Goal:** Make publishing, cloning, environment selection, and multi-machine use reliable without exposing their implementation complexity.

### Tasks

- [ ] Audit publish and clone as lifecycle operations rather than isolated commands.
- [ ] Make environment selection deterministic and easy to understand.
- [ ] Keep registry metadata separate from canonical repository state.
- [ ] Handle authentication, unavailable remotes, dirty state, and divergent repositories safely.
- [ ] Ensure a newly cloned environment reaches a clearly defined usable state.
- [ ] Keep advanced registry and Git controls available without making them part of the common path.

### Verification

- [ ] A new environment can be published successfully.
- [ ] Another machine can clone and restore it.
- [ ] Switching environments does not alter unrelated repositories.
- [ ] Remote failures produce actionable recovery guidance.
- [ ] Multi-environment tests pass.

---

# Phase 6 — Packaging, Security & Reliability

**Goal:** Make the resulting CLI dependable as a distributed product.

### Tasks

- [ ] Verify package contents, entrypoints, versions, and release automation.
- [ ] Verify supported Bun/Node behavior and platform-specific paths/processes.
- [ ] Keep encryption keys and plaintext secrets out of repositories, logs, archives, and normal output.
- [ ] Add regression tests for every discovered security, data-loss, and cross-platform failure.
- [ ] Verify interrupted operations and retry behavior.
- [ ] Keep CI gates aligned with typecheck, tests, build, packaging, and security scanning.
- [ ] Keep documentation, `AGENTS.md`, `SKILL.md`, and this plan synchronized with actual behavior.

### Verification

- [ ] Clean-install typecheck passes.
- [ ] Full test suite passes.
- [ ] Build and packaging checks pass.
- [ ] Security/secret scanning passes.
- [ ] Supported platform smoke checks pass.
- [ ] Release workflow is verified end-to-end.

---

# Definition of Done

A phase is complete only when its implementation and verification checkboxes are complete.

A major release or architectural milestone is ready only when:

- [ ] All applicable phases are complete.
- [ ] Typecheck, tests, build, and packaging gates pass.
- [ ] Security-sensitive behavior has regression coverage.
- [ ] Real integration/end-to-end verification has been performed where mocks cannot prove correctness.
- [ ] Documentation and CLI help match implementation.
- [ ] Human and agent UX follow the same state model.
- [ ] This plan reflects the verified state of the repository.

**Core UX rule:**

> **Automate the work. Explain the state. Suggest the next action.**

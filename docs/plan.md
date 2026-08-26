# agenv — Implementation Plan

> **Status:** Planning and hardening in progress.
>
> **Source of truth:** This file is the authoritative implementation plan for `agenv`. Code, chat history, issues, TODOs, and agent memory must not silently override it.

## Project Goal

Build `agenv` into a dependable, portable developer-environment manager that can capture selected machine configuration, protect sensitive material, publish an environment repository, and restore/synchronize that environment on another machine with minimal user effort.

The product should make this flow predictable:

```text
Discover local configuration
        ↓
Select what belongs in the environment
        ↓
Capture into canonical repository state
        ↓
Encrypt sensitive material
        ↓
Publish / synchronize through Git
        ↓
Clone / restore on another machine
        ↓
Verify the machine is in the intended state
```

The current repository already contains the main CLI surface, manifest model, encryption flow, deployment flow, registry, export/import support, tests, documentation, and CI. The plan below focuses on making those capabilities coherent, secure, well verified, and maintainable rather than inventing a second product around them.

## Core Principles

1. **Manifest first.** `agenv.json` is the canonical description of managed environment state.
2. **Canonical repository state.** Files under `files/` are the repository-side source of truth; machine paths are deployment targets, not a second source of truth.
3. **Secure by default.** Secrets must be encrypted before publication unless an explicit, narrowly scoped plaintext exception is requested.
4. **Intent-oriented CLI.** Commands should represent user goals, not internal implementation steps.
5. **Smallest complete change.** Solve the current problem without speculative architecture or unrelated cleanup.
6. **Cross-platform by design.** Preserve supported behavior across Windows, Linux, and macOS.
7. **Evidence over optimism.** A task is complete only when its stated verification has actually passed.
8. **Documentation is part of the implementation.** Behavior, tests, documentation, and the plan must converge on the same reality.

## Progress Rules

Use GitHub-style checkboxes as the only progress tracker inside this plan.

- `[ ]` = not complete
- `[x]` = complete and verified

A checkbox may be marked `[x]` only after its verification evidence exists.

A phase is complete only when all of its tasks and all of its verification checks are complete.

Do not silently reorder phases. If architecture or scope must change, amend this file first and explain the change in the resulting commit or PR.

## Current Repository Baseline

The repository currently exposes a broad environment-management CLI including initialization, scanning, add/remove, publish/clone, expansion, update/push/sync, status/list, registry management, export/import, diagnostics, and self-update. The public documentation describes these capabilities and the package is a TypeScript/Bun CLI with `typecheck`, `test`, `build`, and coverage scripts. citeturn80file0turn74file0

The test suite already contains command, deployment, manifest, registry, scan, security, sync, export/import, and unit-level coverage. citeturn76file0

The existing contribution contract also establishes strict typing, Bun-based tests, hermetic temporary directories, encryption-first handling of sensitive files, repository-local canonical state, and manifest-driven state. citeturn77file0

These facts describe the current baseline; they are not automatically completion claims for the phases below until the required gates are run.

---

# Phase 1 — Repository Baseline & Development Contract

**Goal:** Establish a verified baseline so future changes are made against one clear architecture and one trustworthy development workflow.

### Tasks

- [ ] Verify the current dependency/toolchain requirements and document the exact supported Bun/Node versions.
- [ ] Verify the repository's `typecheck`, test, build, and packaging commands from a clean install.
- [ ] Audit `src/commands/` and shared modules to ensure command handlers remain orchestration layers rather than duplicate business logic.
- [ ] Confirm the manifest, filesystem, Git, process, encryption, registry, logging, and error boundaries are the intended reusable boundaries.
- [ ] Identify any existing documentation or command behavior that contradicts the current implementation.
- [ ] Keep this plan as the only roadmap/progress tracker for non-trivial implementation work.

### Deliverable

A verified baseline with one development contract and no known documentation/implementation contradiction left unrecorded.

### Verification

- [ ] `bun install --frozen-lockfile` succeeds.
- [ ] `bun run typecheck` succeeds.
- [ ] `bun test` succeeds.
- [ ] `bun run build` succeeds.
- [ ] `npm pack --dry-run` succeeds and contains the intended package output.
- [ ] CLI smoke checks for `--help`, `--version`, and `doctor` behave as documented.

---

# Phase 2 — Capture, Manifest & Canonical State

**Goal:** Make configuration capture predictable and ensure `agenv.json` plus `files/` remain the single coherent representation of an environment.

### Tasks

- [ ] Audit scan results, category assignment, explicit `add`, and manifest persistence for consistent semantics.
- [ ] Make add/remove operations idempotent where safe.
- [ ] Ensure the manifest cannot silently describe stale or missing repository files after mutations.
- [ ] Ensure custom categories and platform-specific paths are normalized consistently.
- [ ] Add regression tests for duplicate additions, removals, missing sources, and manifest/repository mismatches.
- [ ] Keep machine-local state separate from canonical repository state.

### Deliverable

A captured environment has one unambiguous repository representation and can be inspected with `status`/`list` without reconstructing hidden state.

### Verification

- [ ] Discovery is read-only.
- [ ] Adding a file updates both repository storage and the manifest consistently.
- [ ] Removing a tracked file updates the manifest and repository according to its deletion mode.
- [ ] Duplicate or repeated operations do not corrupt state.
- [ ] `status` accurately reports modified, missing, and synchronized targets.
- [ ] Relevant manifest and command tests pass.

---

# Phase 3 — Encryption, Restore & Filesystem Safety

**Goal:** Make the capture and restore boundary safe against credential leakage, path traversal, accidental overwrites, and ambiguous filesystem state.

### Tasks

- [ ] Audit every path from plaintext secret discovery through encryption, storage, restore, logging, and testing.
- [ ] Ensure private encryption keys never enter repositories, archives, logs, tests, or command output.
- [ ] Validate target-relative paths before writes and reject traversal, unsafe links, and destination collisions.
- [ ] Define precise overwrite behavior for `expand`, including dry-run and force paths.
- [ ] Ensure encrypted files are never accidentally treated as plaintext configuration.
- [ ] Add regression coverage for malformed paths, collisions, missing keys, decryption failures, and partial restore failures.
- [ ] Verify export/import preserves encrypted payloads without exposing secrets.

### Deliverable

A malicious or malformed environment cannot escape its intended destination, overwrite unrelated state silently, or leak protected credentials through normal workflows.

### Verification

- [ ] Valid encrypted files restore correctly with the expected key.
- [ ] Missing/invalid keys fail safely without leaking decrypted material.
- [ ] Path traversal and unsafe destination cases are rejected.
- [ ] Dry-run produces the intended write set without modifying the destination.
- [ ] Force mode only overwrites where explicitly requested.
- [ ] Secret-scan and security tests pass.
- [ ] Export/import security tests pass.

---

# Phase 4 — Remote Lifecycle & Synchronization

**Goal:** Make Git-backed publication and multi-machine synchronization reliable and conflict-aware.

### Tasks

- [ ] Audit `publish`, `clone`, `update`, `push`, and `sync` as one state transition system rather than unrelated commands.
- [ ] Define behavior for dirty worktrees, divergent remote state, failed pulls, interrupted deployment, and retry.
- [ ] Preserve `--ff-only` or equivalent safety where appropriate; never silently discard local or remote changes.
- [ ] Ensure clone/restore has deterministic post-clone state.
- [ ] Add integration tests using temporary Git repositories/remotes where practical.
- [ ] Keep user-facing errors actionable and distinguish authentication, Git, filesystem, and deployment failures.

### Deliverable

A user can publish, clone, update, push, and sync environments without needing to understand the underlying Git choreography.

### Verification

- [ ] Fresh environment can be published successfully.
- [ ] Fresh machine can clone and restore a published environment.
- [ ] Remote changes can be updated and expanded safely.
- [ ] Local changes can be pushed without losing unrelated work.
- [ ] Divergence/conflict paths fail explicitly and preserve recoverability.
- [ ] Relevant integration and synchronization tests pass.
- [ ] Real Git-backed end-to-end verification is performed for changes that alter remote behavior.

---

# Phase 5 — Multi-Environment Registry & Target Resolution

**Goal:** Make named environments a reliable convenience layer without making registry state another source of truth for repository contents.

### Tasks

- [ ] Define target resolution precedence for name, local path, Git URL, active environment, and current directory.
- [ ] Keep registry metadata limited to discovery/selection convenience.
- [ ] Make bind/unbind/use/envs operations deterministic and safe.
- [ ] Verify stale registry entries fail cleanly and can be repaired without touching repository contents.
- [ ] Ensure commands behave consistently whether invoked from inside or outside an environment directory.
- [ ] Add tests for multiple environments, target ambiguity, stale paths, and active-environment selection.

### Deliverable

Users can manage multiple environments from anywhere without hidden coupling between registry metadata and repository state.

### Verification

- [ ] Named environments resolve correctly.
- [ ] Local paths and Git URLs resolve correctly.
- [ ] Active-environment selection is deterministic.
- [ ] Stale registry entries do not modify or delete repositories.
- [ ] All target-taking commands behave consistently.
- [ ] Registry tests pass.

---

# Phase 6 — CLI & AI-Agent UX

**Goal:** Make the CLI easy for humans and deterministic for AI agents and automation.

### Tasks

- [ ] Audit all commands for a consistent user-intent model.
- [ ] Standardize success output around: what happened, what matters, and what to do next.
- [ ] Standardize actionable error messages with subsystem context and one clear recovery path.
- [ ] Introduce stable machine-readable output where it materially improves automation, without forcing JSON on normal users.
- [ ] Ensure `--help`, `--version`, diagnostics, and common failure paths are predictable.
- [ ] Avoid adding new commands merely to expose internal implementation stages.
- [ ] Update CLI reference and examples whenever command behavior changes.

### Deliverable

A human can use the common path without understanding internals, while an AI agent can drive the same workflows without scraping unstable prose.

### Verification

- [ ] Common workflows are documented and executable from a clean environment.
- [ ] CLI help matches implementation.
- [ ] Error cases include actionable recovery guidance.
- [ ] Structured output, where implemented, has a stable schema and is tested on success and failure paths.
- [ ] Relevant CLI behavior tests pass.

---

# Phase 7 — Packaging, Release & Cross-Platform Reliability

**Goal:** Make the CLI dependable as a distributable product rather than only as a repository checkout.

### Tasks

- [ ] Verify npm package contents and built entrypoint.
- [ ] Verify Node compatibility of the built artifact, not just Bun execution.
- [ ] Verify Windows, Linux, and macOS path/process behavior for supported features.
- [ ] Ensure release automation gates on typecheck, build, tests, packaging, and secret scanning.
- [ ] Keep release documentation aligned with actual publishing/install behavior.
- [ ] Add regression coverage for packaging/shebang/versioning behavior.

### Deliverable

A released `agenv` package can be installed and used consistently across supported platforms.

### Verification

- [ ] CI passes from a clean checkout.
- [ ] Built CLI runs with Node where Node support is promised.
- [ ] `npm pack --dry-run` contains only intended release files.
- [ ] Release workflow completes successfully in its intended path.
- [ ] Cross-platform smoke checks pass where CI coverage exists.

---

# Phase 8 — Reliability, Security & Integration Hardening

**Goal:** Turn the existing broad feature set into a dependable foundation for remote development environments and future integrations.

### Tasks

- [ ] Add regression tests for every discovered security, synchronization, data-loss, or cross-platform bug.
- [ ] Exercise failure/retry behavior around Git, encryption, subprocesses, and interrupted filesystem operations.
- [ ] Review logging for accidental secrets or misleading success messages.
- [ ] Review dependency boundaries and remove speculative dependencies/abstractions.
- [ ] Verify the repository remains consumable by AI coding tools and future web-IDE integrations without coupling the core model to one consumer.
- [ ] Document integration contracts that are stable enough to be relied upon by external tooling.

### Deliverable

`agenv` is a stable platform primitive that can safely serve disposable or remote development environments without weakening its core security or state model.

### Verification

- [ ] Failure/recovery tests pass.
- [ ] Security review finds no known credential-leak path in supported workflows.
- [ ] No known data-loss path remains untested.
- [ ] Documentation, plan, tests, and implementation describe the same behavior.
- [ ] Integration smoke tests pass for the supported external tooling paths.

---

# Definition of Done

`agenv` is considered ready for a major release or architectural milestone only when:

- [ ] Every applicable phase task is complete.
- [ ] Every corresponding verification item is complete.
- [ ] Typecheck, tests, and build are green.
- [ ] Security-sensitive behavior has focused regression coverage.
- [ ] Real integration/end-to-end verification has been performed for behavior that mocks cannot prove.
- [ ] Documentation and CLI reference match the implementation.
- [ ] `docs/plan.md` reflects the verified state.

When uncertain, leave the checkbox unchecked and record the missing evidence. An honest `not yet verified` is preferable to an optimistic `done`.

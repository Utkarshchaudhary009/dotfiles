# agenv — Agent Instructions

## 0 · Golden Rules (read this first)

1. **Plan-as-code:** `docs/plan.md` is the single source of truth. Code follows the plan — the plan never silently follows code.
2. **Living document, not carved in stone:** the plan *can* change. But change happens only by editing `docs/plan.md` first, deliberately, before touching code. Nothing else (chat, TODOs, issue threads, agent memory) can authorize a deviation.
3. **Plan-first integration:** every new feature or integration starts as an amendment to `docs/plan.md` (goal → tasks → deliverable → verification criteria), then executes through the normal phase loop.
4. **Checkboxes are earned, not assumed:** `[x]` means "verification actually ran and passed." Never mark progress from reasoning alone.
5. **Ship the smallest viable change:** one phase at a time, with typecheck + tests green (the **gates**) before every commit.

## 1 · How We Work: Structured Vibe Coding

- `docs/plan.md` — *what* to build, in what order, and what counts as proof it works.

The product UX principle is:

> **Automate the work. Explain the state. Suggest the next action.**

`agenv` should keep discovery, capture, encryption, Git, reconciliation, deployment, and registry mechanics under the hood whenever they can be handled safely.

## 2 · Source-of-Truth Protocol (`docs/plan.md`)

Before writing any code:

1. Read `docs/plan.md`.
2. Identify the current incomplete phase (first phase with unchecked tasks).
3. Read that phase's goal, tasks, deliverable, and verification criteria.
4. Work only within that phase.

### Amending the plan (allowed — but plan-first)

`docs/plan.md` is our default roadmap: mutable, but only through the front door.

Amend the plan **before implementing** when:

- the architecture materially changes
- a phase needs splitting or reordering
- an important requirement is discovered
- a verification requirement changes
- a planned technology is replaced

Rules for amendments:

- A new integration becomes a new phase (or explicit tasks in an existing phase) written into the plan first.
- Write each amendment so a fresh agent can continue from the plan alone, with zero reliance on chat.
- Keep amendments atomic — do not bundle unrelated direction changes into one edit.

## 3 · The Phase Loop

Every phase runs the same five steps:

```text
Inspect → Implement → Verify → Sync → Commit
```

### 1. Inspect

- Read the entire current phase in `docs/plan.md`.
- Survey the existing repository before changing architecture; prefer existing project patterns over inventing parallel conventions.
- Check whether the work already exists in the plan before adding anything new.

### 2. Implement

- Build exactly the tasks listed for this phase. No speculative later-phase features.
- Prefer small, composable modules over one large service.
- Implement the smallest change that solves the task.

### 3. Verify (definition of done)

Code merely existing is **not** completion. A task is complete only when its corresponding verification has actually been run and passed.

### 4. Sync the plan

Only after verified success:

- Flip completed tasks from `- [ ]` to `- [x]`; flip a verification item only if it passed.
- Never mark an entire phase complete while any task or verification item in it remains unchecked.
- The plan must stay synchronized with the actual repository state.

### 5. Commit

Follow the Git Workflow (§5).

## 4 · Verification Standards (evidence over optimism)

Minimum bar before declaring a phase complete:

- Type checker passes.
- Linter/formatter checks pass when configured.
- Relevant automated tests pass.
- Phase-specific verification steps from `docs/plan.md` have been executed.
- CLI changes: relevant user-visible workflows are exercised.
- Git/filesystem/encryption changes: use real integration or end-to-end verification where mocks cannot prove the behavior.
- Security changes: test both the intended and denied/error paths where applicable.

**Blocked-verification rule:** if something cannot run due to environmental limits, do not silently mark it complete. Record the limitation, leave the checkbox unchecked, and report exactly what remains unverified.

## 5 · Git Workflow (gates → review → stack → trunk)

1. Read the files the task needs.
2. Implement the smallest viable change.
3. **Gates:** typecheck + tests green before any commit. Red gates = no commit.
4. Run a local review subagent over the diff; fix everything it flags.
5. Commit + PR. Large sequential work → **stacked PRs** instead: one concern per layer, dependencies point downward, every layer passes the gates alone.
6. After ~10 min, address GitHub bot reviews: fix in the **lowest layer owning the issue**, then rebase dependent branches when necessary; re-run gates; commit.
7. Merge to `main` only when required checks and review feedback are resolved. Keep trunk releasable.

Commit discipline — coherent commits tied to a phase or tightly related work.

Format:

```text
phase N: <short description>
```

Documentation-only progress updates may use:

```text
docs: update phase N progress
```

Never commit secrets, tokens, private keys, or local environment files.

## 6 · Product & CLI UX

The CLI is state-driven, intent-oriented, conventional, and agent-native.

- Users express intent; `agenv` determines the safe mechanics.
- Perform safely inferable work automatically.
- Ask only for genuine ambiguity or destructive choices.
- Keep the common path small; expose advanced controls progressively.
- Human output should be concise and conventional.
- Responses should communicate what happened, what matters, and the single best next command when action is required.
- Errors should provide an actionable recovery path when known.
- The same underlying state and recommended action must be available to agents through stable structured output.
- Do not add a top-level command merely because an internal operation exists; prefer composing behavior into an existing user-intent workflow.

## 7 · System Invariants

### State

```text
Machine state
     ↕
Environment repository state
     ↕
Remote Git state
```

`agenv.json` and repository files are canonical environment state. Local registry data is convenience state only.

### Security

- The age private key at `~/.config/agenv/key.txt` never enters repositories, logs, archives, tests, or normal output.
- Sensitive files are encrypted before publication unless an explicit narrow exception exists.
- Never print decrypted secrets or credential material.
- Validate target-relative paths and reject traversal, unsafe links, and destination collisions.
- Tests use temporary directories and test keys, never real credentials or user configuration.

## 8 · Architecture Rules

- `src/commands/` contains CLI orchestration; reusable behavior belongs in shared modules.
- Reuse existing filesystem, Git, process, encryption, manifest, registry, path-validation, logging, and error boundaries.
- Prefer one source of truth for each concept; do not duplicate state or policy across commands.
- Preserve supported Windows, Linux, and macOS behavior.
- Keep command handlers small and deterministic; move business logic into reusable modules.

## 9 · Error & Agent Interface

Human-readable output is the default.

For actionable states, provide the exact next command. For failures, identify the failing subsystem and give the recovery path without exposing secrets.

When structured output is provided, it must represent the same state and recommended action as the human interface; agents must not need to scrape prose.

## 10 · Documentation Discipline

When behavior changes:

- Update `docs/plan.md` if the implementation plan changed.
- Update relevant user/developer documentation and `skills/agenv/SKILL.md`.
- Keep implementation, plan, help, README, and skill instructions aligned.
- Never describe unverified behavior as complete.

## 11 · Scope & YAGNI

Do not build future phases early. Do not add commands, dependencies, abstractions, configuration, or infrastructure without a current requirement.

Optimize for the smallest complete solution.

## 12 · Completion Rule

Say a phase is complete only when **all** of these hold:

1. Every task in the phase is `[x]`.
2. Every verification item in the phase is `[x]`.
3. The implementation matches the phase deliverable.
4. The relevant checks actually ran and passed.
5. `docs/plan.md` reflects the verified state.

When uncertain: **leave the checkbox unchecked** and report what remains unverified. An honest "not yet verified" beats an optimistic "done."

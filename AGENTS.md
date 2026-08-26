# `dotfiles` / `agenv` — Agent Instructions

## 0 · Golden Rules (read this first)

1. **Plan-as-code:** `docs/plan.md` is the single source of truth. Code follows the plan — the plan never silently follows code.
2. **Living document, not carved in stone:** the plan can change, but changes happen by editing `docs/plan.md` first. Chat, TODOs, issues, and agent memory do not authorize silent deviations.
3. **Plan-first integration:** every new feature or integration starts as an amendment to `docs/plan.md` with goal → tasks → deliverable → verification criteria.
4. **Checkboxes are earned, not assumed:** `[x]` means verification actually ran and passed.
5. **Ship the smallest viable change:** one phase at a time, with the required gates green before commit.

## 1 · How We Work: Structured Vibe Coding

- `docs/plan.md` — *what* to build, in what order, and what counts as proof it works.

## 2 · Source-of-Truth Protocol (`docs/plan.md`)

Before writing code:

1. Read `docs/plan.md`.
2. Identify the current incomplete phase (the first phase with unchecked work).
3. Read that phase's goal, tasks, deliverable, and verification criteria.
4. Work only within that phase.

### Amending the plan

Amend the plan **before implementing** when:

- architecture materially changes
- a phase needs splitting or reordering
- an important requirement is discovered
- verification requirements change
- a planned technology is replaced

A fresh agent should be able to continue from the plan without relying on chat history.

## 3 · The Phase Loop

Every phase runs:

```text
Inspect → Implement → Verify → Sync → Commit
```

### 1. Inspect

- Read the current phase completely.
- Survey the existing repository and relevant tests before changing architecture.
- Reuse existing abstractions and conventions where they fit.

### 2. Implement

- Build exactly the active phase's scope.
- Do not implement future phases or speculative abstractions.
- Keep reusable behavior outside CLI orchestration.

### 3. Verify

Verification is part of implementation. Run the checks required by the phase and by the change's risk.

### 4. Sync the plan

Only after verification passes:

- change completed tasks to `[x]`
- change verification items to `[x]` only when actually verified
- record blockers instead of claiming success

### 5. Commit

Follow the Git Workflow below.

## 4 · Verification Standards (evidence over optimism)

Minimum gates before declaring work complete:

- typecheck passes
- relevant tests pass
- full test suite passes when practical
- build/package checks pass when affected
- CLI smoke checks pass when CLI behavior is affected
- security-sensitive behavior has focused regression coverage
- real end-to-end verification is used where mocks cannot prove the behavior

**Blocked-verification rule:** if a check cannot run, leave the related item unchecked and record exactly what remains unverified.

## 5 · Git Workflow (gates → review → stack → trunk)

1. Read the files the task needs.
2. Implement the smallest viable change.
3. **Gates:** typecheck + tests green before any commit. Red gates = no commit.
4. Run a local review subagent over the diff; fix everything it flags.
5. Commit + PR. Large sequential work → **stacked PRs** instead: one concern per layer, dependencies point downward, every layer passes the gates alone.
6. After ~10 min, address GitHub bot reviews: validate each finding, fix genuine issues in the **lowest layer owning the issue**, then re-run affected gates and commit.
7. Merge to `main` only after required checks and review feedback are resolved. Keep trunk releasable.

Commit discipline: keep commits coherent and tied to one phase or tightly related concern. Use the repository's established conventional commit style.

Never commit secrets, tokens, private keys, or local environment files.

## 6 · Product & UX Model

`agenv` absorbs implementation complexity so users and agents can express intent, understand state, and know the next action.

- **Intent over mechanism:** expose user goals, not internal operations.
- **Automation by default:** safely infer and perform work under the hood.
- **State-driven:** determine what is true before deciding what to do.
- **Convention over novelty:** conventional, concise, scriptable CLI behavior.
- **Progressive disclosure:** keep the common path small; advanced controls remain available when needed.
- **Action-driven:** output what happened, what matters, and the single best next command when action is required.
- **Safety over automation:** never silently destroy, overwrite, expose, or discard meaningful user state.
- **Recoverability:** failures should have a concrete recovery path when one is known.
- **Human-first, agent-native:** readable human output and stable structured state for agents must represent the same model.

**Core rule:** **Automate the work. Explain the state. Suggest the next action.**

## 7 · System Invariants

The system has four state layers:

1. **Machine state** — actual user configuration and installed tooling.
2. **Environment state** — `agenv.json` and canonical files under `files/`.
3. **Remote state** — the Git repository used for durable synchronization.
4. **Local registry state** — optional convenience metadata for selecting environments.

`agenv.json` is the environment manifest. Repository files are canonical. Local registry metadata must not become a second source of truth.

### Security

- The age private key lives only at `~/.config/agenv/key.txt` and is never committed, logged, displayed, or copied into an environment repository.
- Sensitive files are encrypted before publication unless an explicit policy says otherwise.
- Never print decrypted secrets or credential material.
- Validate target-relative paths and reject traversal, unsafe links, and destination collisions.
- Tests use temporary directories and test keys, never real credentials or user configuration.

## 8 · Architecture Rules

- `src/commands/` is CLI orchestration; reusable behavior belongs in shared modules.
- Reuse existing filesystem, Git, encryption, manifest, registry, path-validation, logging, and error abstractions.
- Keep one source of truth for each concept.
- Keep platform behavior consistent across supported Windows, Linux, and macOS paths.
- Prefer deterministic, testable logic over large command handlers.

## 9 · Error & Agent Interface

Human output is the default. Keep it concise and conventional.

For actionable states, provide an exact next command. For failures, explain the failing subsystem and the recovery path without exposing secrets.

`--json` is the machine interface: structured output must expose the same underlying state and recommended action without requiring agents to scrape prose.

## 10 · Testing & Documentation

Tests protect behavior and invariants:

- unit tests for deterministic logic and edge cases
- integration tests for module boundaries
- CLI tests for user-visible behavior, exit codes, and structured output
- real end-to-end tests where system behavior cannot be proven by mocks
- regression tests for discovered security, synchronization, and data-loss bugs

When behavior, commands, flags, security rules, architecture, or workflows change, update the affected documentation and `docs/plan.md` in the same change. Keep implementation, plan, help, README, and `SKILL.md` aligned.

## 11 · Scope Control

Prefer the smallest complete solution. Do not add commands, abstractions, dependencies, configuration, or future-facing interfaces without a current requirement.

Before adding something, ask:

> **Does this reduce user or system complexity today, or only prepare for a hypothetical future?**

## 12 · Completion Rule

A phase is complete only when:

1. every task is `[x]`
2. every verification item is `[x]`
3. the implementation matches the deliverable
4. required checks actually passed
5. `docs/plan.md` reflects the verified state

When uncertain, leave the checkbox unchecked and report what remains unverified.

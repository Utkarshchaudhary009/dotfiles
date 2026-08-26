# AGENTS.md — `dotfiles` / `agenv`

## Mission

`agenv` is a portable, encrypted developer-environment manager. It discovers useful development and AI configuration, stores a canonical copy in the environment repository, protects sensitive data with `age`, and makes that environment restorable and synchronizable across machines.

The product goal is simple:

> **The system absorbs complexity so the user can express intent, understand the current state, and know the next action.**

This file is the operating contract for agents working on the repository. Product behavior, CLI design, implementation, tests, documentation, and Git workflow should all reinforce the same model.

## Source of Truth

For non-trivial work, `docs/plan.md` is the execution plan and progress record.

A task that changes behavior, architecture, security, UX, CLI surface, or spans multiple files should begin by updating or creating the relevant plan section before implementation. The plan should state:

- goal and user problem
- current phase and bounded scope
- implementation tasks
- deliverable
- verification criteria
- known constraints or blockers

Plan items are evidence-backed: never mark work complete until the required verification has actually run and passed. If verification is blocked, leave it incomplete and record why.

Small, local fixes can skip a plan when the change is obvious and self-contained.

## Product & UX Principles

Complexity belongs in the implementation, not in the user's mental model.

- **Intent over mechanism:** users express what they want; `agenv` chooses the safe mechanics.
- **Automation by default:** infer and perform everything that can be decided safely; ask only for genuine user decisions.
- **State-driven:** understand the relationship between the machine, environment, and remote before acting.
- **Convention over novelty:** prefer familiar CLI behavior, concise output, deterministic exit codes, and stable machine-readable output.
- **Progressive disclosure:** keep the common path small; advanced controls should appear only when needed.
- **Guidance and actionability:** explain the resulting state and, when action is required, show the single best next command.
- **Predictability:** similar states should behave similarly; avoid hidden or surprising side effects.
- **Safety over automation:** never silently destroy, overwrite, or discard meaningful user state.
- **Minimal intervention:** do not ask questions the system can answer safely itself.
- **Recoverability:** errors should explain the problem and provide an actionable recovery path.
- **Continuity:** each operation should naturally lead to the next state; the user or agent should not need to reconstruct the workflow.
- **Human-first, agent-native:** human output stays conventional and readable; the same state and recommended actions must be available as structured output.

**Core rule:** **Automate the work. Explain the state. Suggest the next action.**

### CLI design constraints

Prefer commands that express user intent over internal implementation stages. Do not add a top-level command merely because a new internal function exists. Before adding a command, ask whether the behavior can be composed into an existing intent-oriented command such as initialization, synchronization, status, restore, capture, or environment management.

The default path should be obvious to a new user and executable by an agent with minimal context. Internal Git, scanning, capture, deployment, reconciliation, encryption, and registry mechanics should stay behind that abstraction whenever safe.

Human output should normally answer:

```text
What happened?
What matters?
What should I do next?
```

When there is no action, say so explicitly. When there is an action, prefer one exact command over a list of possibilities.

Errors should identify the subsystem, explain the safe failure, avoid secrets, and provide the next recovery command when one exists.

## System Model & Invariants

The system has four important layers:

1. **Machine state** — the user's actual configuration files and installed tools.
2. **Environment state** — `agenv.json` plus canonical files under `files/`.
3. **Remote state** — the Git repository used for durable transport and synchronization.
4. **Local registry state** — optional convenience for naming and selecting environments from anywhere.

Treat `agenv.json` as the manifest of environment state. Do not introduce hidden sidecar state when the manifest can represent the information cleanly.

Canonical environment copies belong in the repository. Expansion restores those copies into the user's machine; it must never redefine the repository's canonical source of truth.

### Security invariants

- The age private key lives only at `~/.config/agenv/key.txt` and must never be committed, logged, displayed, or copied into an environment repository.
- Sensitive files must be encrypted before publication. Plaintext exceptions must be explicit and narrowly scoped.
- Never print decrypted secrets or credential material to the terminal, logs, tests, PRs, or agent transcripts.
- `.age` files are encrypted payloads; do not treat them as plaintext configuration.
- Validate target-relative paths before filesystem writes and reject traversal, unsafe links, and destination collisions.
- Tests must be hermetic: use temporary directories and test keys, never real user configuration or credentials.

## Architecture Rules

Keep boundaries explicit and reuse existing abstractions before adding new ones.

- `src/commands/` contains CLI orchestration; reusable behavior belongs in shared modules.
- Keep filesystem, Git, process execution, encryption, path validation, registry, manifest, logging, and error behavior behind their existing modules.
- Prefer one source of truth for each concept. Do not duplicate state or policy across commands.
- A feature should solve the actual user problem without speculating about future phases.
- Preserve platform behavior across Windows, Linux, and macOS where the project supports it.
- Prefer deterministic, testable functions over command handlers that contain large amounts of business logic.

## Development Lifecycle

Use this loop for every meaningful change:

**Plan → Inspect → Implement → Verify → Review → Sync → Commit/PR**

### 1. Plan

Define the smallest useful change and its completion criteria. For multi-step work, update `docs/plan.md` before coding. Do not silently expand scope while implementing.

### 2. Inspect

Read the plan and the smallest relevant set of files before editing. Search for existing patterns, related tests, current command behavior, and current documentation. Prefer extending an existing abstraction over creating a parallel one.

### 3. Implement

Work only within the active scope. Make the smallest coherent change that satisfies the plan. Do not implement future phases, speculative abstractions, or unrelated cleanup in the same change.

When changing behavior, update the tests and affected documentation as part of the same work rather than leaving synchronization to memory.

### 4. Verify

Verification is part of implementation, not a final ceremony. Choose evidence proportional to risk.

Minimum gates before commit:

- typecheck passes
- relevant tests pass
- full test suite passes when practical
- build succeeds when build output is affected
- CLI smoke checks pass when CLI behavior is affected
- security-sensitive changes receive focused regression tests
- real end-to-end verification is required for behavior that depends on Git remotes, networking, encryption, subprocesses, or cross-process coordination when such verification is part of the plan

A test or checklist item is not complete because the code looks correct. It is complete because the required evidence exists.

If a verification step cannot run, do not claim success. Record the blocker and keep the associated completion item unresolved.

### 5. Review

Before opening or merging a PR, review the actual diff as a second pass.

Look for, in order:

1. correctness and unintended behavior
2. security and data-loss risk
3. broken invariants or architectural duplication
4. missing tests or weak verification
5. UX/CLI regressions and unclear next actions
6. stale documentation or plan state

Use an independent review pass or review agent when practical, especially for behavioral, security, synchronization, or CLI changes. Fix findings before merge rather than treating review as documentation.

### 6. Sync

After verification and review, synchronize the plan, tests, documentation, and implementation so they describe the same reality. Never mark a plan item complete merely because implementation exists.

### 7. Commit / PR

Keep commits coherent and traceable to one concern or phase. Do not mix unrelated refactors with behavioral work.

Commit subjects use the existing repository convention: concise, imperative, conventional prefix, with scope and consequence where useful.

PRs should describe:

- what user or system problem changes
- why the change is needed now
- the behavioral or architectural change
- verification actually performed
- known limitations or blocked checks
- explicit out-of-scope follow-ups when relevant

PR detail should scale with risk, not with the number of files changed.

## Review & Merge Discipline

The main branch should remain releasable.

- Do not merge with a red required gate.
- Re-run relevant verification after review fixes and conflict resolution.
- For stacked work, fix a problem in the lowest branch that owns it, then rebase dependent branches and re-run affected gates.
- When review feedback reveals a deeper issue, fix the owning layer rather than adding a compensating workaround elsewhere.
- Treat bot review findings as ordinary engineering feedback: validate them, fix genuine issues, and verify the result.

## Testing Philosophy

Tests should protect behavior and invariants, not implementation trivia.

Prefer:

- unit tests for deterministic logic and edge cases
- integration tests for module boundaries
- CLI tests for user-visible behavior, exit codes, and structured output
- real end-to-end tests for system behavior that mocks cannot prove
- regression tests for every discovered security, synchronization, or data-loss bug

New behavior is incomplete until the test strategy is clear and the relevant evidence exists.

## Documentation Discipline

Documentation is part of the product contract.

When behavior, commands, flags, security rules, architecture, or workflows change, update the affected docs in the same change. Keep the CLI reference, skill instructions, plan, README, and implementation aligned.

Do not preserve stale documentation merely because it describes an older interface. The implementation, plan, and user-facing docs should converge on one current reality.

## Scope & YAGNI

Optimize for the smallest complete solution, not the smallest diff.

Do not add abstractions, commands, configuration, dependencies, or future-facing interfaces without a present requirement. When a simpler existing mechanism solves the problem, use it.

A useful question before adding anything:

> **Does this reduce user or system complexity today, or does it only prepare for a hypothetical future?**

## Repository Map

```text
src/
  cli.ts                CLI entry and command registration
  commands/             command orchestration
  scanner.ts            configuration discovery
  manifest.ts           environment manifest and persistence
  deploy.ts             capture/deploy/encryption plumbing
  registry.ts           local environment registry
  resolve.ts            target resolution
  git.ts / proc.ts      Git and subprocess boundaries
  deps.ts               dependency checks
  platform.ts / fs.ts   cross-platform filesystem helpers
  logger.ts / errors.ts user-facing output and actionable errors
  config.ts / types.ts  configuration and shared types

tests/                  hermetic test suites
docs/                    user/developer documentation and plans
skills/                 agent-facing operational instructions
.github/workflows/      CI, release, and documentation automation
```

## Tooling

```bash
bun install
bun run typecheck
bun test
bun run build
bun ./src/cli.ts --help
bun ./src/cli.ts --version
bun ./src/cli.ts doctor
```

Use the smallest relevant command during iteration, then run the full required gates before committing. Never bypass a failing gate by weakening the check without explicitly fixing the underlying problem.

## Completion Rule

A task is done only when the implementation, tests, documentation, plan state, and verification evidence agree.

**Code is not complete when it exists. It is complete when the intended behavior is verified, reviewed, documented, and ready to ship.**

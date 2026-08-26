# AGENTS.md — `dotfiles` / `agenv`

## Mission

`agenv` is a portable, encrypted developer-environment manager. It discovers useful development and AI configuration, stores a canonical copy in an environment repository, protects sensitive data with `age`, and restores/synchronizes that environment across machines.

The product principle is:

> **Automate the work. Explain the state. Suggest the next action.**

Agents working here should preserve that principle across implementation, CLI behavior, tests, documentation, and release work.

## Source of Truth

`docs/plan.md` is the roadmap and progress record for non-trivial work.

Use it when a change affects behavior, architecture, security, UX, CLI surface, or multiple files. Keep scope, deliverables, and verification criteria there. Mark work complete only after the required verification has passed.

Small, self-contained fixes do not need a plan entry.

## Product & UX

Complexity belongs in the implementation, not in the user's mental model.

- **Intent:** commands express user goals, not internal mechanics.
- **Automation:** safely infer and perform routine work without unnecessary prompts.
- **State:** inspect machine, environment, and remote state before deciding what to do.
- **Convention:** follow familiar CLI behavior, concise output, standard exit codes, and deterministic structured output.
- **Progressive disclosure:** keep the common path small; expose advanced controls only when needed.
- **Actionability:** output should say what happened, what matters, and the best next command.
- **Safety:** never silently overwrite, delete, expose, or discard meaningful user state.
- **Recoverability:** failures should explain the problem and give a recovery path when one is known.
- **Agent-native:** human output remains readable; the same state and next action must be available to automation.

Do not add a top-level command merely because an internal function exists. Prefer extending an existing intent-oriented command when it can express the behavior clearly.

## System Model

Keep these layers distinct:

1. **Machine state** — actual user configuration and installed tools.
2. **Environment state** — `agenv.json` and canonical files under `files/`.
3. **Remote state** — the Git repository used for durable synchronization.
4. **Local registry** — optional convenience metadata for selecting environments.

`agenv.json` is the environment manifest. Canonical copies live in the environment repository; restoration writes those copies to the machine.

### Security invariants

- The age private key lives only at `~/.config/agenv/key.txt` and never belongs in a repository, log, terminal output, test fixture, or agent transcript.
- Sensitive files are encrypted before publication unless an explicit policy says otherwise.
- Never print decrypted secrets or credential material.
- Validate paths before filesystem writes; reject traversal, unsafe links, and destination collisions.
- Tests use temporary directories and test keys, never real user configuration or credentials.

## Architecture

- CLI orchestration belongs in `src/commands/`; reusable behavior belongs in shared modules.
- Preserve existing boundaries for filesystem, Git, subprocesses, encryption, registry, manifest, paths, logging, and errors.
- Keep one source of truth for each concept. Avoid parallel state or policy.
- Prefer small, deterministic, testable functions over large command handlers.
- Preserve supported Windows, Linux, and macOS behavior.
- Do not build future phases or speculative abstractions into the current change.

## Development Workflow

For meaningful changes:

**Plan → Inspect → Implement → Verify → Review → Sync → Commit/PR**

### Plan

Define the smallest complete change and its verification criteria in `docs/plan.md` when the work is non-trivial.

### Inspect

Read the relevant plan, implementation, tests, and documentation. Search for existing abstractions before creating new ones.

### Implement

Stay within scope. Update affected tests and documentation with the behavior change.

### Verify

Use evidence proportional to risk. At minimum, run the relevant typecheck and tests; run the full suite, build, CLI smoke tests, security checks, and real integration/E2E checks when the change requires them.

Do not claim a blocked check passed. Record the blocker and leave the corresponding plan item incomplete.

### Review

Review the actual diff before merge. Prioritize:

1. correctness and unintended behavior
2. security and data-loss risk
3. broken invariants or duplicated policy
4. missing or weak verification
5. CLI/UX regressions
6. stale documentation or plan state

Use an independent review pass or review agent for higher-risk changes when practical. Treat GitHub automated review bots as review input: validate each finding, fix genuine issues, and rerun affected checks.

### Sync

Bring implementation, tests, docs, `SKILL.md`, and `docs/plan.md` back to the same verified state.

### Commit / PR

Keep commits focused and traceable to one concern or phase. PRs should state the problem, behavioral change, verification performed, and known limitations. Do not claim checks that were not run.

## Review & Merge

`main` should remain releasable.

- Do not merge with a failing required gate.
- After review fixes or conflict resolution, rerun affected verification.
- In stacked work, fix the owning branch first, then rebase dependents and reverify.
- Fix root causes in the layer that owns them rather than adding compensating workarounds.

## Testing

Test behavior and invariants rather than implementation trivia.

Prefer:

- unit tests for deterministic logic and edge cases
- integration tests for module boundaries
- CLI tests for user-visible output, exit codes, and structured output
- real E2E tests where mocks cannot establish correctness
- regression tests for discovered security, synchronization, and data-loss bugs

## Documentation

When behavior, commands, flags, security rules, architecture, or workflows change, update the affected documentation in the same change.

Keep the README, CLI help/reference, `SKILL.md`, `docs/plan.md`, and implementation aligned. Do not preserve stale instructions merely because they describe the old interface.

## Scope

Prefer the smallest complete solution.

Before adding a command, abstraction, dependency, configuration option, or future-facing interface, ask:

> **Does this solve a present problem or only prepare for a hypothetical one?**

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

Use the narrowest relevant check while iterating, then run the required gates before committing.

## Definition of Done

A change is done when its intended behavior is implemented, verified, reviewed, documented, and reflected in the plan when applicable.

**Core rule: Automate the work. Explain the state. Suggest the next action.**

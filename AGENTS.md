# AGENTS.md — dotfiles (agenv)

## What This Is

`agenv` — a portable, encrypted AI developer environment manager, shipped as an npm CLI from this repo. It scans your machine for dev/AI configs (OpenCode, Claude, Git, VSCode, shell), packs them into a Git-backed repo (`files/<category>/` + `agenv.json` manifest), encrypts secrets with `age` (X25519), publishes to GitHub, and deploys anywhere with two commands: `agenv clone` → `agenv expand`.

## Principles

- **Simplest solution wins.** If it takes a paragraph to explain, redesign it.
- **Encryption first.** Anything touching keys, tokens, or credentials must prompt for `age` encryption.
- **No hidden state.** All repository state lives in the `agenv.json` manifest — no sidecar files, no symlink spaghetti.
- **Never edit outside the repo.** Canonical copies stay in `files/`; `$HOME` receives them at `expand` time.

## UX & UI Philosophy

The product should minimize cognitive load without minimizing capability. Complexity belongs in the implementation, not in the user's mental model.

- **Intent over mechanism.** Users express what they want; agenv determines how to accomplish it. Avoid exposing internal Git, scan, capture, deploy, or reconciliation steps when they can be handled automatically.
- **Automation by default.** Safely infer and perform everything possible. Ask only when a meaningful decision cannot be made safely or when an operation could discard user state.
- **State-driven interaction.** Understand the current relationship between the local machine, the agenv environment, and the remote repository before acting. Commands should move the environment from one state to another rather than require users to understand internal workflows.
- **Convention over novelty.** Use familiar CLI conventions: concise output, predictable commands, standard exit codes, correct stdout/stderr semantics, and deterministic machine-readable output.
- **Progressive disclosure.** Keep the common path small and obvious. Preserve advanced capabilities, but expose them only when they are relevant or explicitly requested.
- **Guidance over information density.** Explain what happened and what matters. Do not dump internal operations or noisy progress that does not help the user decide what to do.
- **Actionability.** When action is required, provide one clear recommended next step with the exact command to run. Prefer a single obvious action over a menu of possibilities.
- **Predictability.** Similar states should produce similar behavior and output. Avoid surprising side effects and implicit changes that users cannot reason about.
- **Safety over automation.** Never silently overwrite, delete, or discard meaningful local or remote state. Conflicts and destructive ambiguity require explicit resolution.
- **Minimal intervention.** Do not ask questions that the system can safely answer itself. Every prompt should represent a genuine decision or missing information.
- **Recoverability.** Errors are recoverable states, not dead ends. Explain the problem, give the relevant fix, and provide the next command whenever possible.
- **Continuity.** Every workflow should naturally lead to its next state. A user or agent should never need to wonder what to do next or reconstruct the workflow from documentation.
- **Human-first, agent-native.** Human output is concise and conventional. The same underlying state and recommended actions must be available through deterministic structured output for agents and automation.
- **Cognitive minimalism.** Minimize the concepts, decisions, commands, and context the user must hold in their head — not the capabilities of the system.

**Core UX rule:** **Automate the work. Explain the state. Suggest the next action.**

## Stack

TypeScript 5 (strict, ESM) · Bun ≥1.0 (dev runtime, bundler, test runner) · build targets Node ≥18 (`dist/agenv.js`) · commander (CLI) · @clack/prompts (interactive UI) · chalk · `age` binary (external encryption dep)

## Layout

```
src/
  cli.ts                # commander entry — registers every subcommand
  commands/             # one file per subcommand (init, clone, expand, publish, …)
  scanner.ts            # discovers trackable configs by category
  manifest.ts           # agenv.json schema, load/save
  deploy.ts             # expands files/ → $HOME
  registry.ts           # global multi-environment registry (bind/use/envs)
  resolve.ts            # target resolution: name | path | git URL
  git.ts proc.ts        # git + subprocess wrappers
  deps.ts               # dependency checks (git, gh, age)
  platform.ts fs.ts logger.ts errors.ts config.ts types.ts
tests/                  # bun test suites — hermetic, temp dirs only
scripts/fix-shebang.mjs # post-build shebang patch for dist/
docs/                   # CLI.md, SETUP-GUIDE.md, ENVIRONMENTS.md, RELEASING.md
```

## Security Invariants

- The age private key lives only at `~/.config/agenv/key.txt` — never copy it into the repo, tests, or logs.
- Files ending in `.age` are encrypted and safe to publish; treat everything else as public.
- `.gitignore` blocks keys and credentials (`key.txt`, `*.age`, `.credentials.json`) — keep it that way.
- Tests are hermetic: temp directories only, never real user configs or keys.

## Conventions

- Strict TS; avoid `any` — use `unknown` and narrow.
- New subcommand ⇒ one new file in `src/commands/`, registered in `src/cli.ts`.
- Errors come from `src/errors.ts`; user-facing output goes through `src/logger.ts` and clack prompts.
- One concern per commit.
- **Commit subjects:** conventional prefix, imperative mood, ≤72 chars, scope + consequence (`fix(expand): resolve symlinked targets to avoid clobbering real files`) — not what was edited.
- **Commit bodies:** one paragraph — cause → fix mechanism → scope/test delta.
- **PRs:** length scales with risk, never effort. Mechanical change → one line; behavioral change → reasoning plus a why-now note. State what breaks and who hits it, not which files were touched. Exactly one author voice — no stacked bot summaries.

## Commands

```powershell
bun install                       # dependencies
bun run build                     # bundle → dist/agenv.js (+ shebang fix)
bun run typecheck                 # tsc --noEmit
bun test                          # full suite
bun test tests/manifest.test.ts   # single file
bun ./src/cli.ts --help           # run the CLI from source
```

## Workflow

1. Read the files the task needs; architecture rules live in `docs/CONTRIBUTING.md`.
2. Implement the smallest change that solves it.
3. **Gates:** typecheck and tests green before any commit.
4. Commit (conventional style) and open a PR.

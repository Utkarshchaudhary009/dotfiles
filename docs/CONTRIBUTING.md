# Contributing to `agenv`

Thank you for your interest in contributing to the Antigravity Environment Manager (`agenv`)! 

## Local Development Setup

The `agenv` CLI is written in TypeScript and uses the fast [Bun](https://bun.sh) runtime.

### 1. Requirements
- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)
- [Git](https://git-scm.com/)
- [age](https://github.com/FiloSottile/age) (Optional but highly recommended for testing encryption features).

### 2. Clone and Install
```bash
git clone https://github.com/your-username/dotfiles.git
cd dotfiles
bun install
```

### 3. Running the CLI locally
You can run the CLI directly from the source code without needing to build it:

```bash
bun ./src/cli.ts --help
```

To test commands like `status`, `scan`, or `list` against your local machine:
```bash
bun ./src/cli.ts scan
bun ./src/cli.ts doctor
```

### 4. Testing

Run the full test suite with Bun's built-in test runner:

```bash
bun test
```

Run a single test file:

```bash
bun test tests/<file>.test.ts
```

Generate a coverage report:

```bash
bun test --coverage
```

Tests are hermetic: they run against temporary directories and never touch your real user configs or encryption keys.

### 5. Code Standards
- We enforce strict typing. Before opening a Pull Request, ensure that type checking passes:
  ```bash
  bun x tsc --noEmit
  ```
- Make sure not to commit any test encryption keys or personal `.age` files to the main branch.

## Architecture Guidelines
When developing new features:
1. **Never edit files in place outside the repo.** `agenv` operates by storing things centrally in `./files/` and linking/copying them to the user's `$HOME`.
2. **Encryption First.** Any new feature handling keys, tokens, or credentials MUST prompt the user for encryption via `age`.
3. **No hidden files for state.** All repository state belongs in `agenv.json`.

Feel free to open an issue before submitting a large PR to discuss the architecture of your proposed changes!
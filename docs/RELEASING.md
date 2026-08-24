# Releasing `agenv`

This guide documents how to publish new versions of the `agenv` CLI to npm. It is aimed at maintainers with publish access to the `agenv` npm package.

## Versioning Policy (Semver)

`agenv` follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

| Bump | When | Examples |
|------|------|----------|
| **Major** (`X.0.0`) | Breaking changes to the CLI or its behavior | Removing a command, changing argument/flag semantics, incompatible manifest (`agenv.json`) changes, breaking output format |
| **Minor** (`0.X.0`) | Backwards-compatible additions | New commands or options, new discoverable categories, additive manifest fields |
| **Patch** (`0.0.X`) | Backwards-compatible bug fixes | Crash fixes, encryption/decryption fixes, error-message improvements |

Rule of thumb: if existing users' commands, scripts, or environment repos would break after upgrading, it's a **major** bump.

## Release Checklist

Run these steps in order from a clean `main` branch:

```bash
git checkout main
git pull origin main
bun install
```

### 1. Run quality gates locally

```bash
bunx tsc --noEmit
bun test
bun run build
```

CI runs the same checks (typecheck, build, node-compat check, packaging check, secret scan) on every push, so this is a pre-flight — not a substitute — but catch issues before you tag.

### 2. Verify node compatibility

```bash
node dist/agenv.js --version
```

The published package targets Node.js >= 18. Confirm the built bundle runs under plain Node, not just Bun.

### 3. Bump the version

`npm version` updates `package.json`, commits the change, and creates a matching git tag:

```bash
npm version patch    # bug fixes
npm version minor    # new commands/options
npm version major    # breaking changes
```

You can also use the explicit form: `npm version 1.1.0`.

### 4. Publish to npm

First-time or expired credentials? Log in (only needed once per npm session):

```bash
npm login
```

Then publish:

```bash
npm publish
```

`prepublishOnly` runs automatically (`bun install`, typecheck, build), so the tarball is verified before upload.

### 5. Push the tag and commit

```bash
git push origin main --tags
```

### 6. (Optional) Create a GitHub Release

Create a release for the new tag with changelog notes. Summarize:

- **Added** — new commands/options
- **Fixed** — bugs resolved
- **Changed** — behavior or dependency changes

Link the release to the tag created by `npm version` so users can see what changed between versions.

## How Users Receive Updates

`agenv` is installed globally via npm, so users get updates by upgrading the npm package — not by anything inside an environment repo:

```bash
npm update -g agenv
# or, to force the latest published version:
npm install -g agenv@latest
```

To check which version they're running:

```bash
agenv --version
```

Note: `agenv update` (inside an environment repo) pulls remote changes and re-expands the environment — it does **not** update the CLI itself.

## Hotfix Flow

For a critical bug fix that needs to ship without waiting on unrelated work:

1. Branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b fix/<short-description>
   ```
2. Fix the bug, run quality gates:
   ```bash
   bunx tsc --noEmit && bun test && bun run build
   ```
3. Patch bump and publish:
   ```bash
   npm version patch
   npm publish
   ```
4. Merge back to `main` and push:
   ```bash
   git push origin main --tags
   git push origin fix/<short-description>
   # open a PR from fix/<short-description> -> main, then merge
   ```

Keep the hotfix change minimal so it can be reviewed and merged quickly.

## Pre-release Flow (Optional)

For release candidates and beta versions (e.g., validating a new minor feature before it's generally available):

```bash
npm version minor
npm publish --tag beta
```

Users opt into the beta explicitly:

```bash
npm install -g agenv@beta
```

Betas do not replace the `latest` tag, so regular users are unaffected. When you're ready, promote the beta to latest:

```bash
npm publish --tag latest
```

## Rollback

If a release is broken:

- **Re-publish the previous good version** — this is the preferred rollback. Check the last known-good tag (`git tag`), checkout its `package.json` version, and publish it. Users upgrading (or running `npm install -g agenv@latest`) then receive the good version.
- **`npm unpublish`** — only as a last resort, and only for recently published broken releases:
  ```bash
  npm unpublish agenv@<broken-version>
  ```
  npm only allows unpublishing within 72 hours of publish. After that window, the version is permanent and re-publishing a fixed version is the only path. Unpublishing a version users may already depend on can break their installs, so prefer re-publishing a fix first.

After any rollback, push a follow-up patch so the repository history and published versions stay aligned.

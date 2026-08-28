import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest, saveManifest } from "../src/manifest";
import { discoverConfigs, buildListing, applyDiscovered, ScanOptions } from "../src/commands/scan";
import { collectStatus, statusHints, StatusSummary } from "../src/commands/status";
import { FileCandidate } from "../src/scanner";
import { runProcess } from "../src/proc";

describe("scan --apply + status", () => {
  let tmpBase: string;
  let envSeq = 0;

  interface Env {
    repoDir: string;
    homeRoot: string;
    ocRoot: string;
  }

  beforeAll(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-scan-status-"));
  });

  afterAll(async () => {
    if (tmpBase) await fs.rm(tmpBase, { recursive: true, force: true });
  });

  /** Fresh repo + fake home per test — hermetic and order-independent. */
  async function makeEnv(): Promise<Env> {
    const n = ++envSeq;
    const repoDir = path.join(tmpBase, `repo-${n}`);
    const homeRoot = path.join(tmpBase, `home-${n}`);
    const ocRoot = path.join(homeRoot, ".config", "opencode");
    await fs.mkdir(path.join(repoDir, "files"), { recursive: true });
    await fs.mkdir(ocRoot, { recursive: true });
    // keyPath deliberately points nowhere so encrypted entries count as locked.
    await fs.writeFile(
      path.join(repoDir, "agenv.json"),
      JSON.stringify({
        version: 1,
        config: {
          rootDir: repoDir,
          encryption: { method: "age", keyPath: path.join(tmpBase, "missing-key.txt") },
          categories: [
            { id: "opencode", label: "Opencode", enabled: true, targetRoot: ocRoot },
          ],
        },
        files: [],
      })
    );
    return { repoDir, homeRoot, ocRoot };
  }

  async function withFakeHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      return await fn();
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
    }
  }

  async function write(env: Env, rel: string, content: string): Promise<string> {
    const p = path.join(env.ocRoot, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return p;
  }

  test("discoverConfigs honors category filter and preset whitelist; listing summarizes first", async () => {
    const env = await makeEnv();
    await write(env, "opencode.json", "{}");
    await write(env, "tui.json", "{}"); // NOT in the scanner whitelist
    await write(env, "skills/demo/SKILL.md", "# d");

    const doc = buildListing(await withFakeHome(env.homeRoot, () => discoverConfigs("opencode")));
    expect(doc.summary.total).toBe(2);
    expect(doc.summary.categories).toEqual([{ category: "opencode", count: 2 }]);
    const rels = doc.files.map(f => f.targetRel.replace(/\\/g, "/"));
    expect(rels).toContain("opencode.json");
    expect(rels).toContain("skills/demo/SKILL.md");
    expect(rels.some(r => r.endsWith("tui.json"))).toBe(false);

    await expect(discoverConfigs("nope")).rejects.toThrow(/Unknown category/);
  });

  test("applyDiscovered tracks discoveries; rerun skips; drift + update refreshes", async () => {
    const env = await makeEnv();
    await write(env, "skills/demo/SKILL.md", "# v1");

    const { cands, out1 } = await withFakeHome(env.homeRoot, async () => {
      const c = await discoverConfigs("opencode");
      return { cands: c, out1: await applyDiscovered(env.repoDir, c, {}) };
    });
    expect(out1.added).toHaveLength(1);
    expect(out1.failed).toHaveLength(0);

    const out2 = await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));
    expect(out2.added).toHaveLength(0);
    expect(out2.skipped[0].reason).toContain("already tracked");

    // Drift on disk, then --update captures the local version.
    await write(env, "skills/demo/SKILL.md", "# v2-drifted");
    const out3 = await withFakeHome(env.homeRoot, () =>
      applyDiscovered(env.repoDir, cands, { update: true, yes: true })
    );
    expect(out3.updated).toHaveLength(1);
    const stored = await fs.readFile(
      path.join(env.repoDir, "files", "opencode", "skills__demo__SKILL.md"),
      "utf8"
    );
    expect(stored).toBe("# v2-drifted");
  });

  test("sensitive discoveries demand --encrypt even via scan", async () => {
    const env = await makeEnv();
    await write(env, "agents/auth.json", '{"k":"v"}'); // keyword 'auth' → sensitive

    const denied = await withFakeHome(env.homeRoot, async () =>
      applyDiscovered(env.repoDir, await discoverConfigs("opencode"), {} as ScanOptions)
    );
    expect(denied.added).toHaveLength(0);
    expect(denied.skipped[0].reason).toContain("--encrypt");

    const m = await loadManifest(env.repoDir);
    expect(m.files).toHaveLength(0);
  });

  test("collectStatus buckets every state, orders problems first, hints act on them", async () => {
    const env = await makeEnv();
    // unchanged candidate: real add flow captures store copy == disk.
    await write(env, "opencode.json", "{}");
    const cands = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));
    // conflict: drift the captured file.
    await write(env, "opencode.json", '{"drift":true}');

    const m = await loadManifest(env.repoDir);
    // repo-missing: manifest entry without a store copy.
    m.files.push({ id: "opencode:tui.json", category: "opencode", targetRel: "tui.json", encrypt: false });
    await write(env, "tui.json", "{}");
    // target-missing: entry whose store copy exists but disk file is gone.
    m.files.push({ id: "opencode:ghost.json", category: "opencode", targetRel: "ghost.json", encrypt: false });
    await fs.mkdir(path.join(env.repoDir, "files", "opencode"), { recursive: true });
    await fs.writeFile(path.join(env.repoDir, "files", "opencode", "ghost.json"), "{}");
    // locked: encrypted entry, garbage store bytes, no key on disk.
    m.files.push({ id: "opencode:vault.bin", category: "opencode", targetRel: "vault.bin", encrypt: true });
    await write(env, "vault.bin", "secret-bytes");
    await fs.writeFile(path.join(env.repoDir, "files", "opencode", "vault.bin.age"), "not-real-age");
    await saveManifest(env.repoDir, m);

    const result = await collectStatus(env.repoDir, m);
    expect(result.summary).toEqual({ total: 4, ok: 0, modified: 1, notCaptured: 1, missing: 1, locked: 1 });
    // Problems surface before healthy rows.
    expect(result.files.map(f => f.state)).toEqual(["conflict", "repo-missing", "locked", "target-missing"]);

    const hints = statusHints(result.summary, undefined, "no-remote");
    expect(hints.some(h => h.includes("modified"))).toBe(true);
    expect(hints.some(h => h.includes("not yet captured") && h.includes("--update"))).toBe(true);
    expect(hints.some(h => h.includes("restore"))).toBe(true);
    expect(hints.some(h => h.includes("age-keygen"))).toBe(true);
    // sync must never be suggested for capturing local edits.
    expect(hints.every(h => !h.includes("agenv sync"))).toBe(true);

    const clean: StatusSummary = { total: 2, ok: 2, modified: 0, notCaptured: 0, missing: 0, locked: 0 };
    // When there is a remote, the in-sync hint is the only one. With no
    // remote, the "publish" hint replaces it — both are valid terminal states.
    expect(statusHints(clean, undefined, "in-sync")).toEqual(["Everything in sync — back up with: agenv push"]);
    expect(statusHints(clean, undefined, "no-remote")).toEqual(["No remote configured — publish with: agenv publish <url>"]);
    // Diverged branches need reconciliation, not a plain push (which would
    // fail non-fast-forward). The hint must point at a command that actually
    // reconciles (sync uses --ff-only, so a rebase has to come from git).
    const divergedHints = statusHints(clean, undefined, "diverged");
    expect(divergedHints.some(h => h.includes("pull --rebase"))).toBe(true);
    expect(divergedHints.some(h => h.includes("agenv push"))).toBe(true);
    expect(divergedHints.every(h => !/^[^—]*— publish with: agenv push$/.test(h))).toBe(true);
    // 'unknown' state should never fabricate a remote hint.
    expect(statusHints(clean, undefined, "unknown")).toEqual(["Everything in sync — back up with: agenv push"]);
  });

  test("applyDiscovered registers missing preset categories so entries stay visible", async () => {
    const env = await makeEnv(); // manifest above only registers 'opencode'
    const src = path.join(env.homeRoot, ".agents", "skills", "x.md");
    await fs.mkdir(path.dirname(src), { recursive: true });
    await fs.writeFile(src, "# agent skill");
    const cands = [
      { category: "agents", sourcePath: src, targetRel: path.join("skills", "x.md"), sensitive: false },
    ] as unknown as FileCandidate[];

    await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));

    const m = await loadManifest(env.repoDir);
    const cat = m.config.categories.find(c => c.id === "agents");
    expect(cat?.targetRoot).toBe("~/.agents");

    // Before the fix this entry was invisible: collectStatus skipped it.
    const result = await withFakeHome(env.homeRoot, () => collectStatus(env.repoDir, m));
    expect(result.summary.total).toBe(1);
    expect(result.summary.ok).toBe(1);
  });

  test("applyDiscovered leaves config.categories alone when every candidate is skipped", async () => {
    const env = await makeEnv();
    const src = path.join(env.homeRoot, ".agents", "auth.json"); // keyword 'auth' → sensitive
    await fs.mkdir(path.dirname(src), { recursive: true });
    await fs.writeFile(src, "{ \"token\": 1 }");
    const cands = [
      { category: "agents", sourcePath: src, targetRel: "auth.json", sensitive: true },
    ] as unknown as FileCandidate[];

    const out = await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));
    expect(out.added).toHaveLength(0);
    expect(out.skipped[0].reason).toContain("--encrypt");

    const m = await loadManifest(env.repoDir);
    expect(m.config.categories.some(c => c.id === "agents")).toBe(false);
  });

  test("discoverConfigs is deterministic: identical results across repeated runs", async () => {
    const env = await makeEnv();
    await write(env, "opencode.json", "{}");
    await write(env, "skills/a/SKILL.md", "a");
    await write(env, "skills/b/SKILL.md", "b");

    const stableKey = (c: FileCandidate) => `${c.category}::${c.targetRel}`;
    const r1 = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    const r2 = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    expect(r2.length).toBe(r1.length);
    expect(r2.map(stableKey).sort()).toEqual(r1.map(stableKey).sort());
  });

  test("applyDiscovered is idempotent: rerunning never duplicates or re-captures unchanged files", async () => {
    const env = await makeEnv();
    await write(env, "opencode.json", "{}");
    const cands = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    const first = await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));
    expect(first.added).toHaveLength(1);
    const second = await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));
    expect(second.added).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);

    const m = await loadManifest(env.repoDir);
    expect(m.files.filter(f => f.targetRel === "opencode.json")).toHaveLength(1);
  });

  test("collectStatus reports no-remote and ahead remote states", async () => {
    const env = await makeEnv();
    // Need at least one tracked file so remote state matters.
    await write(env, "opencode.json", "{}");
    const cands = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));
    // Initialize a real git repo so remote-state can be computed.
    const init = await runProcess(["git", "init", "-q"], { cwd: env.repoDir });
    if (init.code !== 0) {
      // git binary unavailable in sandbox — skip rather than fail the test.
      return;
    }
    await runProcess(["git", "config", "user.email", "t@e"], { cwd: env.repoDir });
    await runProcess(["git", "config", "user.name", "t"], { cwd: env.repoDir });
    await runProcess(["git", "add", "-A"], { cwd: env.repoDir });
    await runProcess(["git", "commit", "-q", "-m", "init"], { cwd: env.repoDir });

    // No origin yet → no-remote.
    const manifest = await loadManifest(env.repoDir);
    const noOrigin = await collectStatus(env.repoDir, manifest);
    expect(noOrigin.remote).toBe("no-remote");
    expect(statusHints(noOrigin.summary, undefined, noOrigin.remote).some(h => h.includes("publish"))).toBe(true);

    // Add a local origin (no fetch) — upstream doesn't exist yet, so 'ahead'.
    await runProcess(["git", "remote", "add", "origin", env.repoDir], { cwd: env.repoDir });
    const withOrigin = await collectStatus(env.repoDir, manifest);
    expect(withOrigin.remote).toBe("ahead");
    expect(statusHints(withOrigin.summary, undefined, withOrigin.remote).some(h => h.includes("agenv push"))).toBe(true);
  });

  test("gitRemoteState reports 'unknown' when rev-list fails (does not silently mark in-sync)", async () => {
    const { gitRemoteState } = await import("../src/git");
    const env = await makeEnv();
    await write(env, "opencode.json", "{}");
    await runProcess(["git", "init", "-q"], { cwd: env.repoDir });
    if ((await runProcess(["git", "rev-parse", "--git-dir"], { cwd: env.repoDir })).code !== 0) {
      return; // git unavailable
    }
    await runProcess(["git", "config", "user.email", "t@e"], { cwd: env.repoDir });
    await runProcess(["git", "config", "user.name", "t"], { cwd: env.repoDir });
    // Add a commit so HEAD exists and we get past the no-upstream branch.
    await runProcess(["git", "add", "-A"], { cwd: env.repoDir });
    await runProcess(["git", "commit", "-q", "-m", "init"], { cwd: env.repoDir });
    // Create a local bare "origin" repo, register it, and push so @{u} resolves
    // to a real ref. Then shadow `git` on PATH with a wrapper that fails
    // `rev-list --count` — the only signal we want to test is that this
    // failure path returns 'unknown' instead of silently claiming in-sync.
    const originDir = mkdtempSync(path.join(os.tmpdir(), "agenv-origin-"));
    const init = await runProcess(["git", "init", "--bare", "-q"], { cwd: originDir });
    if (init.code !== 0) return; // git unavailable
    await runProcess(["git", "remote", "add", "origin", originDir], { cwd: env.repoDir });
    // Push the current branch (whatever it's named) to origin.
    const branchRes = await runProcess(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: env.repoDir });
    const branch = branchRes.stdout.trim() || "main";
    const push = await runProcess(["git", "push", "-q", "origin", `HEAD:refs/heads/${branch}`], { cwd: env.repoDir });
    if (push.code !== 0) return; // push failed — skip
    await runProcess(["git", "branch", "--set-upstream-to", `origin/${branch}`], { cwd: env.repoDir });

    // Sanity: without the wrapper, state is 'in-sync'.
    const baseline = await gitRemoteState(env.repoDir);
    expect(baseline).toBe("in-sync");

    // Build a fake `git` wrapper that delegates to the real git but fails
    // rev-list --count with a non-zero exit. Prepend its directory to PATH.
    // The whole setup+assert runs inside a single try/finally so any throw
    // (during mkdtemp/writeFile/chmod/expect) restores PATH. The wrapper dir
    // is small and ephemeral; bun:test temp dirs are cleaned by the runner.
    const which = await runProcess(["which", "git"], { cwd: env.repoDir });
    const realGit = which.stdout.trim();
    if (!realGit) return;
    const oldPath = process.env.PATH;
    const binDir = mkdtempSync(path.join(os.tmpdir(), "agenv-fakebin-"));
    const wrapper = path.join(binDir, "git");
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "rev-list" ] && [ "$2" = "--count" ]; then exit 128; fi\nexec ${JSON.stringify(realGit)} "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
    try {
      const state = await gitRemoteState(env.repoDir);
      expect(state).toBe("unknown");
    } finally {
      process.env.PATH = oldPath;
    }
  });
});

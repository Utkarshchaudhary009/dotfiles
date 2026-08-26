import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest, saveManifest } from "../src/manifest";
import { discoverConfigs, buildListing, applyDiscovered, ScanOptions } from "../src/commands/scan";
import { collectStatus, statusHints, StatusSummary } from "../src/commands/status";
import { scanSystem, FileCandidate } from "../src/scanner";
import { classifyCandidates } from "../src/capture";

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
    expect(result.summary).toEqual({ total: 4, ok: 0, modified: 1, needsCapture: 1, missing: 1, locked: 1, remote: { configured: false, ahead: 0, behind: 0 } });
    // Problems surface before healthy rows.
    expect(result.files.map(f => f.state)).toEqual(["conflict", "repo-missing", "locked", "target-missing"]);

    const hints = statusHints(result.summary);
    expect(hints.some(h => h.includes("modified"))).toBe(true);
    expect(hints.some(h => h.includes("need capture") && h.includes("--update"))).toBe(true);
    expect(hints.some(h => h.includes("restore"))).toBe(true);
    expect(hints.some(h => h.includes("age-keygen"))).toBe(true);
    // sync must never be suggested for capturing local edits.
    expect(hints.every(h => !h.includes("agenv sync"))).toBe(true);

    const clean: StatusSummary = { total: 2, ok: 2, modified: 0, needsCapture: 0, missing: 0, locked: 0, remote: { configured: false, ahead: 0, behind: 0 } };
    expect(statusHints(clean)).toEqual(["Everything in sync — back up with: agenv push"]);
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

  test("scanSystem is deterministic and stably ordered for the same machine state", async () => {
    const env = await makeEnv();
    await write(env, "opencode.json", "{}");
    await write(env, "smart-title.jsonc", "{}");
    await write(env, "agents/demo/SKILL.md", "# d");
    await write(env, "skills/other/SKILL.md", "# o");

    const run = async () => withFakeHome(env.homeRoot, () => scanSystem(["opencode", "claude", "git", "shell", "vscode", "agents"]));
    const a = await run();
    const b = await run();

    // Repeated scans of identical state produce identical results.
    expect(b).toEqual(a);

    // Within a category the result is sorted by targetRel (no readdir jitter).
    const rels = a.map(c => `${c.category}/${c.targetRel.replace(/\\/g, "/")}`);
    const sorted = [...rels].sort();
    expect(rels).toEqual(sorted);
  });

  test("classifyCandidates tags new / tracked / drifted against the manifest", async () => {
    const env = await makeEnv();
    // One file tracked and captured (in sync) ...
    await write(env, "opencode.json", "{}");
    // ... one file present on disk but not yet tracked (inside the preset whitelist).
    await write(env, "skills/demo/SKILL.md", "# new");

    const all = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    const added = all.filter(c => c.targetRel === "opencode.json");
    await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, added, {}));

    const m = await loadManifest(env.repoDir);

    // untouched -> tracked; undiscovered-by-apply -> new
    const tracked = await withFakeHome(env.homeRoot, () => classifyCandidates(env.repoDir, m, all));
    const byRel = Object.fromEntries(tracked.map(t => [t.candidate.targetRel.replace(/\\/g, "/"), t.classification]));
    expect(byRel["opencode.json"]).toBe("tracked");
    expect(byRel["skills/demo/SKILL.md"]).toBe("new");

    // drift the captured file -> drifted
    await write(env, "opencode.json", '{"drift":true}');
    const drifted = await withFakeHome(env.homeRoot, () => classifyCandidates(env.repoDir, m, all));
    const after = Object.fromEntries(drifted.map(t => [t.candidate.targetRel.replace(/\\/g, "/"), t.classification]));
    expect(after["opencode.json"]).toBe("drifted");
    expect(after["skills/demo/SKILL.md"]).toBe("new");
  });

  test("status success path reports only the in-sync hint", async () => {
    const env = await makeEnv();
    await write(env, "opencode.json", "{}");
    const cands = await withFakeHome(env.homeRoot, () => discoverConfigs("opencode"));
    await withFakeHome(env.homeRoot, () => applyDiscovered(env.repoDir, cands, {}));

    const m = await loadManifest(env.repoDir);
    const result = await collectStatus(env.repoDir, m);
    expect(result.summary).toEqual({ total: 1, ok: 1, modified: 0, needsCapture: 0, missing: 0, locked: 0, remote: { configured: false, ahead: 0, behind: 0 } });
    expect(statusHints(result.summary)).toEqual(["Everything in sync — back up with: agenv push"]);
  });
});

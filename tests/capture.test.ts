import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest, saveManifest, Manifest } from "../src/manifest";
import {
  trackedFileState,
  captureTracked,
  applyCandidates,
  collectCandidatesFromPath,
} from "../src/capture";
import { whichBin } from "../src/deps";
import { runProcess } from "../src/proc";
import { decryptToMemory } from "../src/deploy";

// Module scope so the value is available inside sync describe bodies.
const hasAgeTooling = await (async () => {
  const age = await whichBin("age");
  const keygen = await whichBin("age-keygen");
  return !!(age && keygen);
})();

function buildManifest(rootDir: string, homeRoot: string, keyPath: string): Manifest {
  return {
    version: 1,
    config: {
      rootDir,
      encryption: { method: "age", keyPath },
      categories: [
        { id: "opencode", label: "Opencode", enabled: true, targetRoot: path.join(homeRoot, ".config", "opencode") },
        { id: "custom", label: "Custom", enabled: true, targetRoot: "~/" },
      ],
    },
    files: [],
  };
}

describe("capture engine", () => {
  let tmpBase: string;
  let repoDir: string;
  let homeRoot: string;
  let ocRoot: string;
  let manifest: Manifest;
  let ageKeyPath: string;

  beforeAll(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-capture-"));
    repoDir = path.join(tmpBase, "repo");
    homeRoot = path.join(tmpBase, "home");
    ocRoot = path.join(homeRoot, ".config", "opencode");
    await fs.mkdir(path.join(repoDir, "files", "opencode"), { recursive: true });
    await fs.mkdir(ocRoot, { recursive: true });

    // Hermetic age identity lives inside the temp tree.
    const keyPath = path.join(tmpBase, "key.txt");
    if (hasAgeTooling) {
      await runProcess(["age-keygen", "-o", keyPath]);
    }
    ageKeyPath = keyPath;

    manifest = buildManifest(repoDir, homeRoot, keyPath);
    await saveManifest(repoDir, manifest);
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  async function writeDisk(rel: string, content: string) {
    const p = path.join(ocRoot, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return p;
  }

  function tf(rel: string) {
    return { id: `opencode:${rel.replace(/[\\/]/g, "-")}`, category: "opencode" as const, targetRel: rel, encrypt: false };
  }

  test("state detection: repo-missing, unchanged, conflict, target-missing", async () => {
    await writeDisk("a.json", "{}");
    expect(await trackedFileState(repoDir, manifest, tf("a.json"))).toBe("repo-missing");

    await captureTracked(repoDir, manifest, [tf("a.json")], { yes: true });
    expect(await trackedFileState(repoDir, manifest, tf("a.json"))).toBe("unchanged");

    await writeDisk("a.json", '{"changed":true}');
    expect(await trackedFileState(repoDir, manifest, tf("a.json"))).toBe("conflict");

    expect(await trackedFileState(repoDir, manifest, tf("ghost.json"))).toBe("target-missing");
  });

  test("captureTracked keeps local version on conflicts (non-interactive)", async () => {
    await writeDisk("b.json", "v1");
    await captureTracked(repoDir, manifest, [tf("b.json")], { yes: true });

    await writeDisk("b.json", "v2-local");
    const sum = await captureTracked(repoDir, manifest, [tf("b.json")], { yes: true });
    expect(sum.captured).toBe(1);

    // Repo copy must now match the local (v2) content, not v1.
    const stored = await fs.readFile(path.join(repoDir, "files", "opencode", "b.json"), "utf8");
    expect(stored).toBe("v2-local");
    expect(await trackedFileState(repoDir, manifest, tf("b.json"))).toBe("unchanged");
  });

  test("applyCandidates adds, skips duplicates, and updates drifted entries", async () => {
    await writeDisk("c.json", "c1");
    const out1 = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "c.json"), targetRel: "c.json" }],
      {}
    );
    expect(out1.added).toHaveLength(1);
    expect(manifest.files.some(f => f.id === "opencode:c.json")).toBe(true);

    const out2 = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "c.json"), targetRel: "c.json" }],
      {}
    );
    expect(out2.added).toHaveLength(0);
    expect(out2.skipped[0].reason).toContain("already tracked");

    // Drift on disk, then update.
    await writeDisk("c.json", "c2-drifted");
    const out3 = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "c.json"), targetRel: "c.json" }],
      // yes: keep-local without prompting — test runners inherit a TTY.
      { update: true, yes: true }
    );
    expect(out3.updated).toHaveLength(1);
    const stored = await fs.readFile(path.join(repoDir, "files", "opencode", "c.json"), "utf8");
    expect(stored).toBe("c2-drifted");

    // Persistence is the caller's job (lock + saveManifest) — prove it round-trips.
    await saveManifest(repoDir, manifest);
    const reloaded = await loadManifest(repoDir);
    expect(reloaded.files.some(f => f.id === "opencode:c.json")).toBe(true);

    // Re-running update against an unchanged file must NOT claim an update.
    const out4 = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "c.json"), targetRel: "c.json" }],
      { update: true, yes: true }
    );
    expect(out4.updated).toHaveLength(0);
    expect(out4.skipped).toHaveLength(0);
  });

  test("sensitive candidates require --encrypt", async () => {
    await writeDisk(".credentials.json", '{"secret":"x"}');
    const denied = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, ".credentials.json"), targetRel: ".credentials.json", sensitive: true }],
      {}
    );
    expect(denied.added).toHaveLength(0);
    expect(denied.skipped[0].reason).toContain("--encrypt");
    expect(manifest.files.some(f => f.targetRel === ".credentials.json")).toBe(false);
  });

  (hasAgeTooling ? test : test.skip)("encrypted capture round-trips via age", async () => {
    await writeDisk("accounts.json", '{"token":"abc"}');
    const out = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "accounts.json"), targetRel: "accounts.json", sensitive: true }],
      { encrypt: true }
    );
    expect(out.added).toHaveLength(1);

    const stored = path.join(repoDir, "files", "opencode", "accounts.json.age");
    const raw = await fs.readFile(stored, "utf8").catch(() => "");
    expect(raw.includes("abc")).toBe(false); // actually encrypted

    const state = await trackedFileState(repoDir, manifest, {
      id: "opencode:accounts.json",
      category: "opencode",
      targetRel: "accounts.json",
      encrypt: true,
    });
    // "locked" is also what decrypt failures look like, so only an exact
    // "unchanged" proves the round trip; verify bytes directly as well.
    expect(state).toBe("unchanged");
    const decrypted = await decryptToMemory(stored, ageKeyPath);
    expect(decrypted).toBe('{"token":"abc"}');
  });

  test("collectCandidatesFromPath recurses dirs but skips node_modules/.git", async () => {
    const dir = path.join(ocRoot, "skills", "demo");
    await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(dir, ".git"), { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "# demo");
    await fs.writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "junk");
    await fs.writeFile(path.join(dir, ".git", "HEAD"), "ref");

    const cands = await collectCandidatesFromPath(dir, "opencode", ocRoot);
    const rels = cands.map(c => c.targetRel.replace(/\\/g, "/"));
    expect(rels).toContain(path.join("skills", "demo", "SKILL.md").replace(/\\/g, "/"));
    expect(rels.some(r => r.includes("node_modules"))).toBe(false);
    expect(rels.some(r => r.split("/").includes(".git"))).toBe(false);
  });

  test("store-path collisions are rejected instead of clobbering", async () => {
    await writeDisk(path.join("deep", "x.json"), "one");
    const first = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "deep", "x.json"), targetRel: path.join("deep", "x.json") }],
      {}
    );
    expect(first.added).toHaveLength(1);

    // slugFor() collapses deep/x.json and deep__x.json to the same store file.
    await writeDisk("deep__x.json", "two");
    const second = await applyCandidates(
      repoDir,
      manifest,
      [{ category: "opencode", sourcePath: path.join(ocRoot, "deep__x.json"), targetRel: "deep__x.json" }],
      {}
    );
    expect(second.added).toHaveLength(0);
    expect(second.failed[0].error).toContain("collision");

    const storedCollided = await fs.readFile(path.join(repoDir, "files", "opencode", "deep__x.json"), "utf8");
    expect(storedCollided).toBe("one"); // original capture untouched
  });

  // Windows needs developer mode / admin rights to create symlinks.
  (process.platform === "win32" ? test.skip : test)(
    "rejects a top-level symlink that resolves outside the category root",
    async () => {
      const secret = path.join(tmpBase, "outside-secret.txt");
      await fs.writeFile(secret, "topsecret");
      const link = path.join(ocRoot, "escape-link.json");
      await fs.symlink(secret, link);

      await expect(collectCandidatesFromPath(link, "opencode", ocRoot)).rejects.toThrow(/outside/);
    }
  );
});

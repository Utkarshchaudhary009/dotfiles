import { describe, expect, test, beforeAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest, saveManifest } from "../src/manifest";
import { addToRepo } from "../src/commands/add";

describe("add command", () => {
  let tmpBase: string;
  let envSeq = 0;

  interface Env {
    repoDir: string;
    homeRoot: string;
    ocRoot: string;
  }

  beforeAll(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-add-"));
  });

  /**
   * Fresh repo + fake home per test. Nothing is shared between tests, so any
   * one of them passes alone or in any order — no reliance on declaration
   * order or state left behind by earlier cases.
   */
  async function makeEnv(): Promise<Env> {
    const n = ++envSeq;
    const repoDir = path.join(tmpBase, `repo-${n}`);
    const homeRoot = path.join(tmpBase, `home-${n}`);
    const ocRoot = path.join(homeRoot, ".config", "opencode");
    await fs.mkdir(path.join(repoDir, "files"), { recursive: true });
    await fs.mkdir(ocRoot, { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "agenv.json"),
      JSON.stringify({
        version: 1,
        config: {
          rootDir: repoDir,
          encryption: { method: "age", keyPath: path.join(tmpBase, "key.txt") },
          categories: [
            { id: "opencode", label: "Opencode", enabled: true, targetRoot: ocRoot },
          ],
        },
        files: [],
      })
    );
    return { repoDir, homeRoot, ocRoot };
  }

  /**
   * Scanner presets read homeDir(); scope the HOME override to a single call
   * so nothing leaks into other suites in this run. Variables that were unset
   * before us are deleted again instead of left pointing at the fake home.
   */
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

  async function writeDisk(env: Env, rel: string, content: string): Promise<string> {
    const p = path.join(env.ocRoot, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return p;
  }

  test("tracks a single file under the matching category root", async () => {
    const env = await makeEnv();
    const file = await writeDisk(env, "opencode.json", "{}");
    const out = await addToRepo(env.repoDir, [file], {});
    expect(out.added).toHaveLength(1);

    const m = await loadManifest(env.repoDir);
    const entry = m.files.find(f => f.targetRel.replace(/\\/g, "/") === "opencode.json");
    expect(entry?.category).toBe("opencode");

    const stored = await fs.readFile(path.join(env.repoDir, "files", "opencode", "opencode.json"), "utf8");
    expect(stored).toBe("{}");
  });

  test("directory adds recurse and skip node_modules", async () => {
    const env = await makeEnv();
    await writeDisk(env, path.join("agents", "coder.md"), "# coder");
    await writeDisk(env, path.join("agents", "node_modules", "junk.js"), "junk");

    const agentsDir = path.join(env.ocRoot, "agents");
    const out = await addToRepo(env.repoDir, [agentsDir], {});
    expect(out.added.length).toBeGreaterThanOrEqual(1);
    expect(out.added.some(p => p.includes("node_modules"))).toBe(false);

    const m = await loadManifest(env.repoDir);
    expect(m.files.some(f => f.targetRel.replace(/\\/g, "/") === "agents/coder.md")).toBe(true);
    expect(m.files.some(f => f.targetRel.includes("node_modules"))).toBe(false);
  });

  test("missing paths land in failed", async () => {
    const env = await makeEnv();
    const out = await addToRepo(env.repoDir, ["definitely-missing.json"], {});
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].error).toContain("not found");
  });

  test("category sugar tracks discovered configs; --update also refreshes non-discovered tracked files", async () => {
    const env = await makeEnv();
    // Scanner whitelist for opencode covers opencode.json/jsonc,
    // smart-title.jsonc, agents/** and skills/** — but NOT tui.json.
    await writeDisk(env, "tui.json", '{"theme":"tokyonight"}');
    await writeDisk(env, path.join("skills", "demo", "SKILL.md"), "# demo");

    const out1 = await withFakeHome(env.homeRoot, () => addToRepo(env.repoDir, ["opencode"], {}));
    expect(out1.added.some(p => p.replace(/\\/g, "/").includes("skills/demo/SKILL.md"))).toBe(true);
    expect(out1.added.some(p => p.includes("tui.json"))).toBe(false);

    // Track the non-discovered file the way a real add would: manifest entry
    // PLUS repo-store copy of the current disk content, so the refresh below
    // hits the genuine conflict path (disk drifted vs stored copy).
    const m1 = await loadManifest(env.repoDir);
    m1.files.push({
      id: "opencode:tui.json",
      category: "opencode",
      targetRel: "tui.json",
      encrypt: false,
    });
    await saveManifest(env.repoDir, m1);
    await fs.writeFile(path.join(env.repoDir, "files", "opencode", "tui.json"), '{"theme":"tokyonight"}');
    await writeDisk(env, "tui.json", '{"theme":"drifted"}');

    const out2 = await withFakeHome(env.homeRoot, () =>
      addToRepo(env.repoDir, ["opencode"], { update: true, yes: true })
    );
    // Only the drifted file counts as updated; the unchanged SKILL.md must
    // not be claimed as an update.
    expect(out2.updated).toHaveLength(1);
    expect(out2.updated[0].replace(/\\/g, "/").includes("tui.json")).toBe(true);

    const stored = await fs.readFile(path.join(env.repoDir, "files", "opencode", "tui.json"), "utf8");
    expect(stored).toContain("drifted");
  });

  test("sugar without --update reports already-tracked instead of refreshing", async () => {
    const env = await makeEnv();
    await writeDisk(env, path.join("skills", "demo", "SKILL.md"), "# demo");

    const first = await withFakeHome(env.homeRoot, () =>
      addToRepo(env.repoDir, ["opencode"], { yes: true })
    );
    expect(first.added.some(p => p.replace(/\\/g, "/").includes("skills/demo/SKILL.md"))).toBe(true);

    const again = await withFakeHome(env.homeRoot, () =>
      addToRepo(env.repoDir, ["opencode"], { yes: true })
    );
    const skippedRels = again.skipped.map(s => s.path.replace(/\\/g, "/"));
    expect(skippedRels.some(p => p.includes("skills/demo/SKILL.md"))).toBe(true);
    expect(again.updated).toHaveLength(0);
  });

  test("json option shape flows through outcome object", async () => {
    const env = await makeEnv();
    const file = await writeDisk(env, "tui.json", '{"a":1}');
    const out = await addToRepo(env.repoDir, [file], { json: true });
    expect(Object.keys(out).sort()).toEqual(["added", "failed", "skipped", "updated"]);
  });
});

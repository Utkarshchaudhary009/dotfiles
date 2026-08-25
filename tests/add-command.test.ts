import { describe, expect, test, beforeAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest } from "../src/manifest";
import { addToRepo } from "../src/commands/add";

describe("add command", () => {
  let tmpBase: string;
  let repoDir: string;
  let homeRoot: string;
  let ocRoot: string;

  beforeAll(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-add-"));
    repoDir = path.join(tmpBase, "repo");
    homeRoot = path.join(tmpBase, "home");
    ocRoot = path.join(homeRoot, ".config", "opencode");
    await fs.mkdir(path.join(repoDir, "files"), { recursive: true });
    await fs.mkdir(ocRoot, { recursive: true });
    await fs.writeFile(path.join(repoDir, "agenv.json"), JSON.stringify({
      version: 1,
      config: {
        rootDir: repoDir,
        encryption: { method: "age", keyPath: path.join(tmpBase, "key.txt") },
        categories: [
          { id: "opencode", label: "Opencode", enabled: true, targetRoot: ocRoot },
        ],
      },
      files: [],
    }));

  });

  /**
   * Scanner presets read homeDir(); scope the HOME override to a single test
   * so nothing leaks into other suites in this run.
   */
  async function withFakeHome<T>(fn: () => Promise<T>): Promise<T> {
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeRoot;
    process.env.USERPROFILE = homeRoot;
    try {
      return await fn();
    } finally {
      if (prevHome !== undefined) process.env.HOME = prevHome;
      if (prevUserProfile !== undefined) process.env.USERPROFILE = prevUserProfile;
    }
  }

  async function writeDisk(rel: string, content: string): Promise<string> {
    const p = path.join(ocRoot, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    return p;
  }

  test("tracks a single file under the matching category root", async () => {
    const file = await writeDisk("opencode.json", "{}");
    const out = await addToRepo(repoDir, [file], {});
    expect(out.added).toHaveLength(1);

    const m = await loadManifest(repoDir);
    const entry = m.files.find(f => f.targetRel.replace(/\\/g, "/") === "opencode.json");
    expect(entry?.category).toBe("opencode");

    const stored = await fs.readFile(path.join(repoDir, "files", "opencode", "opencode.json"), "utf8");
    expect(stored).toBe("{}");
  });

  test("directory adds recurse and skip node_modules", async () => {
    await writeDisk(path.join("agents", "coder.md"), "# coder");
    await writeDisk(path.join("agents", "node_modules", "junk.js"), "junk");

    const agentsDir = path.join(ocRoot, "agents");
    const out = await addToRepo(repoDir, [agentsDir], {});
    expect(out.added.length).toBeGreaterThanOrEqual(1);
    expect(out.added.some(p => p.includes("node_modules"))).toBe(false);

    const m = await loadManifest(repoDir);
    expect(m.files.some(f => f.targetRel.replace(/\\/g, "/") === "agents/coder.md")).toBe(true);
    expect(m.files.some(f => f.targetRel.includes("node_modules"))).toBe(false);
  });

  test("missing paths land in failed", async () => {
    const out = await addToRepo(repoDir, ["definitely-missing.json"], {});
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].error).toContain("not found");
  });

  test("category sugar tracks discovered configs; --update also refreshes non-discovered tracked files", async () => {
    // Scanner whitelist for opencode covers opencode.json/jsonc,
    // smart-title.jsonc, agents/** and skills/** — but NOT tui.json.
    await writeDisk("tui.json", '{"theme":"tokyonight"}');
    await fs.mkdir(path.join(ocRoot, "skills", "demo"), { recursive: true });
    await fs.writeFile(path.join(ocRoot, "skills", "demo", "SKILL.md"), "# demo");

    const out1 = await withFakeHome(() => addToRepo(repoDir, ["opencode"], {}));
    expect(out1.added.some(p => p.replace(/\\/g, "/").includes("skills/demo/SKILL.md"))).toBe(true);
    expect(out1.added.some(p => p.includes("tui.json"))).toBe(false);

    // Manually track the non-discovered file (as init/manual add would).
    const m1 = await loadManifest(repoDir);
    m1.files.push({
      id: "opencode:tui.json",
      category: "opencode",
      targetRel: "tui.json",
      encrypt: false,
    });
    const { saveManifest } = await import("../src/manifest");
    await saveManifest(repoDir, m1);
    await writeDisk("tui.json", '{"theme":"drifted"}');

    const out2 = await withFakeHome(() => addToRepo(repoDir, ["opencode"], { update: true, yes: true }));
    expect(out2.updated.some(p => p.includes("tui.json"))).toBe(true);

    const stored = await fs.readFile(path.join(repoDir, "files", "opencode", "tui.json"), "utf8");
    expect(stored).toContain("drifted");
  });

  test("sugar without --update reports already-tracked instead of refreshing", async () => {
    const out = await withFakeHome(() => addToRepo(repoDir, ["opencode"], { yes: true }));
    const skippedRels = out.skipped.map(s => s.path.replace(/\\/g, "/"));
    expect(skippedRels.some(p => p.includes("skills/demo/SKILL.md"))).toBe(true);
  });

  test("json option shape flows through outcome object", async () => {
    const file = await writeDisk("tui.json", '{"a":1}');
    const out = await addToRepo(repoDir, [file], { json: true });
    expect(Object.keys(out).sort()).toEqual(["added", "failed", "skipped", "updated"]);
  });
});

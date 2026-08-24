import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Manifest, loadManifest, saveManifest, repoStorePath } from "../src/manifest";

describe("manifest", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-manifest-"));
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test("save and load round-trip preserves all fields", async () => {
    const m: Manifest = {
      version: 1,
      config: {
        rootDir: tmpDir,
        encryption: { method: "age", keyPath: "~/.key" },
        categories: [
          { id: "git", label: "Git", enabled: true, targetRoot: "~/" }
        ]
      },
      files: [
        { id: "git:config", category: "git", targetRel: ".gitconfig", encrypt: false }
      ]
    };

    await saveManifest(tmpDir, m);
    const loaded = await loadManifest(tmpDir);

    expect(loaded.version).toBe(m.version);
    expect(loaded.config).toEqual(m.config);
    expect(loaded.files).toEqual(m.files);
  });

  test("loadManifest throws on invalid JSON", async () => {
    await fs.writeFile(path.join(tmpDir, "agenv.json"), "{ invalid }");
    expect(loadManifest(tmpDir)).rejects.toThrow();
  });

  test("loadManifest throws on wrong version", async () => {
    const m = { version: 2, config: { categories: [] }, files: [] };
    await fs.writeFile(path.join(tmpDir, "agenv.json"), JSON.stringify(m));
    expect(loadManifest(tmpDir)).rejects.toThrow("Corrupt agenv.json");
  });

  test("loadManifest throws on missing files array", async () => {
    const m = { version: 1, config: { categories: [] } };
    await fs.writeFile(path.join(tmpDir, "agenv.json"), JSON.stringify(m));
    expect(loadManifest(tmpDir)).rejects.toThrow("Corrupt agenv.json");
  });

  test("loadManifest throws on missing categories", async () => {
    const m = { version: 1, config: {}, files: [] };
    await fs.writeFile(path.join(tmpDir, "agenv.json"), JSON.stringify(m));
    expect(loadManifest(tmpDir)).rejects.toThrow("Corrupt agenv.json");
  });

  test("loadManifest rejects unsafe targetRel", async () => {
    const m = {
      version: 1,
      config: { categories: [{ id: "git", label: "Git", enabled: true, targetRoot: "~/" }] },
      files: [
        { id: "git:bad", category: "git", targetRel: "../../etc/passwd", encrypt: false }
      ]
    };
    await fs.writeFile(path.join(tmpDir, "agenv.json"), JSON.stringify(m));
    expect(loadManifest(tmpDir)).rejects.toThrow("Unsafe target path in manifest");

    // Also test absolute path
    const m2 = {
      version: 1,
      config: { categories: [{ id: "git", label: "Git", enabled: true, targetRoot: "~/" }] },
      files: [
        { id: "git:bad", category: "git", targetRel: "/etc/passwd", encrypt: false }
      ]
    };
    await fs.writeFile(path.join(tmpDir, "agenv.json"), JSON.stringify(m2));
    expect(loadManifest(tmpDir)).rejects.toThrow("Unsafe target path in manifest");
  });

  test("repoStorePath resolution is deterministic", () => {
    const p1 = repoStorePath("/repo", { id: "git", category: "git", targetRel: ".gitconfig", encrypt: false });
    expect(p1.replace(/\\/g, "/")).toBe("/repo/files/git/.gitconfig");

    const p2 = repoStorePath("/repo", { id: "git", category: "git", targetRel: ".gitconfig", encrypt: true });
    expect(p2.replace(/\\/g, "/")).toBe("/repo/files/git/.gitconfig.age");

    const p3 = repoStorePath("/repo", { id: "foo", category: "vscode", targetRel: "User/settings.json", encrypt: false });
    expect(p3.replace(/\\/g, "/")).toBe("/repo/files/vscode/User__settings.json");
  });
});

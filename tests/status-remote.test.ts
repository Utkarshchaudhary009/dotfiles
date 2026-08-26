import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadManifest } from "../src/manifest";
import { collectStatus } from "../src/commands/status";
import { gitRemoteSync } from "../src/git";

async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${err}`);
  }
}

describe("status remote awareness", () => {
  let tmpBase: string;

  beforeAll(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-remote-"));
  });

  afterAll(async () => {
    if (tmpBase) await fs.rm(tmpBase, { recursive: true, force: true });
  });

  async function makeRepo(repoDir: string, homeRoot: string): Promise<void> {
    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(path.join(homeRoot, ".config", "opencode"), { recursive: true });
    // keyPath deliberately points nowhere so encrypted entries count as locked.
    await fs.writeFile(
      path.join(repoDir, "agenv.json"),
      JSON.stringify({
        version: 1,
        config: {
          rootDir: repoDir,
          encryption: { method: "age", keyPath: path.join(tmpBase, "missing-key.txt") },
          categories: [{ id: "opencode", label: "Opencode", enabled: true, targetRoot: path.join(homeRoot, ".config", "opencode") }],
        },
        files: [],
      })
    );
  }

  test("no remote => configured false and no remote hint", async () => {
    const repoDir = path.join(tmpBase, "noremote");
    const home = path.join(tmpBase, "noremote-home");
    await makeRepo(repoDir, home);
    await runGit(repoDir, ["init"]);
    await runGit(repoDir, ["config", "user.email", "t@t"]);
    await runGit(repoDir, ["config", "user.name", "t"]);

    const sync = await gitRemoteSync(repoDir);
    expect(sync.configured).toBe(false);
    expect(sync.ahead).toBe(0);
    expect(sync.behind).toBe(0);

    const m = await loadManifest(repoDir);
    const res = await collectStatus(repoDir, m);
    expect(res.summary.remote).toEqual({ configured: false, ahead: 0, behind: 0 });
  });

  test("upstream reports ahead/behind correctly", async () => {
    const remoteDir = path.join(tmpBase, "bare.git");
    await fs.mkdir(remoteDir, { recursive: true });
    await runGit(remoteDir, ["init", "--bare"]);

    const local = path.join(tmpBase, "local");
    const home = path.join(tmpBase, "local-home");
    await makeRepo(local, home);
    await runGit(local, ["init"]);
    await runGit(local, ["config", "user.email", "t@t"]);
    await runGit(local, ["config", "user.name", "t"]);
    await runGit(local, ["remote", "add", "origin", remoteDir]);
    await runGit(local, ["add", "agenv.json"]);
    await runGit(local, ["commit", "-m", "init"]);

    // Push to set the upstream; now in sync with remote.
    await runGit(local, ["push", "-u", "origin", "HEAD"]);
    let sync = await gitRemoteSync(local);
    expect(sync.configured).toBe(true);
    expect(sync.ahead).toBe(0);
    expect(sync.behind).toBe(0);

    // Make a local commit: now ahead of the remote.
    await fs.writeFile(path.join(local, "local-marker.txt"), "x");
    await runGit(local, ["add", "local-marker.txt"]);
    await runGit(local, ["commit", "-m", "local change"]);
    sync = await gitRemoteSync(local);
    expect(sync.ahead).toBe(1);
    expect(sync.behind).toBe(0);
    const m0 = await loadManifest(local);
    let res = await collectStatus(local, m0);
    expect(res.summary.remote.ahead).toBe(1);
    expect(res.summary.remote.behind).toBe(0);

    // Simulate another machine pushing to the remote: clone, commit, push.
    const other = path.join(tmpBase, "other");
    const otherHome = path.join(tmpBase, "other-home");
    await fs.mkdir(other, { recursive: true });
    await fs.mkdir(otherHome, { recursive: true });
    await runGit(other, ["clone", remoteDir, "."]);
    await runGit(other, ["config", "user.email", "t@t"]);
    await runGit(other, ["config", "user.name", "t"]);
    await fs.writeFile(path.join(other, "remote-marker.txt"), "x");
    await runGit(other, ["add", "remote-marker.txt"]);
    await runGit(other, ["commit", "-m", "remote change"]);
    await runGit(other, ["push", "origin", "HEAD"]);

    // Fetch in local so the upstream ref advances locally.
    await runGit(local, ["fetch"]);

    sync = await gitRemoteSync(local);
    expect(sync.configured).toBe(true);
    expect(sync.behind).toBeGreaterThanOrEqual(1);
    const m1 = await loadManifest(local);
    res = await collectStatus(local, m1);
    expect(res.summary.remote.behind).toBeGreaterThanOrEqual(1);
  });
});

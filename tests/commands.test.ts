import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runProcess } from "../src/proc";
import { whichBin } from "../src/deps";

const git = await whichBin("git");
const hasGit = !!git;
const testGit = hasGit ? test : test.skip;

describe("commands", () => {
  let tmpDir: string;
  let bareRepoDir: string;
  let cliPath: string;

  let fakeHome: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-cmds-"));
    bareRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-bare-"));
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-home-"));
    
    // Use the compiled CLI
    cliPath = path.resolve(__dirname, "../dist/agenv.js");

    if (hasGit) {
      await runProcess(["git", "init", "--bare", "-b", "main"], { cwd: bareRepoDir });

      // Seed fakeHome with a dummy opencode config so that init actually finds something
      const opencodeDir = path.join(fakeHome, ".config", "opencode");
      await fs.mkdir(opencodeDir, { recursive: true });
      await fs.writeFile(path.join(opencodeDir, "opencode.json"), "{}");

      // Set global git config inside fakeHome so commits succeed in tests
      const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
      // Try to set globally
      await runProcess(["git", "config", "--global", "user.name", "Test User"], { env }).catch(() => {});
      await runProcess(["git", "config", "--global", "user.email", "test@example.com"], { env }).catch(() => {});
      
      // But also set locally in tmpDir before publish/push to be absolutely sure

    }
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
    try {
      await fs.rm(bareRepoDir, { recursive: true, force: true });
    } catch (e) {}
    try {
      await fs.rm(fakeHome, { recursive: true, force: true });
    } catch (e) {}
  });

  async function runCli(args: string[], cwd: string = tmpDir, expectFail: boolean = false) {
    const env = {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome
    };
    const res = await runProcess(["node", cliPath, ...args], { cwd, env });
    if (res.code !== 0 && !expectFail) {
      console.error(`CLI failed: bun ${cliPath} ${args.join(' ')}\nCWD: ${cwd}\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`);
    }
    return res;
  }

  testGit("init --yes creates artifacts and initial commit", async () => {
    await runProcess(["git", "config", "--global", "user.name", "Test User"]).catch(()=>{});
    await runProcess(["git", "config", "--global", "user.email", "test@example.com"]).catch(()=>{});

    const res = await runCli(["init", "--yes", "--allow-plaintext-secrets"]);
    expect(res.code).toBe(0);

    const manifestExists = await fs.stat(path.join(tmpDir, "agenv.json")).then(() => true).catch(() => false);
    expect(manifestExists).toBe(true);

    const filesExists = await fs.stat(path.join(tmpDir, "files")).then(() => true).catch(() => false);
    expect(filesExists).toBe(true);

    const gitignoreExists = await fs.stat(path.join(tmpDir, ".gitignore")).then(() => true).catch(() => false);
    expect(gitignoreExists).toBe(true);

    const readmeExists = await fs.stat(path.join(tmpDir, "README.md")).then(() => true).catch(() => false);
    expect(readmeExists).toBe(true);

    // Git branch is main
    const branchRes = await runProcess(["git", "branch", "--show-current"], { cwd: tmpDir });
    expect(branchRes.stdout.trim()).toMatch(/^(main|master)$/);

    // One commit exists
    const logRes = await runProcess(["git", "log", "--oneline"], { cwd: tmpDir });
    expect(logRes.stdout.trim().split("\n").length).toBeGreaterThan(0);
  }, 30000);

  testGit("init --yes again fails", async () => {
    const res = await runCli(["init", "--yes", "--allow-plaintext-secrets"], tmpDir, true);
    expect(res.code).not.toBe(0);
    expect(res.stderr + res.stdout).toMatch(/already an agenv environment/i);
  }, 10000);

  testGit("list command", async () => {
    const res = await runCli(["list"]);
    expect(res.code).toBe(0);
  }, 10000);

  testGit("status command", async () => {
    const res = await runCli(["status"]);
    expect(res.code).toBe(0);
  }, 10000);

  testGit("expand --dry-run command", async () => {
    const res = await runCli(["expand", "--dry-run"]);
    expect(res.code).toBe(0);
    expect(res.stdout + res.stderr).toMatch(/Expand Summary/i);
  }, 10000);

  testGit("doctor command", async () => {
    const res = await runCli(["doctor"]);
    expect(res.code).toBe(0);
  }, 30000);

  testGit("publish --remote <local-bare-repo-path> --yes command", async () => {
    // Ensure local git config is set so commits succeed
    await runProcess(["git", "config", "user.name", "Test User"], { cwd: tmpDir }).catch(() => {});
    await runProcess(["git", "config", "user.email", "test@example.com"], { cwd: tmpDir }).catch(() => {});

    const remoteUrl = "file:///" + encodeURI(bareRepoDir.replace(/\\/g, '/'));
    const res = await runCli(["publish", "--remote", remoteUrl, "--yes"]);
    expect(res.code).toBe(0);

    // Bare repo has commits
    const logRes = await runProcess(["git", "--git-dir=" + bareRepoDir, "log", "main", "--oneline"]);
    expect(logRes.code).toBe(0);
    expect(logRes.stdout.trim().split("\n").length).toBeGreaterThan(0);
  }, 30000);

  testGit("push -m 'msg' command", async () => {
    // Dummy change
    await fs.writeFile(path.join(tmpDir, "README.md"), "updated");
    await runProcess(["git", "add", "README.md"], { cwd: tmpDir });
    
    const res = await runCli(["push", "-m", "dummy-change"]);
    if (res.code !== 0) {
       console.error("push failed:", res.stdout, res.stderr);
    }
    expect(res.code).toBe(0);

    // Bare repo has new commit
    const logRes = await runProcess(["git", "--git-dir=" + bareRepoDir, "log", "main", "--oneline"]);
    expect(logRes.stdout).toContain("dummy-change");
  }, 60000);

  testGit("clone command", async () => {
    const cloneDir = path.join(os.tmpdir(), "agenv-test-clone-" + Math.random().toString(36).slice(2));
    const remoteUrl = "file:///" + encodeURI(bareRepoDir.replace(/\\/g, '/'));

    const res = await runCli(["clone", remoteUrl, "--dir", cloneDir], os.tmpdir());
    expect(res.code).toBe(0);

    const manifestExists = await fs.stat(path.join(cloneDir, "agenv.json")).then(() => true).catch(() => false);
    expect(manifestExists).toBe(true);

    await fs.rm(cloneDir, { recursive: true, force: true });
  }, 60000);

  testGit("clone command accepts plain local path", async () => {
    const cloneDir = path.join(os.tmpdir(), "agenv-test-clone-path-" + Math.random().toString(36).slice(2));

    const res = await runCli(["clone", bareRepoDir, "--dir", cloneDir], os.tmpdir());
    if (res.code !== 0) console.error("clone-by-path failed:", res.stdout, res.stderr);
    expect(res.code).toBe(0);

    const manifestExists = await fs.stat(path.join(cloneDir, "agenv.json")).then(() => true).catch(() => false);
    expect(manifestExists).toBe(true);

    await fs.rm(cloneDir, { recursive: true, force: true });
  }, 60000);

  testGit("push sets upstream on first push to manually added remote", async () => {
    const envDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-noupstream-"));
    const bare2Dir = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-bare2-"));
    try {
      await runProcess(["git", "init", "--bare", "-b", "main"], { cwd: bare2Dir });

      // Fresh env, no publish — upstream is never set by agenv itself
      const initRes = await runCli(["init", "--yes", "--allow-plaintext-secrets"], envDir);
      if (initRes.code !== 0) console.error("init failed:", initRes.stdout, initRes.stderr);
      expect(initRes.code).toBe(0);

      const before = await runProcess(["git", "rev-parse", "--abbrev-ref", "@{u}"], { cwd: envDir });
      expect(before.code).not.toBe(0);

      const remoteUrl = "file:///" + encodeURI(bare2Dir.replace(/\\/g, '/'));
      await runProcess(["git", "remote", "add", "origin", remoteUrl], { cwd: envDir });

      await fs.writeFile(path.join(envDir, "README.md"), "changed");

      const pushRes = await runCli(["push", "-m", "first upstream push"], envDir);
      if (pushRes.code !== 0) console.error("push failed:", pushRes.stdout, pushRes.stderr);
      expect(pushRes.code).toBe(0);

      const upstream = await runProcess(["git", "rev-parse", "--abbrev-ref", "@{u}"], { cwd: envDir });
      expect(upstream.code).toBe(0);
      expect(upstream.stdout.trim()).toBe("origin/main");

      const logRes = await runProcess(["git", "--git-dir=" + bare2Dir, "log", "--oneline"]);
      expect(logRes.code).toBe(0);
      expect(logRes.stdout).toContain("first upstream push");
    } finally {
      await fs.rm(envDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(bare2Dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60000);

  testGit("remove accepts absolute target path", async () => {
    const targetFile = path.join(fakeHome, ".config", "opencode", "opencode.json");

    const res = await runCli(["remove", targetFile]);
    if (res.code !== 0) console.error("remove failed:", res.stdout, res.stderr);
    expect(res.code).toBe(0);
    expect(res.stdout + res.stderr).toMatch(/Removed/i);

    const manifestRaw = JSON.parse(await fs.readFile(path.join(tmpDir, "agenv.json"), "utf8")) as { files: Array<{ targetRel: string }> };
    expect(manifestRaw.files.some((f) => f.targetRel === "opencode.json")).toBe(false);

    const storedExists = await fs.access(path.join(tmpDir, "files", "opencode", "opencode.json")).then(() => true).catch(() => false);
    expect(storedExists).toBe(false);
  }, 30000);
});

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Manifest, TrackedFile } from "../src/manifest";
import { captureFiles, deployFiles } from "../src/deploy";
import { whichBin } from "../src/deps";
import { runProcess } from "../src/proc";

const age = await whichBin("age");
const ageKeygen = await whichBin("age-keygen");
const hasAge = !!(age && ageKeygen);
const testAge = hasAge ? test : test.skip;

describe("deploy", () => {
  let tmpDir: string;
  let targetRoot: string;
  let repoRoot: string;
  let keyPath: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenv-test-deploy-"));
    repoRoot = path.join(tmpDir, "repo");
    targetRoot = path.join(tmpDir, "target");
    keyPath = path.join(tmpDir, "key.txt");

    await fs.mkdir(repoRoot, { recursive: true });
    await fs.mkdir(targetRoot, { recursive: true });

    if (hasAge) {
      await runProcess(["age-keygen", "-o", keyPath]);
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  test("captureFiles and deployFiles plain files", async () => {
    const manifest: Manifest = {
      version: 1,
      config: {
        rootDir: repoRoot,
        encryption: { method: "age", keyPath },
        categories: [
          { id: "shell", label: "Shell", enabled: true, targetRoot }
        ]
      },
      files: []
    };

    const tfPlain: TrackedFile = {
      id: "shell:plain",
      category: "shell",
      targetRel: "plain.txt",
      encrypt: false
    };
    manifest.files.push(tfPlain);

    // Create source file in targetRoot
    const srcPlain = path.join(targetRoot, "plain.txt");
    await fs.writeFile(srcPlain, "plain content");

    // Capture
    await captureFiles(repoRoot, manifest, [{ src: srcPlain, tf: tfPlain }]);

    // Remove source to test deploy
    await fs.rm(srcPlain);

    // Deploy
    const summary = await deployFiles(repoRoot, manifest);
    expect(summary.deployed).toBe(1);
    expect(summary.failed).toBe(0);

    const content = await fs.readFile(srcPlain, "utf8");
    expect(content).toBe("plain content");
  });

  test("deployFiles idempotency", async () => {
    const manifest: Manifest = {
      version: 1,
      config: {
        rootDir: repoRoot,
        encryption: { method: "age", keyPath },
        categories: [
          { id: "shell", label: "Shell", enabled: true, targetRoot }
        ]
      },
      files: [
        { id: "shell:plain", category: "shell", targetRel: "plain.txt", encrypt: false }
      ]
    };

    const summary = await deployFiles(repoRoot, manifest);
    expect(summary.deployed).toBe(0);
    expect(summary.unchanged).toBe(1);
  });

  test("modified-target preservation and force overwrite", async () => {
    const manifest: Manifest = {
      version: 1,
      config: {
        rootDir: repoRoot,
        encryption: { method: "age", keyPath },
        categories: [
          { id: "shell", label: "Shell", enabled: true, targetRoot }
        ]
      },
      files: [
        { id: "shell:plain", category: "shell", targetRel: "plain.txt", encrypt: false }
      ]
    };

    const srcPlain = path.join(targetRoot, "plain.txt");
    await fs.writeFile(srcPlain, "modified content");

    // Without force -> skips
    const summary1 = await deployFiles(repoRoot, manifest);
    expect(summary1.skipped).toBe(1);
    expect(summary1.deployed).toBe(0);
    let currentContent = await fs.readFile(srcPlain, "utf8");
    expect(currentContent).toBe("modified content");

    // With force -> overwrites
    const summary2 = await deployFiles(repoRoot, manifest, { force: true });
    expect(summary2.deployed).toBe(1);
    currentContent = await fs.readFile(srcPlain, "utf8");
    expect(currentContent).toBe("plain content");
  });

  test("missing repo file expand gracefully", async () => {
    const manifest: Manifest = {
      version: 1,
      config: {
        rootDir: repoRoot,
        encryption: { method: "age", keyPath },
        categories: [
          { id: "shell", label: "Shell", enabled: true, targetRoot }
        ]
      },
      files: [
        { id: "shell:missing", category: "shell", targetRel: "missing.txt", encrypt: false }
      ]
    };

    const summary = await deployFiles(repoRoot, manifest);
    expect(summary.failed).toBe(1); // The code logs a warning and marks as failed
  });

  testAge("encrypted files (skip if age missing)", async () => {
    const manifest: Manifest = {
      version: 1,
      config: {
        rootDir: repoRoot,
        encryption: { method: "age", keyPath },
        categories: [
          { id: "shell", label: "Shell", enabled: true, targetRoot }
        ]
      },
      files: []
    };

    const tfEncrypted: TrackedFile = {
      id: "shell:enc",
      category: "shell",
      targetRel: "enc.txt",
      encrypt: true
    };
    manifest.files.push(tfEncrypted);

    const srcEnc = path.join(targetRoot, "enc.txt");
    await fs.writeFile(srcEnc, "secret content");

    // Capture
    await captureFiles(repoRoot, manifest, [{ src: srcEnc, tf: tfEncrypted }]);

    // Remove source
    await fs.rm(srcEnc);

    // Deploy
    const summary = await deployFiles(repoRoot, manifest);
    expect(summary.deployed).toBe(1);

    const content = await fs.readFile(srcEnc, "utf8");
    expect(content).toBe("secret content");
  });
});

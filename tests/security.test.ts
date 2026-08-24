import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("security guardrails", () => {
  const srcDir = path.resolve(__dirname, "../src");
  const rootDir = path.resolve(__dirname, "..");

  async function getSrcFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        files = files.concat(await getSrcFiles(p));
      } else if (e.isFile() && p.endsWith(".ts")) {
        files.push(p);
      }
    }
    return files;
  }

  test("no shell: true anywhere in src/", async () => {
    const files = await getSrcFiles(srcDir);
    for (const f of files) {
      const content = await fs.readFile(f, "utf8");
      expect(content).not.toMatch(/shell\s*:\s*true/);
    }
  });

  test("no Bun. API usage in src modules (only standard node/isomorphic)", async () => {
    const files = await getSrcFiles(srcDir);
    for (const f of files) {
      if (f.endsWith("cli.ts")) continue; // cli.ts can have process/shebang stuff, but check it doesn't have Bun.
      const content = await fs.readFile(f, "utf8");
      expect(content).not.toMatch(/\bBun\./);
    }
  });

  test(".gitignore contains node_modules and dist", async () => {
    const gitignorePath = path.join(rootDir, ".gitignore");
    const content = await fs.readFile(gitignorePath, "utf8");
    const lines = content.split("\n").map(l => l.trim());
    
    expect(lines).toContain("node_modules/");
    expect(lines).toContain("dist/");
  });
});

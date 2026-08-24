import { describe, expect, test } from "bun:test";
import * as scanner from "../src/scanner";
import { pathExists } from "../src/fs";

describe("scanner", () => {
  test("scanSystem returns only existing files and safe paths", async () => {
    const candidates = await scanner.scanSystem(["opencode", "claude", "git", "shell", "vscode", "agents"]);

    for (const c of candidates) {
      // Must exist
      const exists = await pathExists(c.sourcePath);
      expect(exists).toBe(true);

      // targetRel has no ..
      expect(c.targetRel).not.toContain("..");

      // Valid id and category
      expect(c.id).toBeDefined();
      expect(c.category).toBeDefined();
    }
  }, 30000);
});


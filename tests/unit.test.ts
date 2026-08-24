import { describe, expect, test } from "bun:test";
import { slugFor } from "../src/manifest";
import { expandHome, targetPathFor, isWindows } from "../src/platform";
import { isSensitive } from "../src/scanner";
import { createDefaultConfig } from "../src/config";

describe("unit tests", () => {
  describe("slugFor", () => {
    test("handles path separators", () => {
      expect(slugFor("foo/bar")).toBe("foo__bar");
      expect(slugFor("foo\\bar")).toBe("foo__bar");
    });
    test("handles weird chars and empty input", () => {
      expect(slugFor("foo/b@r")).toBe("foo__b@r");
      expect(slugFor("")).toBe("");
    });
  });

  describe("expandHome", () => {
    test("expands home path", () => {
      const expanded1 = expandHome("~");
      expect(expanded1).not.toBe("~");
      expect(expanded1.length).toBeGreaterThan(0);

      const expanded2 = expandHome("~/x");
      expect(expanded2).not.toBe("~/x");
      expect(expanded2.endsWith("x")).toBe(true);

      const expanded3 = expandHome("~\\x");
      expect(expanded3).not.toBe("~\\x");
      expect(expanded3.endsWith("x")).toBe(true);
    });

    test("leaves non-home paths alone", () => {
      expect(expandHome("x")).toBe("x");
      expect(expandHome("/x")).toBe("/x");
      expect(expandHome("C:\\x")).toBe("C:\\x");
    });
  });

  describe("targetPathFor", () => {
    test("normal relative paths work", () => {
      const root = "~/foo";
      const rel = "bar/baz";
      const p = targetPathFor(root, rel);
      expect(p).not.toContain("~");
      expect(p.endsWith("baz")).toBe(true);
    });

    test("absolute relative paths throw", () => {
      const root = "~/foo";
      expect(() => targetPathFor(root, "/bar/baz")).toThrow();
      if (isWindows()) {
        expect(() => targetPathFor(root, "C:\\bar\\baz")).toThrow();
      }
    });

    test("path traversal attempts throw", () => {
      const root = "~/foo";
      expect(() => targetPathFor(root, "../bar")).toThrow();
      expect(() => targetPathFor(root, "..\\bar")).toThrow();
      expect(() => targetPathFor(root, "bar/../../baz")).toThrow();
    });
  });

  describe("isSensitive", () => {
    test("matches sensitive keywords", () => {
      expect(isSensitive("auth.json")).toBe(true);
      expect(isSensitive("my_credentials.txt")).toBe(true);
      expect(isSensitive("github_token")).toBe(true);
      expect(isSensitive("accounts.yaml")).toBe(true);
      expect(isSensitive("keys.pem")).toBe(true);
      expect(isSensitive("my-secret-file")).toBe(true);
      expect(isSensitive(".env")).toBe(true);
      expect(isSensitive("backup.zip")).toBe(true);
    });

    test("does not match plain configs", () => {
      expect(isSensitive("settings.json")).toBe(false);
      expect(isSensitive("config.yaml")).toBe(false);
      expect(isSensitive("README.md")).toBe(false);
      
      // The current implementation is simple and doesn't explicitly 
      // flag shell rc or .gitconfig based on name ALONE unless they contain keywords.
      // So these return false based on `isSensitive` function, but they are flagged sensitive 
      // in scanner.ts because of manual setting.
      expect(isSensitive(".gitconfig")).toBe(false);
      expect(isSensitive(".bashrc")).toBe(false);
    });
  });

  describe("createDefaultConfig", () => {
    test("all paths are ~ relative and 6 categories present", () => {
      const conf = createDefaultConfig("/dummy/root");
      expect(conf.rootDir).toBe("/dummy/root");
      
      expect(conf.encryption.keyPath).toBe("~/.config/agenv/key.txt");
      
      expect(conf.categories.length).toBe(6);
      
      const ids = conf.categories.map(c => c.id);
      expect(ids).toEqual(["opencode", "claude", "agents", "git", "vscode", "shell"]);
      
      for (const cat of conf.categories) {
        expect(cat.enabled).toBe(false);
        expect(cat.targetRoot.startsWith("~")).toBe(true);
      }
    });
  });
});

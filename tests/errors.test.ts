import { describe, expect, test } from "bun:test";
import { CLIError, HINTS, describeError } from "../src/errors";

describe("describeError", () => {
  test("CLIError keeps its own hint", () => {
    const err = new CLIError("Pull failed", "Fix conflicts and retry");
    const { message, hint } = describeError(err);
    expect(message).toBe("Pull failed");
    expect(hint).toBe("Fix conflicts and retry");
  });

  test("missing key ENOENT maps to keygen hint", () => {
    const enoent = new Error("ENOENT: no such file or directory, open 'C:\\\\Users\\\\x\\\\.config\\\\agenv\\\\key.txt'");
    const { hint } = describeError(enoent);
    expect(hint).toContain("age-keygen");
    expect(hint).toContain("key.txt");
  });

  test("generic ENOENT gets a usage hint", () => {
    const { hint } = describeError(new Error("ENOENT: no such file or directory, stat 'C:\\\\nope'"));
    expect(hint).toContain("--help");
  });

  test("age-not-installed maps to install hint", () => {
    const { hint } = describeError(new Error("Age is required to decrypt files, but it is not installed."));
    expect(hint).toContain("Install age");
  });

  test("gh auth failures map to gh auth login", () => {
    const { hint } = describeError(new Error("gh: Authentication failed (401)"));
    expect(hint).toBe(HINTS.ghAuth);
  });

  test("unhinted CLIError still gets catalog hints", () => {
    const { hint } = describeError(new CLIError("age or age-keygen not found on PATH"));
    expect(hint).toBe(HINTS.ageMissing);
  });

  test("unrelated key.txt ENOENT keeps the generic usage hint", () => {
    const { message, hint } = describeError(new Error("ENOENT: no such file or directory, open 'D:\\data\\key.txt'"));
    expect(message).not.toContain("Encryption key not found");
    expect(hint).toContain("--help");
  });

  test("plain errors pass through without hints", () => {
    const { message, hint } = describeError("weird failure");
    expect(message).toBe("weird failure");
    expect(hint).toBeUndefined();
  });
});

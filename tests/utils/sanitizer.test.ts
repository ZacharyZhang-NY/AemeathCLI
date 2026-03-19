import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isCommandBlocked,
  isPathAllowed,
  redactSecrets,
  sanitizePromptInput,
  sanitizeShellArg,
  validatePath,
} from "../../src/utils/sanitizer.js";

describe("sanitizer", () => {
  it("quotes shell arguments and escapes embedded single quotes", () => {
    const result = sanitizeShellArg("it's dangerous");

    expect(result).toBe("'it'\\''s dangerous'");
  });

  it("resolves paths inside the project root", () => {
    const projectRoot = "/tmp/aemeath-project";

    const result = validatePath("src/../src/index.ts", projectRoot);

    expect(result).toBe(resolve(projectRoot, "src/index.ts"));
  });

  it("rejects paths that escape the project root", () => {
    const projectRoot = "/tmp/aemeath-project";

    expect(() => validatePath("../secret.txt", projectRoot)).toThrow(
      /Path traversal detected/,
    );
  });

  it("allows paths that stay within an explicitly allowed subtree", () => {
    const projectRoot = "/tmp/aemeath-project";

    const result = isPathAllowed("docs/guides/setup.md", ["docs"], projectRoot);

    expect(result).toBe(true);
  });

  it("rejects paths outside the allowed subtrees", () => {
    const projectRoot = "/tmp/aemeath-project";

    const result = isPathAllowed("src/index.ts", ["docs", "tests"], projectRoot);

    expect(result).toBe(false);
  });

  it("blocks commands case-insensitively after trimming whitespace", () => {
    const result = isCommandBlocked("  GIT RESET --HARD HEAD  ", ["git reset --hard"]);

    expect(result).toBe(true);
  });

  it("does not block unrelated commands", () => {
    const result = isCommandBlocked("git status", ["git reset --hard"]);

    expect(result).toBe(false);
  });

  it("redacts supported secret formats from log text", () => {
    const input = [
      "anthropic=sk-ant-api-test-token",
      "openai=sk-1234567890abcdefghijklmn",
      "google=AIza12345678901234567890123456789012345",
      "github=ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "auth=Bearer my-secret-token",
    ].join(" ");

    const result = redactSecrets(input);

    expect(result).toContain("sk-ant-api[REDACTED]");
    expect(result).toContain("sk-[REDACTED]");
    expect(result).toContain("AIza[REDACTED]");
    expect(result).toContain("ghp_[REDACTED]");
    expect(result).toContain("Bearer [REDACTED]");
  });

  it("strips null bytes from prompt input", () => {
    const result = sanitizePromptInput("hel\0lo\0");

    expect(result).toBe("hello");
  });
});

/**
 * Tests for orchestrator utility helpers — sleep, generateId, truncate.
 */

import { describe, it, expect } from "vitest";
import { sleep, generateId, truncate } from "../../src/orchestrator/utils/helpers.js";

describe("Orchestrator Helpers", () => {
  describe("sleep", () => {
    it("returns a promise", () => {
      const result = sleep(1);
      expect(result).toBeInstanceOf(Promise);
    });

    it("resolves after the specified delay", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("resolves with undefined", async () => {
      const result = await sleep(1);
      expect(result).toBeUndefined();
    });

    it("handles zero delay", async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("generateId", () => {
    it("generates a hex string", () => {
      const id = generateId();
      expect(/^[0-9a-f]+$/.test(id)).toBe(true);
    });

    it("generates 8 hex chars by default (4 bytes)", () => {
      const id = generateId();
      expect(id).toHaveLength(8);
    });

    it("generates 8 hex chars when given 4 bytes", () => {
      const id = generateId(4);
      expect(id).toHaveLength(8);
    });

    it("generates 16 hex chars when given 8 bytes", () => {
      const id = generateId(8);
      expect(id).toHaveLength(16);
    });

    it("generates 2 hex chars when given 1 byte", () => {
      const id = generateId(1);
      expect(id).toHaveLength(2);
    });

    it("generates unique IDs across 100 calls", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });

    it("generates unique IDs with small byte count", () => {
      // 2 bytes = 65536 possibilities, 20 calls should be unique
      const ids = new Set(Array.from({ length: 20 }, () => generateId(2)));
      expect(ids.size).toBe(20);
    });
  });

  describe("truncate", () => {
    it("returns short strings unchanged", () => {
      expect(truncate("hello", 100)).toBe("hello");
    });

    it("returns exact-length strings unchanged", () => {
      const text = "a".repeat(100);
      expect(truncate(text, 100)).toBe(text);
    });

    it("truncates strings longer than maxBytes", () => {
      const text = "a".repeat(200);
      const result = truncate(text, 100);
      expect(result.length).toBeLessThan(200);
    });

    it("appends default truncation marker", () => {
      const text = "a".repeat(200);
      const result = truncate(text, 100);
      expect(result).toContain("[truncated]");
    });

    it("uses the default marker when not specified", () => {
      const text = "a".repeat(200);
      const result = truncate(text, 100);
      expect(result).toBe("a".repeat(100) + "\n[truncated]");
    });

    it("uses a custom marker when specified", () => {
      const text = "a".repeat(200);
      const result = truncate(text, 100, "...");
      expect(result).toBe("a".repeat(100) + "...");
    });

    it("keeps the first maxBytes characters before truncation", () => {
      const text = "abcdefghij";
      const result = truncate(text, 5);
      expect(result.startsWith("abcde")).toBe(true);
    });

    it("handles empty string", () => {
      expect(truncate("", 100)).toBe("");
    });

    it("handles single character within limit", () => {
      expect(truncate("x", 1)).toBe("x");
    });

    it("handles maxBytes of 0 with non-empty string", () => {
      const result = truncate("hello", 0);
      expect(result).toBe("\n[truncated]");
    });
  });
});

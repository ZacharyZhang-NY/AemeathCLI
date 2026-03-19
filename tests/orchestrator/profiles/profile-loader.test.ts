/**
 * Tests for ProfileLoader — loads, lists, and resolves agent profiles.
 *
 * Tests load profiles from the built-in agent-store directory.
 * The user store (~/.aemeathcli/agent-store/) is not tested to
 * avoid side effects on the developer's machine.
 */

import { describe, it, expect } from "vitest";
import { ProfileLoader } from "../../../src/orchestrator/profiles/profile-loader.js";

describe("ProfileLoader", () => {
  const loader = new ProfileLoader();

  describe("load", () => {
    it("loads the supervisor profile", () => {
      const profile = loader.load("supervisor");
      expect(profile.name).toBe("supervisor");
      expect(profile.description).toBeTruthy();
      expect(profile.systemPrompt).toBeTruthy();
    });

    it("loads the developer profile", () => {
      const profile = loader.load("developer");
      expect(profile.name).toBe("developer");
      expect(profile.description).toBeTruthy();
      expect(profile.systemPrompt).toBeTruthy();
    });

    it("loads the reviewer profile", () => {
      const profile = loader.load("reviewer");
      expect(profile.name).toBe("reviewer");
      expect(profile.description).toBeTruthy();
    });

    it("loads the tester profile", () => {
      const profile = loader.load("tester");
      expect(profile.name).toBe("tester");
    });

    it("loads the researcher profile", () => {
      const profile = loader.load("researcher");
      expect(profile.name).toBe("researcher");
    });

    it("loads the debugger profile", () => {
      const profile = loader.load("debugger");
      expect(profile.name).toBe("debugger");
    });

    it("loads the documenter profile", () => {
      const profile = loader.load("documenter");
      expect(profile.name).toBe("documenter");
    });

    it("loads the architect profile", () => {
      const profile = loader.load("architect");
      expect(profile.name).toBe("architect");
    });

    it("handles .md extension in name", () => {
      const profile = loader.load("supervisor.md");
      expect(profile.name).toBe("supervisor");
    });

    it("throws for unknown profile", () => {
      expect(() => loader.load("nonexistent-profile-xyz")).toThrow(
        "Agent profile not found: nonexistent-profile-xyz",
      );
    });

    it("supervisor profile has no provider override", () => {
      const profile = loader.load("supervisor");
      expect(profile.provider).toBeUndefined();
    });

    it("developer profile has codex provider override", () => {
      const profile = loader.load("developer");
      expect(profile.provider).toBe("codex");
    });

    it("profiles have non-empty system prompts", () => {
      const profile = loader.load("supervisor");
      expect(profile.systemPrompt.length).toBeGreaterThan(50);
    });
  });

  describe("listProfiles", () => {
    it("lists all built-in profiles", () => {
      const profiles = loader.listProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(8);
    });

    it("includes supervisor in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("supervisor");
    });

    it("includes developer in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("developer");
    });

    it("includes reviewer in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("reviewer");
    });

    it("includes tester in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("tester");
    });

    it("includes researcher in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("researcher");
    });

    it("includes debugger in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("debugger");
    });

    it("includes documenter in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("documenter");
    });

    it("includes architect in the list", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      expect(names).toContain("architect");
    });

    it("every profile has a name and systemPrompt", () => {
      const profiles = loader.listProfiles();
      for (const profile of profiles) {
        expect(profile.name).toBeTruthy();
        expect(profile.systemPrompt).toBeTruthy();
      }
    });

    it("profiles are not duplicated", () => {
      const profiles = loader.listProfiles();
      const names = profiles.map((p) => p.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("resolveProvider", () => {
    it("resolves developer profile to codex", () => {
      const resolved = loader.resolveProvider("developer", "claude-code");
      expect(resolved).toBe("codex");
    });

    it("falls back to default for supervisor (no provider override)", () => {
      const resolved = loader.resolveProvider("supervisor", "claude-code");
      expect(resolved).toBe("claude-code");
    });

    it("falls back to default for nonexistent profile", () => {
      const resolved = loader.resolveProvider("nonexistent", "claude-code");
      expect(resolved).toBe("claude-code");
    });

    it("uses the provided fallback value", () => {
      const resolved = loader.resolveProvider("nonexistent", "gemini-cli");
      expect(resolved).toBe("gemini-cli");
    });

    it("resolves known profile with provider field", () => {
      // developer has provider: codex, so it should override the fallback
      const resolved = loader.resolveProvider("developer", "gemini-cli");
      expect(resolved).toBe("codex");
    });
  });
});

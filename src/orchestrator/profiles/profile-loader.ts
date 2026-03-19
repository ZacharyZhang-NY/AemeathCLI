/**
 * ProfileLoader — loads, lists, installs, and resolves agent profiles.
 *
 * Agent profiles are Markdown files with YAML frontmatter that define
 * an agent's identity (name, description, preferred CLI provider) and
 * a system prompt body.
 *
 * Resolution order: user store (~/.aemeathcli/agent-store/) takes
 * priority over the built-in store shipped with the package.
 */

import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getAemeathHome } from "../../utils/pathResolver.js";
import { CLI_PROVIDERS, type AgentProfile, type CliProviderType } from "../constants.js";

// ── Store Paths ──────────────────────────────────────────────────────────

/**
 * Built-in agent-store directory, co-located with the source/dist tree.
 * Uses `import.meta.url` so it resolves correctly after compilation.
 */
const DIST_BUILTIN_STORE = fileURLToPath(new URL("./agent-store/", import.meta.url));
const SOURCE_BUILTIN_STORE = fileURLToPath(new URL("../agent-store/", import.meta.url));
const BUILTIN_STORE = existsSync(DIST_BUILTIN_STORE) ? DIST_BUILTIN_STORE : SOURCE_BUILTIN_STORE;

/** Per-user override directory. */
const USER_STORE: string = join(getAemeathHome(), "agent-store");
const MAX_PROFILE_BYTES = 64 * 1024;

// ── Frontmatter Shape ────────────────────────────────────────────────────

interface ProfileFrontmatter {
  name?: string;
  description?: string;
  provider?: string;
}

function sanitizeProfileName(name: string): string {
  const normalized = name
    .trim()
    .replace(/\.md$/iu, "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+/gu, "-");

  if (normalized.length === 0 || normalized === "." || normalized === "..") {
    throw new Error("Profile name must contain at least one alphanumeric character");
  }

  return normalized;
}

function assertProfileSize(content: string, source: string): void {
  if (Buffer.byteLength(content, "utf-8") > MAX_PROFILE_BYTES) {
    throw new Error(`Profile is too large: ${source}`);
  }
}

// ── ProfileLoader ────────────────────────────────────────────────────────

export class ProfileLoader {
  constructor() {
    // Ensure the user store directory exists on first access.
    mkdirSync(USER_STORE, { recursive: true });
  }

  // ── Core API ─────────────────────────────────────────────────────────

  /**
   * Load a profile by name.
   * User store takes priority over the built-in store.
   */
  load(name: string): AgentProfile {
    const fileName = name.endsWith(".md") ? name : `${name}.md`;

    // Try user store first
    const userPath = join(USER_STORE, fileName);
    if (existsSync(userPath)) {
      return this.parseProfile(readFileSync(userPath, "utf-8"), userPath);
    }

    // Fall back to built-in store
    const builtinPath = join(BUILTIN_STORE, fileName);
    if (existsSync(builtinPath)) {
      return this.parseProfile(
        readFileSync(builtinPath, "utf-8"),
        builtinPath,
      );
    }

    throw new Error(`Agent profile not found: ${name}`);
  }

  /**
   * List all available profiles (user + built-in, deduplicated by name).
   * User profiles shadow built-in profiles with the same name.
   */
  listProfiles(): AgentProfile[] {
    const seen = new Set<string>();
    const profiles: AgentProfile[] = [];

    // User profiles first — they take priority
    for (const dir of [USER_STORE, BUILTIN_STORE]) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const name = basename(file, ".md");
        if (seen.has(name)) continue;
        seen.add(name);
        try {
          profiles.push(this.load(name));
        } catch {
          // Skip malformed profiles silently
        }
      }
    }

    return profiles;
  }

  /**
   * Install a profile from a local file path or remote URL.
   * The profile is validated before being written to the user store.
   * Returns the canonical profile name (filename without extension).
   */
  async install(source: string): Promise<string> {
    let content: string;

    if (source.startsWith("http://") || source.startsWith("https://")) {
      const url = new URL(source);
      if (url.protocol !== "https:") {
        throw new Error("Remote profile installation requires HTTPS");
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch profile: ${response.statusText}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && Number(contentLength) > MAX_PROFILE_BYTES) {
        throw new Error("Remote profile exceeds the maximum supported size");
      }

      content = await response.text();
    } else {
      if (!existsSync(source)) {
        throw new Error(`Profile source file not found: ${source}`);
      }
      content = readFileSync(source, "utf-8");
    }

    assertProfileSize(content, source);

    // Validate that the content is a valid profile
    const profile = this.parseProfile(content, source);
    const profileName = sanitizeProfileName(profile.name);

    const destPath = join(USER_STORE, `${profileName}.md`);
    writeFileSync(destPath, content, "utf-8");

    return profileName;
  }

  /**
   * Resolve the CLI provider for a profile, falling back to the given
   * default when the profile is missing or does not specify a provider.
   */
  resolveProvider(name: string, fallback: CliProviderType): CliProviderType {
    try {
      const profile = this.load(name);
      return profile.provider ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ── Internal Parser ──────────────────────────────────────────────────

  /**
   * Parse a profile Markdown file with optional YAML frontmatter.
   *
   * Accepted formats:
   *
   *   ---
   *   name: my-agent
   *   description: Does cool things
   *   provider: claude-code
   *   ---
   *   # System Prompt Body ...
   *
   * If no frontmatter block is present the entire file is treated as
   * the system prompt and the file's basename is used as the name.
   */
  private parseProfile(content: string, sourcePath: string): AgentProfile {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      // No frontmatter — treat entire content as system prompt
      const name = sanitizeProfileName(basename(sourcePath, ".md"));
      return {
        name,
        description: name,
        systemPrompt: content.trim(),
      };
    }

    const rawFrontmatter = match[1] || "";
    const body = (match[2] || "").trim();
    if (body.length === 0) {
      throw new Error(`Profile body is empty: ${sourcePath}`);
    }

    const frontmatter = parseYaml(rawFrontmatter) as ProfileFrontmatter;

    const provider = frontmatter.provider;
    const resolvedProvider =
      provider && (CLI_PROVIDERS as readonly string[]).includes(provider)
        ? provider as CliProviderType
        : undefined;

    return {
      name: sanitizeProfileName(frontmatter.name ?? basename(sourcePath, ".md")),
      description: frontmatter.description ?? "",
      provider: resolvedProvider,
      systemPrompt: body,
    };
  }
}

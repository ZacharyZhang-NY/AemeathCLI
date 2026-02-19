/**
 * SkillRegistry — Discovers, indexes, and resolves skill definitions.
 * Resolution priority: project > user > built-in (PRD section 10.4).
 * Progressive loading: only name + description loaded initially (~100 tokens each).
 */

import { readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";
import { getUserSkillsDir, getProjectSkillsDir } from "../utils/pathResolver.js";
import { SkillLoader } from "./loader.js";
import type { ISkillDefinition } from "../types/config.js";

// ── Constants ───────────────────────────────────────────────────────────

const SKILL_FILENAME = "SKILL.md";

// ── Types ───────────────────────────────────────────────────────────────

export type SkillSource = "project" | "user" | "built-in";

export interface ISkillSummary {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly source: SkillSource;
  readonly dirPath: string;
}

interface ISkillEntry {
  readonly summary: ISkillSummary;
  definition: ISkillDefinition | null;
}

// ── SkillRegistry Class ─────────────────────────────────────────────────

export class SkillRegistry {
  private readonly loader: SkillLoader;
  private readonly skills: Map<string, ISkillEntry> = new Map();
  private readonly triggerIndex: Map<string, string> = new Map();
  private initialized = false;

  constructor(loader?: SkillLoader) {
    this.loader = loader ?? new SkillLoader();
  }

  /**
   * Initialize the registry by scanning all skill directories.
   * Loads in priority order so higher-priority sources override lower ones.
   */
  async initialize(projectRoot?: string): Promise<void> {
    if (this.initialized) return;

    // 1. Built-in skills (lowest priority)
    const builtInDir = this.getBuiltInSkillsDir();
    await this.scanDirectory(builtInDir, "built-in");

    // 2. User-level skills
    const userDir = getUserSkillsDir();
    await this.scanDirectory(userDir, "user");

    // 3. Project-level skills (highest priority)
    if (projectRoot) {
      const projectDir = getProjectSkillsDir(projectRoot);
      await this.scanDirectory(projectDir, "project");
    }

    this.initialized = true;
    logger.info(
      { totalSkills: this.skills.size, totalTriggers: this.triggerIndex.size },
      "Skill registry initialized",
    );
  }

  /**
   * Get a full skill definition by name. Loads content on demand.
   */
  async getByName(name: string): Promise<ISkillDefinition | null> {
    const entry = this.skills.get(name);
    if (!entry) return null;

    if (!entry.definition) {
      const filePath = join(entry.summary.dirPath, SKILL_FILENAME);
      entry.definition = await this.loader.loadSkillFile(filePath);
    }

    return entry.definition;
  }

  /**
   * Find a skill by trigger string (e.g. "$review" or "review").
   */
  async getByTrigger(trigger: string): Promise<ISkillDefinition | null> {
    const normalized = trigger.startsWith("$") ? trigger.slice(1) : trigger;
    const withPrefix = `$${normalized}`;

    // Try both forms: with and without $ prefix
    const name =
      this.triggerIndex.get(withPrefix) ??
      this.triggerIndex.get(normalized) ??
      this.triggerIndex.get(trigger);

    if (!name) return null;
    return this.getByName(name);
  }

  /**
   * Resolve a trigger string to a skill name without loading the full definition.
   */
  resolveTriger(trigger: string): string | undefined {
    const normalized = trigger.startsWith("$") ? trigger.slice(1) : trigger;
    const withPrefix = `$${normalized}`;

    return (
      this.triggerIndex.get(withPrefix) ??
      this.triggerIndex.get(normalized) ??
      this.triggerIndex.get(trigger)
    );
  }

  /**
   * List all registered skill summaries.
   */
  listAll(): readonly ISkillSummary[] {
    return Array.from(this.skills.values()).map((entry) => entry.summary);
  }

  /**
   * Check if a skill exists by name.
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get the count of registered skills.
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Reset the registry for re-initialization.
   */
  reset(): void {
    this.skills.clear();
    this.triggerIndex.clear();
    this.initialized = false;
  }

  // ── Private Helpers ──────────────────────────────────────────────────

  /**
   * Scan a directory for skill subdirectories containing SKILL.md.
   */
  private async scanDirectory(dirPath: string, source: SkillSource): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      logger.debug({ dirPath, source }, "Skill directory not found, skipping");
      return;
    }

    for (const entry of entries) {
      const skillDir = join(dirPath, entry);

      try {
        const info = await stat(skillDir);
        if (!info.isDirectory()) continue;
      } catch {
        continue;
      }

      const skillFile = join(skillDir, SKILL_FILENAME);
      try {
        await stat(skillFile);
      } catch {
        logger.debug({ skillDir }, "No SKILL.md found in directory, skipping");
        continue;
      }

      await this.registerSkillFromFile(skillFile, skillDir, source);
    }
  }

  /**
   * Register a single skill from its SKILL.md file path.
   */
  private async registerSkillFromFile(
    skillFile: string,
    skillDir: string,
    source: SkillSource,
  ): Promise<void> {
    const definition = await this.loader.loadSkillFile(skillFile);
    if (!definition) return;

    const { frontmatter } = definition;
    const summary: ISkillSummary = {
      name: frontmatter.name,
      description: frontmatter.description,
      version: frontmatter.version,
      source,
      dirPath: skillDir,
    };

    // Remove previous trigger mappings if overriding
    const existing = this.skills.get(summary.name);
    if (existing) {
      this.removeTriggers(existing.summary.name);
      logger.debug(
        {
          skill: summary.name,
          oldSource: existing.summary.source,
          newSource: source,
        },
        "Skill overridden by higher-priority source",
      );
    }

    this.skills.set(summary.name, { summary, definition });
    this.registerTriggers(definition);
  }

  /**
   * Index all triggers for a skill definition.
   */
  private registerTriggers(definition: ISkillDefinition): void {
    for (const trigger of definition.frontmatter.triggers) {
      this.triggerIndex.set(trigger, definition.frontmatter.name);
    }
  }

  /**
   * Remove all trigger mappings associated with a skill name.
   */
  private removeTriggers(skillName: string): void {
    const toDelete: string[] = [];
    for (const [trigger, name] of this.triggerIndex) {
      if (name === skillName) {
        toDelete.push(trigger);
      }
    }
    for (const trigger of toDelete) {
      this.triggerIndex.delete(trigger);
    }
  }

  /**
   * Resolve the built-in skills directory relative to this module.
   */
  private getBuiltInSkillsDir(): string {
    const currentFilePath = fileURLToPath(import.meta.url);
    return join(dirname(currentFilePath), "built-in");
  }
}

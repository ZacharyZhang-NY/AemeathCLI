/**
 * SkillExecutor — Manages skill activation, context injection, and tool restriction.
 * Per PRD section 10.3: Load full SKILL.md content into context on activation,
 * restrict tools, and unload on deactivation.
 */

import { logger } from "../utils/logger.js";
import type { ISkillDefinition } from "../types/config.js";
import type { ModelRole } from "../types/model.js";
import type { SkillRegistry } from "./registry.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface IActiveSkill {
  readonly definition: ISkillDefinition;
  readonly activatedAt: Date;
  readonly previousAllowedTools: readonly string[] | null;
}

export interface ISkillActivationResult {
  readonly success: boolean;
  readonly skill?: ISkillDefinition;
  readonly errorMessage?: string;
  readonly warnings?: readonly string[];
}

export interface IModelCapabilities {
  readonly contextWindow: number;
  readonly currentRole?: ModelRole;
}

// ── SkillExecutor Class ─────────────────────────────────────────────────

export class SkillExecutor {
  private readonly registry: SkillRegistry;
  private activeSkill: IActiveSkill | null = null;
  private baseAllowedTools: readonly string[] | null = null;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  /**
   * Activate a skill by name.
   */
  async activateByName(
    name: string,
    modelCapabilities?: IModelCapabilities,
  ): Promise<ISkillActivationResult> {
    const definition = await this.registry.getByName(name);
    if (!definition) {
      return { success: false, errorMessage: `Skill "${name}" not found` };
    }

    return this.activate(definition, modelCapabilities);
  }

  /**
   * Activate a skill by trigger string (e.g. "$review" or "review").
   */
  async activateByTrigger(
    trigger: string,
    modelCapabilities?: IModelCapabilities,
  ): Promise<ISkillActivationResult> {
    const definition = await this.registry.getByTrigger(trigger);
    if (!definition) {
      return {
        success: false,
        errorMessage: `No skill found for trigger "${trigger}"`,
      };
    }

    return this.activate(definition, modelCapabilities);
  }

  /**
   * Deactivate the currently active skill, restoring previous tool set.
   */
  deactivate(): void {
    if (!this.activeSkill) {
      logger.debug("No active skill to deactivate");
      return;
    }

    const skillName = this.activeSkill.definition.frontmatter.name;
    this.baseAllowedTools = this.activeSkill.previousAllowedTools;
    this.activeSkill = null;

    logger.info({ skill: skillName }, "Skill deactivated");
  }

  /**
   * Get the currently active skill, or null if none.
   */
  getActiveSkill(): IActiveSkill | null {
    return this.activeSkill;
  }

  /**
   * Check if any skill is currently active.
   */
  isActive(): boolean {
    return this.activeSkill !== null;
  }

  /**
   * Get the active skill's body content for context injection.
   * Returns null if no skill is active.
   */
  getActiveSkillContent(): string | null {
    return this.activeSkill?.definition.body ?? null;
  }

  /**
   * Get the name of the currently active skill, or null.
   */
  getActiveSkillName(): string | null {
    return this.activeSkill?.definition.frontmatter.name ?? null;
  }

  /**
   * Get the allowed tool list under the current state.
   * When a skill is active with allowed-tools, only those tools are permitted.
   * Returns null when no restrictions are in effect.
   */
  getAllowedTools(): readonly string[] | null {
    if (this.activeSkill) {
      return this.activeSkill.definition.frontmatter["allowed-tools"] ?? null;
    }
    return this.baseAllowedTools;
  }

  /**
   * Check if a specific tool is allowed under the current skill restrictions.
   */
  isToolAllowed(toolName: string): boolean {
    const allowed = this.getAllowedTools();
    if (!allowed) return true;
    return allowed.includes(toolName);
  }

  /**
   * Set the base allowed tools (used when no skill is active).
   */
  setBaseAllowedTools(tools: readonly string[] | null): void {
    this.baseAllowedTools = tools;
  }

  /**
   * Validate model requirements for a skill definition.
   * Returns compatibility status and any warnings.
   */
  checkModelRequirements(
    definition: ISkillDefinition,
    capabilities: IModelCapabilities,
  ): { compatible: boolean; warnings: readonly string[] } {
    const warnings: string[] = [];
    const requirements = definition.frontmatter["model-requirements"];

    if (!requirements) {
      return { compatible: true, warnings: [] };
    }

    const preferredRole = requirements["preferred-role"];
    if (preferredRole && capabilities.currentRole) {
      if (capabilities.currentRole !== preferredRole) {
        warnings.push(
          `Skill "${definition.frontmatter.name}" prefers role "${preferredRole}", ` +
            `current role is "${capabilities.currentRole}"`,
        );
      }
    }

    const minContext = requirements["min-context"];
    if (minContext !== undefined && minContext !== null) {
      if (capabilities.contextWindow < minContext) {
        warnings.push(
          `Skill "${definition.frontmatter.name}" requires ${minContext} context tokens, ` +
            `but current model has ${capabilities.contextWindow}`,
        );
        return { compatible: false, warnings };
      }
    }

    return { compatible: true, warnings };
  }

  // ── Private ───────────────────────────────────────────────────────────

  /**
   * Core activation logic. Deactivates any current skill first.
   */
  private activate(
    definition: ISkillDefinition,
    modelCapabilities?: IModelCapabilities,
  ): ISkillActivationResult {
    const allWarnings: string[] = [];

    // Validate model requirements if capabilities are provided
    if (modelCapabilities) {
      const { compatible, warnings } = this.checkModelRequirements(
        definition,
        modelCapabilities,
      );
      allWarnings.push(...warnings);

      for (const warning of warnings) {
        logger.warn({ skill: definition.frontmatter.name }, warning);
      }

      if (!compatible) {
        return {
          success: false,
          skill: definition,
          errorMessage: `Model does not meet skill requirements: ${warnings.join("; ")}`,
          warnings: allWarnings,
        };
      }
    }

    // Deactivate current skill if one is active
    if (this.activeSkill) {
      logger.info(
        {
          current: this.activeSkill.definition.frontmatter.name,
          next: definition.frontmatter.name,
        },
        "Switching active skill",
      );
      this.deactivate();
    }

    this.activeSkill = {
      definition,
      activatedAt: new Date(),
      previousAllowedTools: this.baseAllowedTools,
    };

    logger.info(
      {
        skill: definition.frontmatter.name,
        version: definition.frontmatter.version,
        allowedTools: definition.frontmatter["allowed-tools"],
      },
      "Skill activated",
    );

    return {
      success: true,
      skill: definition,
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    };
  }
}

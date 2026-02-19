/**
 * SkillLoader — Parses YAML frontmatter + Markdown body from SKILL.md files.
 * Per PRD section 10.2-10.3: YAML skill file format with Zod validation.
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import type { ISkillFrontmatter, ISkillDefinition } from "../types/config.js";
import type { ModelRole } from "../types/model.js";

// ── Zod Schema ──────────────────────────────────────────────────────────

const MODEL_ROLE_VALUES: readonly [ModelRole, ...ModelRole[]] = [
  "planning",
  "coding",
  "review",
  "testing",
  "bugfix",
  "documentation",
];

const skillFrontmatterSchema = z.object({
  name: z.string().min(1, "Skill name is required"),
  description: z.string().min(1, "Skill description is required"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (e.g. 1.0.0)"),
  "allowed-tools": z.array(z.string().min(1)).optional(),
  triggers: z.array(z.string().min(1)).min(1, "At least one trigger is required"),
  "model-requirements": z
    .object({
      "preferred-role": z.enum(MODEL_ROLE_VALUES).optional(),
      "min-context": z.number().int().positive().optional(),
    })
    .optional(),
});

const FRONTMATTER_DELIMITER = "---";

// ── SkillLoader Class ───────────────────────────────────────────────────

export class SkillLoader {
  /**
   * Parse a single SKILL.md file into an ISkillDefinition.
   * Returns null if the file is malformed or invalid.
   */
  async loadSkillFile(filePath: string): Promise<ISkillDefinition | null> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ filePath, error: message }, "Failed to read skill file");
      return null;
    }

    return this.parseSkillContent(raw, filePath);
  }

  /**
   * Parse raw SKILL.md content string into an ISkillDefinition.
   */
  parseSkillContent(raw: string, filePath: string): ISkillDefinition | null {
    const extracted = this.extractFrontmatter(raw);
    if (!extracted) {
      logger.warn({ filePath }, "Skill file missing valid YAML frontmatter delimiters");
      return null;
    }

    const { yamlContent, body } = extracted;

    let rawFrontmatter: unknown;
    try {
      rawFrontmatter = parseYaml(yamlContent);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ filePath, error: message }, "Failed to parse YAML frontmatter");
      return null;
    }

    const result = skillFrontmatterSchema.safeParse(rawFrontmatter);
    if (!result.success) {
      logger.warn(
        { filePath, errors: result.error.flatten().fieldErrors },
        "Skill frontmatter validation failed",
      );
      return null;
    }

    const validated = result.data;

    // Build frontmatter with conditional spreads for exactOptionalPropertyTypes
    const modelReqs = validated["model-requirements"];
    const frontmatter: ISkillFrontmatter = {
      name: validated.name,
      description: validated.description,
      version: validated.version,
      triggers: validated.triggers,
      // Only include optional properties when they are defined (not undefined)
      ...(validated["allowed-tools"] !== undefined
        ? { "allowed-tools": validated["allowed-tools"] }
        : {}),
      ...(modelReqs !== undefined
        ? {
            "model-requirements": {
              ...(modelReqs["preferred-role"] !== undefined
                ? { "preferred-role": modelReqs["preferred-role"] }
                : {}),
              ...(modelReqs["min-context"] !== undefined
                ? { "min-context": modelReqs["min-context"] }
                : {}),
            },
          }
        : {}),
    };

    return {
      frontmatter,
      body: body.trim(),
      filePath,
    };
  }

  /**
   * Extract only name and description for progressive loading (~100 tokens).
   */
  async loadSkillSummary(
    filePath: string,
  ): Promise<{ name: string; description: string } | null> {
    const definition = await this.loadSkillFile(filePath);
    if (!definition) return null;

    return {
      name: definition.frontmatter.name,
      description: definition.frontmatter.description,
    };
  }

  /**
   * Split raw content into YAML frontmatter and Markdown body.
   * Frontmatter is delimited by `---` at the start and a subsequent `---`.
   */
  private extractFrontmatter(
    raw: string,
  ): { yamlContent: string; body: string } | null {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
      return null;
    }

    // Find the line after the opening delimiter
    const afterOpening = trimmed.slice(FRONTMATTER_DELIMITER.length);
    // The opening delimiter must be followed by a newline
    if (!afterOpening.startsWith("\n")) {
      return null;
    }

    const contentAfterOpening = afterOpening.slice(1); // skip the \n
    const closingIndex = contentAfterOpening.indexOf(`\n${FRONTMATTER_DELIMITER}`);
    if (closingIndex === -1) {
      return null;
    }

    const yamlContent = contentAfterOpening.slice(0, closingIndex);
    // Body starts after the closing delimiter line
    const afterClosing = contentAfterOpening.slice(
      closingIndex + 1 + FRONTMATTER_DELIMITER.length,
    );
    // Skip optional newline after closing delimiter
    const body = afterClosing.startsWith("\n") ? afterClosing.slice(1) : afterClosing;

    return { yamlContent, body };
  }
}

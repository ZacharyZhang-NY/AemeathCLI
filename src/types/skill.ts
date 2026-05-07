import type { ModelRole } from "./model.js";

export interface ISkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly "allowed-tools"?: readonly string[] | undefined;
  readonly triggers: readonly string[];
  readonly "model-requirements"?: {
    readonly "preferred-role"?: ModelRole | undefined;
    readonly "min-context"?: number | undefined;
  } | undefined;
}

export interface ISkillDefinition {
  readonly frontmatter: ISkillFrontmatter;
  readonly body: string;
  readonly filePath: string;
}

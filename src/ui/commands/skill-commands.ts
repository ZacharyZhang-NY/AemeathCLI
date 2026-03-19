/**
 * /skill slash command handler and $skill invocation handler.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { ICommandContext, SetMessagesDispatch } from "./types.js";
import { addSystemMessage } from "./types.js";
import { v4Id } from "../utils.js";

export async function handleSkillCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "list") {
    try {
      const { SkillRegistry } = await import("../../skills/registry.js");
      const { findProjectRoot } = await import("../../utils/pathResolver.js");
      const registry = new SkillRegistry();
      await registry.initialize(findProjectRoot());
      const skills = registry.listAll();
      if (skills.length === 0) {
        addSystemMessage(ctx, "No skills found.\nAdd skills in ~/.agents/skills/, ~/.aemeathcli/skills/, .agents/skills/, or .aemeathcli/skills/");
      } else {
        const lines = skills.map((s) => `  $${s.name.padEnd(16)} ${s.description}  [${s.source}]`);
        addSystemMessage(ctx, `Available Skills:\n${lines.join("\n")}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to list skills: ${msg}`);
    }
    return;
  }

  addSystemMessage(ctx, "Usage: /skill list\nInvoke a skill with $skill-name (e.g., $review, $commit, $plan)");
}

export async function handleSkillInvocation(
  input: string,
  setMessages: SetMessagesDispatch,
): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const trigger = parts[0] ?? "";
  const skillName = trigger.replace(/^\$/, "");

  if (!skillName) {
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: "Usage: $skill-name [args]\nType /skill list to see available skills.", createdAt: new Date() },
    ]);
    return;
  }

  setMessages((prev) => [
    ...prev,
    { id: v4Id(), role: "user" as const, content: input, createdAt: new Date() },
  ]);

  try {
    const { SkillRegistry } = await import("../../skills/registry.js");
    const { SkillExecutor } = await import("../../skills/executor.js");
    const { findProjectRoot } = await import("../../utils/pathResolver.js");
    const registry = new SkillRegistry();
    await registry.initialize(findProjectRoot());

    const executor = new SkillExecutor(registry);
    const result = await executor.activateByTrigger(trigger);

    if (!result.success) {
      setMessages((prev) => [
        ...prev,
        { id: v4Id(), role: "system" as const, content: result.errorMessage ?? `Skill not found: "${skillName}"\nType /skill list to see available skills.`, createdAt: new Date() },
      ]);
      return;
    }

    const content = executor.getActiveSkillContent();
    const warningText = result.warnings && result.warnings.length > 0
      ? `\nWarnings: ${result.warnings.join(", ")}`
      : "";
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: `Skill "$${skillName}" activated.${warningText}\n${content ? content.slice(0, 500) : ""}`, createdAt: new Date() },
    ]);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: `Skill error: ${msg}`, createdAt: new Date() },
    ]);
  }
}

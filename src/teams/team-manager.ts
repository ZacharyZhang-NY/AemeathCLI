/**
 * Team creation and lifecycle management per PRD section 8.2
 * Orchestrates agents, tasks, messaging, and plan approval for a team.
 */

import { join } from "node:path";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ITeamConfig,
  IAgentConfig,
  IAgentState,
  TeamStatus,
  ProviderName,
  ModelRole,
} from "../types/index.js";
import {
  logger,
  getTeamsDir,
  getTasksDir,
  ensureDirectory,
} from "../utils/index.js";
import { getEventBus } from "../core/event-bus.js";
import { AgentProcess, type IAgentProcessOptions } from "./agent-process.js";
import { MessageBus } from "./message-bus.js";
import { TaskStore } from "./task-store.js";
import { PlanApproval } from "./plan-approval.js";

// ── Public Types ──────────────────────────────────────────────────────

/** Agent definition used when creating a team. */
export interface IAgentDefinition {
  readonly name: string;
  readonly agentType: string;
  readonly model: string;
  readonly provider: ProviderName;
  readonly role: ModelRole;
}

/** Options for createTeam(). */
export interface ITeamCreateOptions {
  readonly description?: string;
  readonly agents: readonly IAgentDefinition[];
  readonly sessionId?: string;
  readonly cliEntryPoint?: string;
}

// ── Internal Types ────────────────────────────────────────────────────

/** Serialized team config for JSON persistence (dates as ISO strings). */
interface ISerializedTeamConfig {
  readonly teamName: string;
  readonly description?: string | undefined;
  readonly status: TeamStatus;
  readonly members: readonly IAgentConfig[];
  readonly createdAt: string;
}

/** Runtime state for an active team. */
interface IActiveTeam {
  readonly config: ITeamConfig;
  readonly processes: Map<string, AgentProcess>;
  readonly messageBus: MessageBus;
  readonly taskStore: TaskStore;
  readonly planApproval: PlanApproval;
  readonly sessionId: string;
}

// ── Validation ────────────────────────────────────────────────────────

const TEAM_NAME_PATTERN = /^[\w-]+$/;

// ── TeamManager ───────────────────────────────────────────────────────

export class TeamManager {
  private readonly activeTeams = new Map<string, IActiveTeam>();

  /** Create a new team: config, directories, and agent process handles. */
  async createTeam(
    name: string,
    options: ITeamCreateOptions,
  ): Promise<ITeamConfig> {
    if (this.activeTeams.has(name)) {
      throw new Error(`Team already exists: ${name}`);
    }

    if (!TEAM_NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid team name: "${name}". Use alphanumeric characters, dashes, or underscores.`,
      );
    }

    const teamDir = join(getTeamsDir(), name);
    if (existsSync(teamDir)) {
      throw new Error(`Team directory already exists: ${teamDir}`);
    }

    // Build agent configs with generated IDs
    const members: IAgentConfig[] = options.agents.map((def) => ({
      name: def.name,
      agentId: randomUUID(),
      agentType: def.agentType,
      model: def.model,
      provider: def.provider,
      role: def.role,
    }));

    const config: ITeamConfig = {
      teamName: name,
      description: options.description,
      status: "active",
      members,
      createdAt: new Date(),
    };

    // Create directories
    ensureDirectory(teamDir);
    ensureDirectory(join(getTasksDir(), name));

    // Persist config
    this.saveTeamConfig(name, config);

    // Initialize runtime resources
    const sessionId = options.sessionId ?? randomUUID();
    const messageBus = new MessageBus();
    const taskStore = new TaskStore(name);
    const planApproval = new PlanApproval(messageBus);

    // Create agent process handles (not yet started)
    const processes = new Map<string, AgentProcess>();

    for (const member of members) {
      const processOptions: IAgentProcessOptions = {
        teamName: name,
        sessionId,
        cliEntryPoint: options.cliEntryPoint,
      };

      const agentProcess = new AgentProcess(member, processOptions);
      processes.set(member.name, agentProcess);
      messageBus.registerAgent(member.agentId);
    }

    const activeTeam: IActiveTeam = {
      config,
      processes,
      messageBus,
      taskStore,
      planApproval,
      sessionId,
    };

    this.activeTeams.set(name, activeTeam);

    getEventBus().emit("team:created", {
      teamName: name,
      agentCount: members.length,
    });

    logger.info(
      { team: name, agents: members.length, sessionId },
      "Team created",
    );

    return config;
  }

  /** Start all agent processes for a team. */
  async startAgents(teamName: string): Promise<void> {
    const team = this.getActiveTeam(teamName);
    const startPromises: Promise<void>[] = [];

    for (const [agentName, agentProcess] of team.processes) {
      startPromises.push(
        agentProcess.start().catch((error: unknown) => {
          const reason =
            error instanceof Error ? error.message : String(error);
          logger.error(
            { team: teamName, agent: agentName, error: reason },
            "Failed to start agent",
          );
        }),
      );
    }

    await Promise.allSettled(startPromises);
  }

  /** Gracefully shutdown and remove a team. */
  async deleteTeam(name: string): Promise<void> {
    const active = this.activeTeams.get(name);

    if (active) {
      await this.shutdownAgents(active);
      active.planApproval.destroy();
      active.messageBus.destroy();
      this.activeTeams.delete(name);
    }

    // Remove directories from disk
    const teamDir = join(getTeamsDir(), name);
    if (existsSync(teamDir)) {
      rmSync(teamDir, { recursive: true, force: true });
    }

    const taskDir = join(getTasksDir(), name);
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true, force: true });
    }

    getEventBus().emit("team:deleted", { teamName: name });
    logger.info({ team: name }, "Team deleted");
  }

  /** List all teams from disk (active and inactive). */
  listTeams(): ITeamConfig[] {
    const teamsDir = getTeamsDir();
    if (!existsSync(teamsDir)) return [];

    const entries = readdirSync(teamsDir, { withFileTypes: true });
    const configs: ITeamConfig[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const teamConfig = this.loadTeamConfig(entry.name);
        configs.push(teamConfig);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          { team: entry.name, error: reason },
          "Skipping unreadable team",
        );
      }
    }

    return configs;
  }

  /** Load a team config from disk. Throws if not found. */
  getTeam(name: string): ITeamConfig {
    return this.loadTeamConfig(name);
  }

  /** Get the runtime state of a specific agent within an active team. */
  getAgentState(
    teamName: string,
    agentName: string,
  ): IAgentState | undefined {
    const team = this.activeTeams.get(teamName);
    if (!team) return undefined;

    const agentProcess = team.processes.get(agentName);
    return agentProcess?.getState();
  }

  /** Get all agent states for an active team. */
  getAgentStates(teamName: string): readonly IAgentState[] {
    const team = this.activeTeams.get(teamName);
    if (!team) return [];

    return [...team.processes.values()].map((p) => p.getState());
  }

  /** Get the message bus for an active team. */
  getMessageBus(teamName: string): MessageBus | undefined {
    return this.activeTeams.get(teamName)?.messageBus;
  }

  /** Get the task store for an active team. */
  getTaskStore(teamName: string): TaskStore | undefined {
    return this.activeTeams.get(teamName)?.taskStore;
  }

  /** Get the plan approval handler for an active team. */
  getPlanApproval(teamName: string): PlanApproval | undefined {
    return this.activeTeams.get(teamName)?.planApproval;
  }

  /** Check whether a team is currently active in memory. */
  isTeamActive(name: string): boolean {
    return this.activeTeams.has(name);
  }

  /** Shut down all active teams. Call during application cleanup. */
  async shutdownAll(): Promise<void> {
    const names = [...this.activeTeams.keys()];
    await Promise.allSettled(names.map((n) => this.deleteTeam(n)));
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getActiveTeam(teamName: string): IActiveTeam {
    const team = this.activeTeams.get(teamName);
    if (!team) {
      throw new Error(`Team not active: ${teamName}`);
    }
    return team;
  }

  private saveTeamConfig(name: string, config: ITeamConfig): void {
    const teamDir = join(getTeamsDir(), name);
    ensureDirectory(teamDir);

    const serialized: ISerializedTeamConfig = {
      teamName: config.teamName,
      description: config.description,
      status: config.status,
      members: config.members,
      createdAt: config.createdAt.toISOString(),
    };

    const configPath = join(teamDir, "config.json");
    writeFileSync(configPath, JSON.stringify(serialized, null, 2), {
      encoding: "utf-8",
      mode: 0o644,
    });
  }

  private loadTeamConfig(name: string): ITeamConfig {
    const configPath = join(getTeamsDir(), name, "config.json");
    if (!existsSync(configPath)) {
      throw new Error(`Team config not found: ${name}`);
    }

    const raw = readFileSync(configPath, "utf-8");
    const data = JSON.parse(raw) as ISerializedTeamConfig;

    return {
      teamName: data.teamName,
      description: data.description,
      status: data.status,
      members: data.members,
      createdAt: new Date(data.createdAt),
    };
  }

  private async shutdownAgents(team: IActiveTeam): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [agentName, agentProcess] of team.processes) {
      stopPromises.push(
        agentProcess.stop().catch((error: unknown) => {
          const reason =
            error instanceof Error ? error.message : String(error);
          logger.error(
            { agent: agentName, error: reason },
            "Error stopping agent",
          );
        }),
      );
    }

    await Promise.allSettled(stopPromises);
    team.processes.clear();
  }
}

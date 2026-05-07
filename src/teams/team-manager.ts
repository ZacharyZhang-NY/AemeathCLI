import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  IAgentConfig,
  IAgentState,
  ITeamConfig,
  ModelRole,
  ProviderName,
  TeamStatus,
} from "../types/index.js";
import { getEventBus } from "../core/event-bus.js";
import { loadConfig } from "../config/loader.js";
import { createAemeathSession } from "../core/session.js";
import { ensureDirectory, getTasksDir, getTeamsDir } from "../utils/index.js";
import { logger } from "../utils/logger.js";
import { MessageBus } from "./message-bus.js";
import { PlanApproval } from "./plan-approval.js";
import { SessionAgent } from "./session-agent.js";
import { TaskStore } from "./task-store.js";

export interface IAgentDefinition {
  readonly name: string;
  readonly agentType: string;
  readonly model: string;
  readonly provider: ProviderName;
  readonly role: ModelRole;
}

export interface ITeamCreateOptions {
  readonly description?: string;
  readonly agents: readonly IAgentDefinition[];
  readonly sessionId?: string;
  readonly cliEntryPoint?: string;
  readonly agentEnv?: Readonly<Record<string, string>>;
}

interface ISerializedTeamConfig {
  readonly teamName: string;
  readonly description?: string | undefined;
  readonly status: TeamStatus;
  readonly members: readonly IAgentConfig[];
  readonly createdAt: string;
}

interface IActiveTeam {
  readonly config: ITeamConfig;
  readonly agents: Map<string, SessionAgent>;
  readonly messageBus: MessageBus;
  readonly taskStore: TaskStore;
  readonly planApproval: PlanApproval;
  readonly sessionId: string;
}

const TEAM_NAME_PATTERN = /^[\w-]+$/;

export class TeamManager {
  private readonly activeTeams = new Map<string, IActiveTeam>();

  createTeam(name: string, options: ITeamCreateOptions): ITeamConfig {
    if (this.activeTeams.has(name)) {
      throw new Error(`Team already exists: ${name}`);
    }
    if (!TEAM_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid team name: "${name}"`);
    }

    const teamDir = join(getTeamsDir(), name);
    if (existsSync(teamDir)) {
      throw new Error(`Team directory already exists: ${teamDir}`);
    }

    const members: IAgentConfig[] = options.agents.map((definition) => ({
      name: definition.name,
      agentId: randomUUID(),
      agentType: definition.agentType,
      model: definition.model,
      provider: definition.provider,
      role: definition.role,
    }));

    const config: ITeamConfig = {
      teamName: name,
      description: options.description,
      status: "active",
      members,
      createdAt: new Date(),
    };

    ensureDirectory(teamDir);
    ensureDirectory(join(getTasksDir(), name));
    this.saveTeamConfig(name, config);

    const activeTeam: IActiveTeam = {
      config,
      agents: new Map(),
      messageBus: new MessageBus(),
      taskStore: new TaskStore(name),
      planApproval: new PlanApproval(new MessageBus()),
      sessionId: options.sessionId ?? randomUUID(),
    };

    this.activeTeams.set(name, activeTeam);
    getEventBus().emit("team:created", { teamName: name, agentCount: members.length });
    return config;
  }

  async startAgents(teamName: string): Promise<void> {
    const team = this.getActiveTeam(teamName);
    if (team.agents.size > 0) {
      return;
    }

    const config = loadConfig(process.cwd());
    const permissionMode = config.permissions.mode;

    for (const member of team.config.members) {
      const session = await createAemeathSession({
        config,
        cwd: process.cwd(),
        role: member.role,
        modelOverride: member.model,
        permissionMode,
      });
      const agent = new SessionAgent(member, session);
      agent.start();
      team.agents.set(member.name, agent);
    }

    logger.info({ team: teamName, agents: team.agents.size }, "Session-backed team started");
  }

  async deleteTeam(name: string): Promise<void> {
    const active = this.activeTeams.get(name);
    if (active) {
      await Promise.all([...active.agents.values()].map((agent) => agent.stop()));
      active.agents.clear();
      active.planApproval.destroy();
      active.messageBus.destroy();
      this.activeTeams.delete(name);
    }

    const teamDir = join(getTeamsDir(), name);
    if (existsSync(teamDir)) {
      rmSync(teamDir, { recursive: true, force: true });
    }
    const taskDir = join(getTasksDir(), name);
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true, force: true });
    }
  }

  listTeams(): ITeamConfig[] {
    const teamsDir = getTeamsDir();
    if (!existsSync(teamsDir)) {
      return [];
    }

    return readdirSync(teamsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.loadTeamConfig(entry.name));
  }

  getTeam(name: string): ITeamConfig {
    return this.loadTeamConfig(name);
  }

  getAgentState(teamName: string, agentName: string): IAgentState | undefined {
    return this.activeTeams.get(teamName)?.agents.get(agentName)?.getState();
  }

  getAgentStates(teamName: string): readonly IAgentState[] {
    const team = this.activeTeams.get(teamName);
    if (!team) {
      return [];
    }
    return [...team.agents.values()].map((agent) => agent.getState());
  }

  getMessageBus(teamName: string): MessageBus | undefined {
    return this.activeTeams.get(teamName)?.messageBus;
  }

  getTaskStore(teamName: string): TaskStore | undefined {
    return this.activeTeams.get(teamName)?.taskStore;
  }

  getPlanApproval(teamName: string): PlanApproval | undefined {
    return this.activeTeams.get(teamName)?.planApproval;
  }

  onAgentMessages(
    teamName: string,
    callback: (agentName: string, method: string, params: Record<string, unknown>) => void,
  ): () => void {
    const team = this.getActiveTeam(teamName);
    const cleanups: Array<() => void> = [];
    for (const [agentName, agent] of team.agents) {
      const cleanup = agent.onMessage((method, params) => {
        callback(agentName, method, params);
      });
      cleanups.push(cleanup);
    }
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  assignTask(teamName: string, agentName: string, taskId: string, subject: string, description: string): void {
    const team = this.getActiveTeam(teamName);
    team.taskStore.save({
      id: taskId,
      subject,
      description,
      status: "pending",
      owner: agentName,
      model: team.config.members.find((member) => member.name === agentName)?.model,
      role: team.config.members.find((member) => member.name === agentName)?.role,
      blocks: [],
      blockedBy: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    team.agents.get(agentName)?.assignTask(taskId, subject, description);
  }

  isTeamActive(name: string): boolean {
    return this.activeTeams.has(name);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.activeTeams.keys()].map((name) => this.deleteTeam(name)));
  }

  private getActiveTeam(teamName: string): IActiveTeam {
    const team = this.activeTeams.get(teamName);
    if (!team) {
      throw new Error(`Team not active: ${teamName}`);
    }
    return team;
  }

  private saveTeamConfig(name: string, config: ITeamConfig): void {
    const serialized: ISerializedTeamConfig = {
      teamName: config.teamName,
      description: config.description,
      status: config.status,
      members: config.members,
      createdAt: config.createdAt.toISOString(),
    };
    const configPath = join(getTeamsDir(), name, "config.json");
    writeFileSync(configPath, JSON.stringify(serialized, null, 2), { encoding: "utf-8", mode: 0o644 });
  }

  private loadTeamConfig(name: string): ITeamConfig {
    const configPath = join(getTeamsDir(), name, "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const serialized = JSON.parse(raw) as ISerializedTeamConfig;
    return {
      teamName: serialized.teamName,
      description: serialized.description,
      status: serialized.status,
      members: serialized.members,
      createdAt: new Date(serialized.createdAt),
    };
  }
}

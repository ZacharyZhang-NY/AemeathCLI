/**
 * File-based task persistence per PRD section 20.2
 * Atomic writes for crash recovery: write to temp file, then rename.
 * Store at getTasksDir()/teamName/taskId.json
 */

import { join } from "node:path";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  existsSync,
} from "node:fs";
import type { ITask, TaskStatus, ModelRole } from "../types/index.js";
import { logger, getTasksDir, ensureDirectory } from "../utils/index.js";

// ── Serialization Format ──────────────────────────────────────────────

/** Serialized task format with ISO-8601 date strings for JSON persistence. */
interface ISerializedTask {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly owner?: string | undefined;
  readonly model?: string | undefined;
  readonly role?: ModelRole | undefined;
  readonly blocks: readonly string[];
  readonly blockedBy: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── TaskStore ─────────────────────────────────────────────────────────

export class TaskStore {
  private readonly storeDir: string;

  constructor(teamName: string) {
    this.storeDir = join(getTasksDir(), teamName);
    ensureDirectory(this.storeDir);
    this.cleanupTempFiles();
  }

  /** Persist a task to disk with atomic write (temp + rename). */
  save(task: ITask): void {
    const serialized = TaskStore.serialize(task);
    const filePath = this.getTaskFilePath(task.id);
    const tmpPath = `${filePath}.tmp`;

    try {
      writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), {
        encoding: "utf-8",
        mode: 0o644,
      });
      renameSync(tmpPath, filePath);
      logger.debug({ taskId: task.id }, "Task persisted to disk");
    } catch (error: unknown) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* temp cleanup best-effort */
      }
      const reason = error instanceof Error ? error.message : String(error);
      logger.error({ taskId: task.id, error: reason }, "Failed to save task");
      throw error;
    }
  }

  /** Load a single task by ID. Throws if not found. */
  load(taskId: string): ITask {
    const filePath = this.getTaskFilePath(taskId);
    if (!existsSync(filePath)) {
      throw new Error(`Task file not found: ${taskId}`);
    }

    const raw = readFileSync(filePath, "utf-8");
    const data: unknown = JSON.parse(raw);
    return TaskStore.deserialize(data as ISerializedTask);
  }

  /** Load all tasks for this team, sorted by creation time. */
  loadAll(): ITask[] {
    if (!existsSync(this.storeDir)) {
      return [];
    }

    const files = readdirSync(this.storeDir).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".tmp"),
    );
    const tasks: ITask[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.storeDir, file), "utf-8");
        const data: unknown = JSON.parse(raw);
        tasks.push(TaskStore.deserialize(data as ISerializedTask));
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn({ file, error: reason }, "Skipping corrupt task file");
      }
    }

    return tasks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** Remove a task file from disk. Returns true if deleted. */
  remove(taskId: string): boolean {
    const filePath = this.getTaskFilePath(taskId);
    if (!existsSync(filePath)) {
      return false;
    }

    try {
      unlinkSync(filePath);
      logger.debug({ taskId }, "Task file removed");
      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error({ taskId, error: reason }, "Failed to remove task file");
      return false;
    }
  }

  /** Check whether a task file exists on disk. */
  exists(taskId: string): boolean {
    return existsSync(this.getTaskFilePath(taskId));
  }

  /** Absolute path to this team's task store directory. */
  getStorePath(): string {
    return this.storeDir;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getTaskFilePath(taskId: string): string {
    return join(this.storeDir, `${taskId}.json`);
  }

  /** Remove orphaned .tmp files left from interrupted writes. */
  private cleanupTempFiles(): void {
    if (!existsSync(this.storeDir)) return;

    const tmpFiles = readdirSync(this.storeDir).filter((f) =>
      f.endsWith(".tmp"),
    );

    for (const file of tmpFiles) {
      try {
        unlinkSync(join(this.storeDir, file));
      } catch {
        /* best-effort */
      }
    }

    if (tmpFiles.length > 0) {
      logger.info(
        { count: tmpFiles.length },
        "Cleaned up stale temp task files",
      );
    }
  }

  private static serialize(task: ITask): ISerializedTask {
    return {
      id: task.id,
      subject: task.subject,
      description: task.description,
      status: task.status,
      owner: task.owner,
      model: task.model,
      role: task.role,
      blocks: [...task.blocks],
      blockedBy: [...task.blockedBy],
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private static deserialize(data: ISerializedTask): ITask {
    return {
      id: data.id,
      subject: data.subject,
      description: data.description,
      status: data.status,
      owner: data.owner,
      model: data.model,
      role: data.role,
      blocks: [...data.blocks],
      blockedBy: [...data.blockedBy],
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }
}

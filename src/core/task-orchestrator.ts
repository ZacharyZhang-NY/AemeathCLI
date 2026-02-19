/**
 * Agent team task coordination per PRD section 8
 * Manages task creation, assignment, dependency resolution, and completion tracking.
 */

import type { ITask, TaskStatus, ModelRole } from "../types/index.js";
import { logger } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";

let nextTaskId = 1;

function generateTaskId(): string {
  return String(nextTaskId++);
}

export class TaskOrchestrator {
  private readonly tasks = new Map<string, ITask>();

  /**
   * Create a new task.
   */
  createTask(
    subject: string,
    description: string,
    options?: {
      owner?: string;
      model?: string;
      role?: ModelRole;
      blockedBy?: string[];
    },
  ): ITask {
    const id = generateTaskId();
    const now = new Date();

    const task: ITask = {
      id,
      subject,
      description,
      status: "pending",
      owner: options?.owner,
      model: options?.model,
      role: options?.role,
      blocks: [],
      blockedBy: options?.blockedBy ? [...options.blockedBy] : [],
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, task);

    // Set up reverse blocking relationships
    if (options?.blockedBy) {
      for (const blockerId of options.blockedBy) {
        const blocker = this.tasks.get(blockerId);
        if (blocker && !blocker.blocks.includes(id)) {
          blocker.blocks.push(id);
        }
      }
    }

    getEventBus().emit("task:created", { taskId: id, subject });
    logger.info({ taskId: id, subject }, "Task created");

    return task;
  }

  /**
   * Update task status.
   */
  updateStatus(taskId: string, status: TaskStatus): void {
    const task = this.getTask(taskId);
    task.status = status;
    task.updatedAt = new Date();

    getEventBus().emit("task:updated", { taskId, status });

    if (status === "completed") {
      getEventBus().emit("task:completed", { taskId });
      this.resolveBlockedTasks(taskId);
    }

    logger.info({ taskId, status }, "Task status updated");
  }

  /**
   * Assign a task to an agent.
   */
  assignTask(taskId: string, owner: string, model?: string): void {
    const task = this.getTask(taskId);
    task.owner = owner;
    if (model) {
      (task as { model?: string }).model = model;
    }
    task.updatedAt = new Date();
    logger.info({ taskId, owner, model }, "Task assigned");
  }

  /**
   * Get a task by ID. Throws if not found.
   */
  getTask(taskId: string): ITask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): readonly ITask[] {
    return [...this.tasks.values()];
  }

  /**
   * Get tasks by status.
   */
  getTasksByStatus(status: TaskStatus): readonly ITask[] {
    return [...this.tasks.values()].filter((t) => t.status === status);
  }

  /**
   * Get tasks assigned to an agent.
   */
  getTasksByOwner(owner: string): readonly ITask[] {
    return [...this.tasks.values()].filter((t) => t.owner === owner);
  }

  /**
   * Get tasks that are ready to be worked on (pending, not blocked).
   */
  getAvailableTasks(): readonly ITask[] {
    return [...this.tasks.values()].filter(
      (t) =>
        t.status === "pending" &&
        !t.owner &&
        t.blockedBy.every((blockerId) => {
          const blocker = this.tasks.get(blockerId);
          return blocker?.status === "completed";
        }),
    );
  }

  /**
   * Check if all tasks are completed.
   */
  isAllComplete(): boolean {
    return [...this.tasks.values()].every((t) => t.status === "completed");
  }

  /**
   * Get progress summary.
   */
  getProgress(): { total: number; completed: number; inProgress: number; pending: number; blocked: number } {
    const tasks = [...this.tasks.values()];
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
    };
  }

  /**
   * Delete a task.
   */
  deleteTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      // Remove from blockedBy references
      for (const [, otherTask] of this.tasks) {
        otherTask.blockedBy = otherTask.blockedBy.filter((id) => id !== taskId);
        otherTask.blocks = otherTask.blocks.filter((id) => id !== taskId);
      }
      this.tasks.delete(taskId);
    }
  }

  /**
   * When a task completes, check if any blocked tasks can now proceed.
   */
  private resolveBlockedTasks(completedTaskId: string): void {
    for (const [, task] of this.tasks) {
      if (task.status === "blocked" || task.status === "pending") {
        const allDepsComplete = task.blockedBy.every((depId) => {
          const dep = this.tasks.get(depId);
          return dep?.status === "completed";
        });

        if (allDepsComplete && task.status === "blocked") {
          task.status = "pending";
          task.updatedAt = new Date();
          logger.info(
            { taskId: task.id, unblockedBy: completedTaskId },
            "Task unblocked",
          );
        }
      }
    }
  }
}

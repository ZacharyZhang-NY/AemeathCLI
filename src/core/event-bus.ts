/**
 * Typed event emitter per PRD section 6.1
 * Core IPC backbone for the orchestration layer.
 */

type EventHandler<T = unknown> = (data: T) => void;

interface IEventMap {
  "model:request": { model: string; role?: string };
  "model:response": { model: string; tokens: number; cost: number };
  "model:stream:chunk": { model: string; content: string };
  "model:stream:done": { model: string; totalTokens: number };
  "model:error": { model: string; error: Error };
  "tool:call": { name: string; args: Record<string, unknown> };
  "tool:result": { name: string; isError: boolean; content: string };
  "team:created": { teamName: string; agentCount: number };
  "team:deleted": { teamName: string };
  "agent:spawned": { agentName: string; model: string };
  "agent:status": { agentName: string; status: string };
  "agent:message": { from: string; to: string; content: string };
  "task:created": { taskId: string; subject: string };
  "task:updated": { taskId: string; status: string };
  "task:completed": { taskId: string };
  "cost:updated": { total: number; provider: string; delta: number };
  "cost:warning": { current: number; limit: number };
  "cost:exceeded": { current: number; limit: number };
  "pane:created": { paneId: string; agentName: string };
  "pane:closed": { paneId: string };
  "skill:activated": { skillName: string };
  "skill:deactivated": { skillName: string };
  "mcp:server:started": { serverName: string };
  "mcp:server:stopped": { serverName: string };
  "mcp:server:error": { serverName: string; error: string };
  "config:changed": { key: string };
  "auth:login": { provider: string; email?: string };
  "auth:logout": { provider: string };
}

type EventName = keyof IEventMap;

export class EventBus {
  private readonly listeners = new Map<string, Set<EventHandler>>();

  on<K extends EventName>(event: K, handler: EventHandler<IEventMap[K]>): () => void {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler as EventHandler);
    this.listeners.set(event, handlers);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  once<K extends EventName>(event: K, handler: EventHandler<IEventMap[K]>): () => void {
    const wrappedHandler: EventHandler<IEventMap[K]> = (data) => {
      unsubscribe();
      handler(data);
    };
    const unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  emit<K extends EventName>(event: K, data: IEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        (handler as EventHandler<IEventMap[K]>)(data);
      } catch {
        // Event handlers should not throw; silently catch to avoid cascading
      }
    }
  }

  removeAllListeners(event?: EventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: EventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// Singleton event bus for the application
let globalEventBus: EventBus | undefined;

export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

export type { IEventMap, EventName };

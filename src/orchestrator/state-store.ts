/**
 * StateStore — SQLite persistence for orchestrator terminals and inbox.
 *
 * Provides CRUD for terminal records and inbox message queuing/delivery.
 * Uses better-sqlite3 with WAL mode and parameterized queries throughout.
 *
 * @see IMPLEMENT_PLAN.md Section 6.3
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

import type {
  TerminalRecord,
  InboxMessage,
  CliProviderType,
  SessionRecord,
  TerminalStatus,
} from "./constants.js";

// ── Defaults ──────────────────────────────────────────────────────────────

const DB_DIR = join(homedir(), ".aemeathcli", "db");
const DB_PATH = join(DB_DIR, "orchestrator.db");

// ── Schema ────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  pid INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS terminals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  pid INTEGER,
  provider TEXT NOT NULL,
  agent_profile TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_terminals_session ON terminals(session_id);
CREATE INDEX IF NOT EXISTS idx_inbox_receiver ON inbox(receiver, status);
`;

// ── Row types (raw SQLite rows before mapping) ───────────────────────────

interface TerminalRow {
  id: string;
  session_id: string;
  pid: number | null;
  provider: string;
  agent_profile: string | null;
  status: string;
  created_at: string;
}

interface SessionRow {
  session_id: string;
  pid: number | null;
  created_at: string;
}

interface InboxRow {
  id: number;
  sender: string;
  receiver: string;
  content: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
}

// ── StateStore ────────────────────────────────────────────────────────────

/**
 * SQLite-backed persistence for orchestrator state.
 *
 * Manages terminal records (tracked PTY sessions) and inbox messages
 * (queued messages for delivery to workers when they become idle).
 */
export class StateStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? DB_PATH;
    // Ensure parent directory exists
    mkdirSync(join(path, ".."), { recursive: true });

    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    try {
      this.db.prepare("ALTER TABLE terminals ADD COLUMN pid INTEGER").run();
    } catch {
      // Column already exists
    }
  }

  // ── Terminal CRUD ─────────────────────────────────────────────────────

  createSession(record: SessionRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (session_id, pid, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(
      record.sessionId,
      record.pid ?? null,
      record.createdAt.toISOString(),
    );
  }

  /**
   * Insert a new terminal record.
   *
   * @param record Terminal record with id, sessionId, provider, etc.
   */
  createTerminal(record: TerminalRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO terminals (id, session_id, pid, provider, agent_profile, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.sessionId,
      record.pid ?? null,
      record.provider,
      record.agentProfile ?? null,
      record.status,
      record.createdAt.toISOString(),
    );
  }

  /**
   * List all terminals belonging to a session.
   *
   * @param sessionId The orchestrator session ID to filter by.
   * @returns Array of terminal records, ordered by creation time.
   */
  listTerminals(sessionId: string): TerminalRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, session_id, pid, provider, agent_profile, status, created_at
      FROM terminals
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(sessionId) as TerminalRow[];
    return rows.map((row) => this.mapTerminalRow(row));
  }

  /**
   * Update the status of a terminal.
   *
   * @param id     Terminal ID.
   * @param status New terminal status.
   */
  updateTerminalStatus(id: string, status: TerminalStatus): void {
    const stmt = this.db.prepare(`
      UPDATE terminals SET status = ? WHERE id = ?
    `);
    stmt.run(status, id);
  }

  /**
   * Delete a terminal record by ID.
   *
   * @param id Terminal ID to delete.
   */
  deleteTerminal(id: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM terminals WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Get a single terminal record by ID.
   *
   * @param id Terminal ID.
   * @returns The terminal record, or undefined if not found.
   */
  getTerminal(id: string): TerminalRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT id, session_id, pid, provider, agent_profile, status, created_at
      FROM terminals
      WHERE id = ?
    `);
    const row = stmt.get(id) as TerminalRow | undefined;
    if (!row) return undefined;
    return this.mapTerminalRow(row);
  }

  // ── Inbox Operations ──────────────────────────────────────────────────

  /**
   * Queue a message for delivery to a worker.
   *
   * Messages start with "pending" status and are delivered by the
   * inbox delivery loop when the target worker becomes idle.
   *
   * @param msg Object with from (sender), to (receiver), and content.
   * @returns The auto-generated message ID.
   */
  queueMessage(msg: { from: string; to: string; content: string }): number {
    const stmt = this.db.prepare(`
      INSERT INTO inbox (sender, receiver, content, status)
      VALUES (?, ?, ?, 'pending')
    `);
    const result = stmt.run(msg.from, msg.to, msg.content);
    return Number(result.lastInsertRowid);
  }

  /**
   * Get all pending messages for a receiver, ordered by creation time.
   *
   * @param receiverId The terminal ID of the receiving worker.
   * @returns Array of pending inbox messages.
   */
  getPendingMessages(receiverId: string): InboxMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, sender, receiver, content, status, created_at, delivered_at
      FROM inbox
      WHERE receiver = ? AND status = 'pending'
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(receiverId) as InboxRow[];
    return rows.map((row) => this.mapInboxRow(row));
  }

  /**
   * Mark a message as delivered and record the delivery timestamp.
   *
   * @param id Message ID.
   */
  markDelivered(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE inbox
      SET status = 'delivered', delivered_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Mark a message as failed (delivery was attempted but unsuccessful).
   *
   * @param id Message ID.
   */
  markFailed(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE inbox SET status = 'failed' WHERE id = ?
    `);
    stmt.run(id);
  }

  /**
   * Get all messages for a receiver regardless of status.
   *
   * @param receiverId The terminal ID of the receiving worker.
   * @returns Array of all inbox messages for this receiver.
   */
  getAllMessages(receiverId: string): InboxMessage[] {
    const stmt = this.db.prepare(`
      SELECT id, sender, receiver, content, status, created_at, delivered_at
      FROM inbox
      WHERE receiver = ?
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(receiverId) as InboxRow[];
    return rows.map((row) => this.mapInboxRow(row));
  }

  listAllTerminals(): TerminalRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, session_id, pid, provider, agent_profile, status, created_at
      FROM terminals
      ORDER BY created_at ASC
    `);
    const rows = stmt.all() as TerminalRow[];
    return rows.map((row) => this.mapTerminalRow(row));
  }

  listSessions(): SessionRecord[] {
    const grouped = new Map<string, SessionRecord>();
    const sessionRows = this.db.prepare(`
      SELECT session_id, pid, created_at
      FROM sessions
      ORDER BY created_at ASC
    `).all() as SessionRow[];

    for (const row of sessionRows) {
      grouped.set(row.session_id, {
        sessionId: row.session_id,
        pid: row.pid ?? undefined,
        workerCount: 0,
        providers: [],
        createdAt: new Date(row.created_at),
      });
    }

    for (const terminal of this.listAllTerminals()) {
      const existing = grouped.get(terminal.sessionId);
      if (existing === undefined) {
        grouped.set(terminal.sessionId, {
          sessionId: terminal.sessionId,
          pid: terminal.pid,
          workerCount: 1,
          providers: [terminal.provider],
          createdAt: terminal.createdAt,
        });
        continue;
      }

      existing.workerCount += 1;
      if (!existing.providers.includes(terminal.provider)) {
        existing.providers.push(terminal.provider);
      }
      if (existing.pid === undefined && terminal.pid !== undefined) {
        existing.pid = terminal.pid;
      }
      if (terminal.createdAt < existing.createdAt) {
        existing.createdAt = terminal.createdAt;
      }
    }

    return [...grouped.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  /**
   * Delete all terminals and inbox messages for a session.
   *
   * Runs both deletes in a single transaction for atomicity.
   *
   * @param sessionId Session ID to clean up.
   */
  deleteSession(sessionId: string): void {
    const deleteSessionRecord = this.db.prepare(`
      DELETE FROM sessions WHERE session_id = ?
    `);
    const deleteTerminals = this.db.prepare(`
      DELETE FROM terminals WHERE session_id = ?
    `);
    const _deleteInbox = this.db.prepare(`
      DELETE FROM inbox
      WHERE sender IN (SELECT id FROM terminals WHERE session_id = ?)
         OR receiver IN (SELECT id FROM terminals WHERE session_id = ?)
    `);

    // Use a transaction to ensure atomicity.
    // We need to delete inbox messages first (referencing terminal IDs),
    // but since we query terminals in the inbox delete, we collect IDs first.
    const terminalIds = this.db.prepare(`
      SELECT id FROM terminals WHERE session_id = ?
    `);

    this.db.transaction(() => {
      const ids = terminalIds.all(sessionId) as Array<{ id: string }>;
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        this.db.prepare(`
          DELETE FROM inbox WHERE sender IN (${placeholders}) OR receiver IN (${placeholders})
        `).run(...ids.map((r) => r.id), ...ids.map((r) => r.id));
      }
      deleteTerminals.run(sessionId);
      deleteSessionRecord.run(sessionId);
    })();
  }

  deleteAllSessions(): string[] {
    const sessionIds = this.listSessions().map((session) => session.sessionId);

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM inbox").run();
      this.db.prepare("DELETE FROM terminals").run();
      this.db.prepare("DELETE FROM sessions").run();
    })();

    return sessionIds;
  }

  /**
   * Close the database connection.
   *
   * Should be called during cleanup (e.g. SIGINT/SIGTERM handlers).
   */
  close(): void {
    this.db.close();
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  /** Map a raw SQLite terminal row to a TerminalRecord. */
  private mapTerminalRow(row: TerminalRow): TerminalRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      pid: row.pid ?? undefined,
      provider: row.provider as CliProviderType,
      agentProfile: row.agent_profile ?? undefined,
      status: row.status as TerminalStatus,
      createdAt: new Date(row.created_at),
    };
  }

  /** Map a raw SQLite inbox row to an InboxMessage. */
  private mapInboxRow(row: InboxRow): InboxMessage {
    return {
      id: row.id,
      sender: row.sender,
      receiver: row.receiver,
      content: row.content,
      status: row.status as "pending" | "delivered" | "failed",
      createdAt: new Date(row.created_at),
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
    };
  }
}

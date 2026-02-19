/**
 * SQLite database store — PRD section 17.1
 * Uses better-sqlite3 with WAL mode for concurrent reads.
 * Runs migrations on startup. Provides raw query interface.
 */

import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import { logger } from "../utils/logger.js";
import {
  getDatabasePath,
  getDatabaseDir,
  ensureDirectory,
} from "../utils/pathResolver.js";
import { up as initialMigrationUp } from "./migrations/001-initial.js";

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS _migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
)`;

interface IMigration {
  readonly id: string;
  readonly up: (db: Database.Database) => void;
}

const MIGRATIONS: readonly IMigration[] = [
  { id: "001-initial", up: initialMigrationUp },
] as const;

export class SqliteStore {
  private db: Database.Database | undefined;
  private closed = false;

  get database(): Database.Database {
    if (this.closed || !this.db) {
      throw new Error("SqliteStore is closed or not initialized");
    }
    return this.db;
  }

  open(dbPath?: string): void {
    if (this.db) {
      return;
    }

    const resolvedPath = dbPath ?? getDatabasePath();
    ensureDirectory(getDatabaseDir());

    logger.info({ path: resolvedPath }, "Opening SQLite database");

    this.db = new Database(resolvedPath);

    // WAL mode for concurrent reads (PRD section 17.1)
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");

    // Secure file permissions (PRD section 14.1)
    try {
      chmodSync(resolvedPath, 0o600);
    } catch {
      logger.warn(
        { path: resolvedPath },
        "Could not set database file permissions to 600",
      );
    }

    this.runMigrations();
    this.registerCleanupHandlers();
  }

  private runMigrations(): void {
    const db = this.database;
    db.exec(MIGRATIONS_TABLE_DDL);

    const appliedStmt = db.prepare(
      "SELECT id FROM _migrations WHERE id = ?",
    );

    const insertStmt = db.prepare(
      "INSERT INTO _migrations (id) VALUES (?)",
    );

    for (const migration of MIGRATIONS) {
      const existing = appliedStmt.get(migration.id) as
        | { id: string }
        | undefined;

      if (!existing) {
        logger.info({ migrationId: migration.id }, "Running migration");
        db.transaction(() => {
          migration.up(db);
          insertStmt.run(migration.id);
        })();
        logger.info({ migrationId: migration.id }, "Migration applied");
      }
    }
  }

  prepare(sql: string): Database.Statement {
    return this.database.prepare(sql);
  }

  run(sql: string, ...params: readonly unknown[]): Database.RunResult {
    return this.database.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: readonly unknown[]): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: readonly unknown[]): T[] {
    return this.database.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn)();
  }

  close(): void {
    if (this.closed || !this.db) {
      return;
    }

    logger.info("Closing SQLite database");
    this.closed = true;

    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.close();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Error closing database");
    }

    this.db = undefined;
  }

  private registerCleanupHandlers(): void {
    const cleanup = (): void => {
      this.close();
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });
  }
}

/**
 * Initial database migration — PRD section 17.1
 * Creates all core tables and indexes for AemeathCLI persistence.
 *
 * SAFETY: All DDL is static SQL. No user input is interpolated.
 */

import type Database from "better-sqlite3";

const MIGRATION_ID = "001-initial";

const CREATE_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_root TEXT NOT NULL,
  default_model TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}'
)`;

const CREATE_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  content TEXT NOT NULL,
  tool_calls TEXT,
  token_usage TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const CREATE_FILE_CONTEXT = `
CREATE TABLE IF NOT EXISTS file_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  content_hash TEXT,
  token_count INTEGER,
  added_at TEXT DEFAULT (datetime('now'))
)`;

const CREATE_COST_TRACKING = `
CREATE TABLE IF NOT EXISTS cost_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const CREATE_TEAMS = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  config TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)",
  "CREATE INDEX IF NOT EXISTS idx_cost_conversation ON cost_tracking(conversation_id)",
  "CREATE INDEX IF NOT EXISTS idx_cost_provider ON cost_tracking(provider)",
  "CREATE INDEX IF NOT EXISTS idx_file_context_conversation ON file_context(conversation_id)",
] as const;

const DROP_INDEXES = [
  "DROP INDEX IF EXISTS idx_file_context_conversation",
  "DROP INDEX IF EXISTS idx_cost_provider",
  "DROP INDEX IF EXISTS idx_cost_conversation",
  "DROP INDEX IF EXISTS idx_messages_conversation",
] as const;

const DROP_TABLES = [
  "DROP TABLE IF EXISTS cost_tracking",
  "DROP TABLE IF EXISTS file_context",
  "DROP TABLE IF EXISTS messages",
  "DROP TABLE IF EXISTS teams",
  "DROP TABLE IF EXISTS conversations",
] as const;

export function up(db: Database.Database): void {
  db.transaction(() => {
    db.exec(CREATE_CONVERSATIONS);
    db.exec(CREATE_MESSAGES);
    db.exec(CREATE_FILE_CONTEXT);
    db.exec(CREATE_COST_TRACKING);
    db.exec(CREATE_TEAMS);

    for (const sql of CREATE_INDEXES) {
      db.exec(sql);
    }
  })();
}

export function down(db: Database.Database): void {
  db.transaction(() => {
    for (const sql of DROP_INDEXES) {
      db.exec(sql);
    }
    for (const sql of DROP_TABLES) {
      db.exec(sql);
    }
  })();
}

export { MIGRATION_ID };

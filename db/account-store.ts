import { env } from "cloudflare:workers";

type AccountEnvironment = { DB: D1Database };

export function getAccountEnvironment() {
  return env as unknown as AccountEnvironment;
}

export async function ensureAccountSchema() {
  const { DB } = getAccountEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER DEFAULT 100000 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS account_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions (account_id, expires_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS auth_attempts (
      key TEXT PRIMARY KEY NOT NULL,
      attempts INTEGER DEFAULT 0 NOT NULL,
      window_started_at TEXT NOT NULL,
      locked_until TEXT
    )`),
  ]);
  try {
    await DB.prepare(`ALTER TABLE accounts ADD COLUMN password_iterations INTEGER DEFAULT 210000 NOT NULL`).run();
  } catch {
    // Existing databases already have the per-account work factor column.
  }
}

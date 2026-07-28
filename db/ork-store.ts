import { env } from "cloudflare:workers";

type OrkEnvironment = { DB: D1Database; FILES: R2Bucket };

export function getOrkEnvironment() {
  return env as unknown as OrkEnvironment;
}

export async function ensureOrkSchema() {
  const { DB } = getOrkEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_workspaces (
      project_id TEXT PRIMARY KEY NOT NULL,
      source_name TEXT NOT NULL,
      original_object_key TEXT NOT NULL,
      current_object_key TEXT NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      sha256 TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      updated_by_email TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      field TEXT NOT NULL,
      previous_value TEXT NOT NULL,
      next_value TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ork_changes_project_version_field_unique
      ON ork_changes (project_id, version, component_id, field)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_changes_project_id_idx
      ON ork_changes (project_id, id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      object_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ork_snapshots_project_version_unique
      ON ork_snapshots (project_id, version)`),
  ]);
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

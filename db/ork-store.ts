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
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_change_proposals (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      base_version INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      summary TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      changed_components INTEGER NOT NULL,
      geometry_changes INTEGER DEFAULT 0 NOT NULL,
      submitted_by_name TEXT NOT NULL,
      submitted_by_email TEXT NOT NULL,
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      reviewed_by_name TEXT,
      reviewed_by_email TEXT,
      reviewed_at TEXT,
      review_notes TEXT,
      applied_version INTEGER
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_change_proposals_project_idx
      ON ork_change_proposals (project_id, submitted_at)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_change_proposals_status_idx
      ON ork_change_proposals (project_id, status)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_change_proposal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      proposal_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      component_name TEXT NOT NULL,
      component_kind TEXT NOT NULL,
      change_type TEXT NOT NULL,
      geometry_changed INTEGER DEFAULT 0 NOT NULL,
      changes_json TEXT NOT NULL,
      rationale TEXT NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_change_proposal_items_proposal_idx
      ON ork_change_proposal_items (proposal_id, id)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_change_proposal_items_component_idx
      ON ork_change_proposal_items (project_id, component_id)`),
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
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_release_requests (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      working_version INTEGER NOT NULL,
      title TEXT NOT NULL,
      notes TEXT DEFAULT '' NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      object_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_by_email TEXT NOT NULL,
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      reviewed_by_name TEXT,
      reviewed_by_email TEXT,
      reviewed_at TEXT,
      release_number INTEGER
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_release_requests_project_idx
      ON ork_release_requests (project_id, requested_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS ork_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      release_number INTEGER NOT NULL,
      working_version INTEGER NOT NULL,
      title TEXT NOT NULL,
      notes TEXT DEFAULT '' NOT NULL,
      object_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ork_releases_project_number_unique
      ON ork_releases (project_id, release_number)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ork_releases_project_idx
      ON ork_releases (project_id, created_at)`),
  ]);
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

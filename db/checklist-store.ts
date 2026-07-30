import { env } from "cloudflare:workers";

type ChecklistEnvironment = { DB: D1Database };

export function getChecklistEnvironment() {
  return env as unknown as ChecklistEnvironment;
}

export async function ensureChecklistSchema() {
  const { DB } = getChecklistEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS launch_checklists (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      mission TEXT DEFAULT '' NOT NULL,
      launch_site TEXT DEFAULT '' NOT NULL,
      scheduled_for TEXT,
      status TEXT DEFAULT 'draft' NOT NULL,
      revision INTEGER DEFAULT 1 NOT NULL,
      baseline_release_number INTEGER,
      definition_json TEXT DEFAULT '{"sections":[]}' NOT NULL,
      created_by_name TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      updated_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      released_by_name TEXT,
      released_by_email TEXT,
      released_at TEXT
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS launch_checklists_project_idx ON launch_checklists (project_id, updated_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS checklist_custom_parts (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'Ground support equipment' NOT NULL,
      description TEXT DEFAULT '' NOT NULL,
      created_by_name TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS checklist_custom_parts_project_code_unique ON checklist_custom_parts (project_id, code)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS checklist_custom_parts_project_idx ON checklist_custom_parts (project_id, name)`),
  ]);
}

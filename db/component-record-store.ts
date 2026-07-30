import { env } from "cloudflare:workers";

type ComponentRecordEnvironment = { DB: D1Database; FILES: R2Bucket };

export function getComponentRecordEnvironment() {
  return env as unknown as ComponentRecordEnvironment;
}

export async function ensureComponentRecordSchema() {
  const { DB } = getComponentRecordEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS component_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      revision TEXT DEFAULT 'A' NOT NULL,
      status TEXT DEFAULT 'current' NOT NULL,
      file_name TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      ork_version INTEGER,
      supersedes_id INTEGER,
      uploaded_by_name TEXT NOT NULL,
      uploaded_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS component_artifacts_component_idx
      ON component_artifacts (project_id, component_id, id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS component_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      title TEXT NOT NULL,
      requirement TEXT NOT NULL,
      status TEXT DEFAULT 'required' NOT NULL,
      owner_name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      completion_notes TEXT,
      completed_by_name TEXT,
      completed_by_email TEXT,
      completed_at TEXT,
      evidence_artifact_id INTEGER,
      ork_version INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS component_tests_component_idx
      ON component_tests (project_id, component_id, id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS component_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      body TEXT NOT NULL,
      mentions_json TEXT DEFAULT '[]' NOT NULL,
      ork_version INTEGER,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS component_comments_component_idx
      ON component_comments (project_id, component_id, id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS component_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      comment_id INTEGER NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      body_excerpt TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS component_mentions_comment_recipient_unique
      ON component_mentions (comment_id, recipient_email)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS component_mentions_recipient_idx
      ON component_mentions (project_id, recipient_email, read_at, id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS component_record_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      project_id TEXT NOT NULL,
      component_id TEXT NOT NULL,
      component_code TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL,
      ork_version INTEGER,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS component_record_events_component_idx
      ON component_record_events (project_id, component_id, id)`),
  ]);
}

import { env } from "cloudflare:workers";

export type TeamRole = "lead" | "engineer" | "viewer";
export type Permission = "view" | "editOrk" | "uploadEvidence" | "createTest" | "completeTest" | "comment" | "createRevision" | "manageTeam" | "manageProjects";

export const ROLE_PERMISSIONS: Record<TeamRole, Permission[]> = {
  lead: ["view", "editOrk", "uploadEvidence", "createTest", "completeTest", "comment", "createRevision", "manageTeam", "manageProjects"],
  engineer: ["view", "editOrk", "uploadEvidence", "completeTest", "comment", "createRevision"],
  viewer: ["view"],
};

export const STORAGE_LIMITS = {
  maxOrkBytes: 25 * 1024 * 1024,
  maxArtifactBytes: 24 * 1024 * 1024,
  maxProjectBytes: 2 * 1024 * 1024 * 1024,
} as const;

export async function reserveProjectStorage(projectId: string, bytes: number, files = 1) {
  const { DB } = getAccessEnvironment();
  const result = await DB.prepare(`UPDATE projects
    SET storage_bytes = storage_bytes + ?, file_count = file_count + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND storage_bytes + ? <= ?`)
    .bind(bytes, files, projectId, bytes, STORAGE_LIMITS.maxProjectBytes).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function releaseProjectStorage(projectId: string, bytes: number, files = 1) {
  const { DB } = getAccessEnvironment();
  await DB.prepare(`UPDATE projects SET
    storage_bytes = max(0, storage_bytes - ?), file_count = max(0, file_count - ?), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).bind(bytes, files, projectId).run();
}

type AccessEnvironment = { DB: D1Database; FILES: R2Bucket };

export function getAccessEnvironment() {
  return env as unknown as AccessEnvironment;
}

export function safeSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "workspace";
}

export async function ensureAccessSchema() {
  const { DB } = getAccessEnvironment();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      team_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'engineer' NOT NULL,
      status TEXT DEFAULT 'invited' NOT NULL,
      project_scope TEXT DEFAULT 'all' NOT NULL,
      invited_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_email_unique ON team_members (team_id, email)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS team_members_email_idx ON team_members (email, team_id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS team_invite_codes (
      id TEXT PRIMARY KEY NOT NULL,
      team_id TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      code_hint TEXT NOT NULL,
      role TEXT DEFAULT 'viewer' NOT NULL,
      max_uses INTEGER DEFAULT 1 NOT NULL,
      use_count INTEGER DEFAULT 0 NOT NULL,
      expires_at TEXT NOT NULL,
      active INTEGER DEFAULT 1 NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS team_invite_codes_team_idx ON team_invite_codes (team_id, created_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS invite_code_projects (
      invite_code_id TEXT NOT NULL,
      project_id TEXT NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS invite_code_projects_unique ON invite_code_projects (invite_code_id, project_id)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS invite_code_projects_project_idx ON invite_code_projects (project_id, invite_code_id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS member_project_access (
      team_id TEXT NOT NULL,
      member_email TEXT NOT NULL,
      project_id TEXT NOT NULL,
      granted_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS member_project_access_unique ON member_project_access (team_id, member_email, project_id)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS member_project_access_project_idx ON member_project_access (project_id, member_email)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT DEFAULT '' NOT NULL,
      storage_bytes INTEGER DEFAULT 0 NOT NULL,
      file_count INTEGER DEFAULT 0 NOT NULL,
      created_by_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS projects_team_slug_unique ON projects (team_id, slug)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS projects_team_idx ON projects (team_id, id)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS team_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      team_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS team_events_team_id_idx ON team_events (team_id, id)`),
  ]);
  try {
    await DB.prepare(`ALTER TABLE team_members ADD COLUMN project_scope TEXT DEFAULT 'all' NOT NULL`).run();
  } catch {
    // Existing databases already have the column after the first migration or schema check.
  }
}

export function hasPermission(role: TeamRole, permission: Permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

import { ensureAccessSchema, getAccessEnvironment, hasPermission, Permission, ROLE_PERMISSIONS, TeamRole } from "../../db/access-store";
import { getRequestUser, RequestUser } from "./request-user";

export type ProjectAccess = {
  user: RequestUser;
  team: { id: string; name: string; slug: string };
  project: { id: string; teamId: string; name: string; slug: string; storageBytes: number; fileCount: number };
  role: TeamRole;
  permissions: Permission[];
};

type AccessRow = {
  team_id: string;
  team_name: string;
  team_slug: string;
  project_id: string;
  project_name: string;
  project_slug: string;
  storage_bytes: number;
  file_count: number;
  role: TeamRole;
};

function requestedProjectId(request: Request) {
  const url = new URL(request.url);
  return request.headers.get("x-project-id")?.trim() || url.searchParams.get("projectId")?.trim() || "";
}

export async function ensureLocalPreviewWorkspace(user: RequestUser) {
  if (!user.preview) return;
  const { DB } = getAccessEnvironment();
  const role = user.previewRole ?? "lead";
  await DB.batch([
    DB.prepare(`INSERT OR IGNORE INTO teams (id, name, slug, created_by_email) VALUES ('team-qpl', 'QPL', 'qpl', ?)`)
      .bind(user.email),
    DB.prepare(`INSERT OR IGNORE INTO projects (id, team_id, name, slug, description, created_by_email)
      VALUES ('banshee-mk2', 'team-qpl', 'Banshee Mk II', 'banshee-mk2', 'QPL launch vehicle configuration', ?)`)
      .bind(user.email),
    DB.prepare(`INSERT INTO team_members (team_id, email, display_name, role, status, invited_by_email)
      VALUES ('team-qpl', ?, ?, ?, 'active', ?)
      ON CONFLICT(team_id, email) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, status = 'active', updated_at = CURRENT_TIMESTAMP`)
      .bind(user.email.toLowerCase(), user.displayName, role, user.email),
  ]);
}

export async function requireProjectAccess(request: Request, permission: Permission): Promise<
  { ok: true; access: ProjectAccess } | { ok: false; response: Response }
> {
  const user = await getRequestUser(request);
  if (!user) return { ok: false, response: Response.json({ error: "Sign in is required." }, { status: 401 }) };
  await ensureAccessSchema();
  await ensureLocalPreviewWorkspace(user);
  const { DB } = getAccessEnvironment();
  const projectId = requestedProjectId(request);
  const projectFilter = projectId ? "AND p.id = ?" : "";
  const statement = DB.prepare(`SELECT
      t.id AS team_id, t.name AS team_name, t.slug AS team_slug,
      p.id AS project_id, p.name AS project_name, p.slug AS project_slug,
      p.storage_bytes, p.file_count, m.role
    FROM team_members m
    JOIN teams t ON t.id = m.team_id
    JOIN projects p ON p.team_id = t.id
    WHERE lower(m.email) = lower(?) AND m.status IN ('active', 'invited') ${projectFilter}
    ORDER BY CASE m.role WHEN 'lead' THEN 0 WHEN 'engineer' THEN 1 ELSE 2 END, p.created_at
    LIMIT 1`);
  const row = projectId
    ? await statement.bind(user.email, projectId).first<AccessRow>()
    : await statement.bind(user.email).first<AccessRow>();
  if (!row) return { ok: false, response: Response.json({ error: projectId ? "You do not have access to this project." : "No team workspace is assigned to this account.", code: "NO_WORKSPACE" }, { status: 403 }) };
  const role = row.role === "lead" || row.role === "viewer" ? row.role : "engineer";
  if (!hasPermission(role, permission)) {
    return { ok: false, response: Response.json({ error: `Your ${role} role cannot perform this action.`, code: "FORBIDDEN" }, { status: 403 }) };
  }
  if (!user.preview) {
    await DB.prepare(`UPDATE team_members SET status = 'active', display_name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE team_id = ? AND lower(email) = lower(?)`).bind(user.displayName, row.team_id, user.email).run();
  }
  return {
    ok: true,
    access: {
      user,
      team: { id: row.team_id, name: row.team_name, slug: row.team_slug },
      project: { id: row.project_id, teamId: row.team_id, name: row.project_name, slug: row.project_slug, storageBytes: row.storage_bytes, fileCount: row.file_count },
      role,
      permissions: ROLE_PERMISSIONS[role],
    },
  };
}

import { ensureAccessSchema, getAccessEnvironment, ROLE_PERMISSIONS, safeSlug, TeamRole } from "../../../db/access-store";
import { ensureLocalPreviewWorkspace, requireProjectAccess } from "../access";
import { getRequestUser } from "../request-user";

type MembershipRow = {
  team_id: string;
  team_name: string;
  team_slug: string;
  role: TeamRole;
  status: string;
};

type ProjectRow = {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  description: string;
  storage_bytes: number;
  file_count: number;
};

type MemberRow = {
  id: number;
  team_id: string;
  email: string;
  display_name: string;
  role: TeamRole;
  status: string;
};

type TeamEventRow = { id: number; team_id: string; action: string; summary: string; actor_name: string; created_at: string };

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function validRole(value: unknown): TeamRole {
  return value === "lead" || value === "viewer" ? value : "engineer";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function recordTeamEvent(DB: D1Database, input: { teamId: string; action: string; targetType: string; targetId: string; summary: string; actorName: string; actorEmail: string }) {
  await DB.prepare(`INSERT INTO team_events (team_id, action, target_type, target_id, summary, actor_name, actor_email)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.teamId, input.action, input.targetType, input.targetId, input.summary, input.actorName, input.actorEmail).run();
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ authenticated: false, signInPath: "/signin-with-chatgpt?return_to=%2F" });
  await ensureAccessSchema();
  await ensureLocalPreviewWorkspace(user);
  const { DB } = getAccessEnvironment();
  const [membershipRows, projectRows, memberRows, eventRows] = await Promise.all([
    DB.prepare(`SELECT t.id AS team_id, t.name AS team_name, t.slug AS team_slug, m.role, m.status
      FROM team_members m JOIN teams t ON t.id = m.team_id
      WHERE lower(m.email) = lower(?) AND m.status IN ('active', 'invited')
      ORDER BY t.name`).bind(user.email).all<MembershipRow>(),
    DB.prepare(`SELECT p.* FROM projects p JOIN team_members m ON m.team_id = p.team_id
      WHERE lower(m.email) = lower(?) AND m.status IN ('active', 'invited') ORDER BY p.created_at`)
      .bind(user.email).all<ProjectRow>(),
    DB.prepare(`SELECT tm.id, tm.team_id, tm.email, tm.display_name, tm.role, tm.status
      FROM team_members tm WHERE tm.team_id IN (
        SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND status IN ('active', 'invited')
      ) ORDER BY tm.display_name, tm.email`).bind(user.email).all<MemberRow>(),
    DB.prepare(`SELECT te.id, te.team_id, te.action, te.summary, te.actor_name, te.created_at
      FROM team_events te WHERE te.team_id IN (
        SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND status IN ('active', 'invited')
      ) ORDER BY te.id DESC LIMIT 80`).bind(user.email).all<TeamEventRow>(),
  ]);
  const teams = membershipRows.results.map((membership) => {
    const role = validRole(membership.role);
    return {
      id: membership.team_id,
      name: membership.team_name,
      slug: membership.team_slug,
      role,
      status: membership.status,
      permissions: ROLE_PERMISSIONS[role],
      projects: projectRows.results.filter((project) => project.team_id === membership.team_id).map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        storageBytes: project.storage_bytes,
        fileCount: project.file_count,
      })),
      members: memberRows.results.filter((member) => member.team_id === membership.team_id).map((member) => ({
        id: member.id,
        email: member.email,
        displayName: member.display_name,
        role: validRole(member.role),
        status: member.status,
      })),
      events: eventRows.results.filter((event) => event.team_id === membership.team_id).slice(0, 20).map((event) => ({
        id: event.id, action: event.action, summary: event.summary, actorName: event.actor_name, createdAt: event.created_at,
      })),
    };
  });
  return Response.json({
    authenticated: true,
    preview: user.preview,
    user: { name: user.displayName, email: user.email },
    teams,
    limits: { maxOrkBytes: 25 * 1024 * 1024, maxArtifactBytes: 24 * 1024 * 1024, recommendedProjectBytes: 2 * 1024 * 1024 * 1024 },
  });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  await ensureAccessSchema();
  await ensureLocalPreviewWorkspace(user);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch {
    return Response.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const action = clean(body.action, 40);
  const { DB } = getAccessEnvironment();

  if (action === "create-team") {
    const teamName = clean(body.teamName, 80);
    const projectName = clean(body.projectName, 100);
    if (!teamName || !projectName) return Response.json({ error: "Team and first project names are required." }, { status: 400 });
    const teamId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const teamSlug = `${safeSlug(teamName)}-${teamId.slice(0, 6)}`;
    const projectSlug = safeSlug(projectName);
    await DB.batch([
      DB.prepare(`INSERT INTO teams (id, name, slug, created_by_email) VALUES (?, ?, ?, ?)`)
        .bind(teamId, teamName, teamSlug, user.email),
      DB.prepare(`INSERT INTO team_members (team_id, email, display_name, role, status, invited_by_email)
        VALUES (?, ?, ?, 'lead', 'active', ?)`)
        .bind(teamId, user.email.toLowerCase(), user.displayName, user.email),
      DB.prepare(`INSERT INTO projects (id, team_id, name, slug, description, created_by_email)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(projectId, teamId, projectName, projectSlug, `${teamName} engineering workspace`, user.email),
    ]);
    await recordTeamEvent(DB, { teamId, action: "created", targetType: "team", targetId: teamId, summary: `Created team and first project ${projectName}`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ teamId, projectId }, { status: 201 });
  }

  const permission = action === "create-project" ? "manageProjects" : "manageTeam";
  const result = await requireProjectAccess(request, permission);
  if (!result.ok) return result.response;
  const { access } = result;

  if (action === "create-project") {
    const name = clean(body.name, 100);
    if (!name) return Response.json({ error: "Project name is required." }, { status: 400 });
    const id = crypto.randomUUID();
    const slug = `${safeSlug(name)}-${id.slice(0, 6)}`;
    await DB.prepare(`INSERT INTO projects (id, team_id, name, slug, description, created_by_email)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, access.team.id, name, slug, clean(body.description, 500), user.email).run();
    await recordTeamEvent(DB, { teamId: access.team.id, action: "created", targetType: "project", targetId: id, summary: `Created project ${name}`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ projectId: id }, { status: 201 });
  }

  if (action === "invite-member") {
    const email = clean(body.email, 180).toLowerCase();
    const displayName = clean(body.displayName, 100) || email.split("@")[0];
    const role = validRole(body.role);
    if (!validEmail(email)) return Response.json({ error: "Enter a valid member email address." }, { status: 400 });
    await DB.prepare(`INSERT INTO team_members (team_id, email, display_name, role, status, invited_by_email)
      VALUES (?, ?, ?, ?, 'invited', ?)
      ON CONFLICT(team_id, email) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, updated_at = CURRENT_TIMESTAMP`)
      .bind(access.team.id, email, displayName, role, user.email).run();
    await recordTeamEvent(DB, { teamId: access.team.id, action: "invited", targetType: "member", targetId: email, summary: `Invited ${displayName} as ${role}`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ invited: true }, { status: 201 });
  }

  if (action === "change-role") {
    const memberId = Number(body.memberId);
    const role = validRole(body.role);
    const member = await DB.prepare(`SELECT id, email, role FROM team_members WHERE team_id = ? AND id = ?`)
      .bind(access.team.id, memberId).first<{ id: number; email: string; role: TeamRole }>();
    if (!member) return Response.json({ error: "Member not found." }, { status: 404 });
    if (member.role === "lead" && role !== "lead") {
      const count = await DB.prepare(`SELECT count(*) AS total FROM team_members WHERE team_id = ? AND role = 'lead' AND status = 'active'`)
        .bind(access.team.id).first<{ total: number }>();
      if ((count?.total ?? 0) <= 1) return Response.json({ error: "A team must retain at least one active lead." }, { status: 409 });
    }
    await DB.prepare(`UPDATE team_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE team_id = ? AND id = ?`)
      .bind(role, access.team.id, memberId).run();
    await recordTeamEvent(DB, { teamId: access.team.id, action: "role.changed", targetType: "member", targetId: String(memberId), summary: `Changed ${member.email} from ${member.role} to ${role}`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ updated: true });
  }

  return Response.json({ error: "Unsupported team action." }, { status: 400 });
}

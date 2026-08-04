import { ensureAccessSchema, getAccessEnvironment, ROLE_PERMISSIONS, safeSlug, TeamRole } from "../../../db/access-store";
import { ensureLocalPreviewWorkspace, requireProjectAccess } from "../access";
import { getRequestUser } from "../request-user";
import { sha256 } from "../../account-auth";

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
  project_scope: string;
};

type MemberProjectRow = { team_id: string; member_email: string; project_id: string };
type InviteCodeRow = { id: string; team_id: string; code_hint: string; role: TeamRole; max_uses: number; use_count: number; expires_at: string; active: number; created_at: string };
type InviteProjectRow = { invite_code_id: string; project_id: string };

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

function generatedTeamCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `RC-${body.slice(0, 4)}-${body.slice(4)}`;
}

async function recordTeamEvent(DB: D1Database, input: { teamId: string; action: string; targetType: string; targetId: string; summary: string; actorName: string; actorEmail: string }) {
  await DB.prepare(`INSERT INTO team_events (team_id, action, target_type, target_id, summary, actor_name, actor_email)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.teamId, input.action, input.targetType, input.targetId, input.summary, input.actorName, input.actorEmail).run();
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ authenticated: false, signInPath: "/" });
  await ensureAccessSchema();
  await ensureLocalPreviewWorkspace(user);
  const { DB } = getAccessEnvironment();
  const [membershipRows, projectRows, memberRows, memberProjectRows, inviteRows, inviteProjectRows, eventRows] = await Promise.all([
    DB.prepare(`SELECT t.id AS team_id, t.name AS team_name, t.slug AS team_slug, m.role, m.status
      FROM team_members m JOIN teams t ON t.id = m.team_id
      WHERE lower(m.email) = lower(?) AND m.status IN ('active', 'invited')
      ORDER BY t.name`).bind(user.email).all<MembershipRow>(),
    DB.prepare(`SELECT p.* FROM projects p JOIN team_members m ON m.team_id = p.team_id
      WHERE lower(m.email) = lower(?) AND m.status IN ('active', 'invited') AND (
        m.role = 'lead' OR m.project_scope = 'all' OR EXISTS (
          SELECT 1 FROM member_project_access mpa
          WHERE mpa.team_id = m.team_id AND lower(mpa.member_email) = lower(m.email) AND mpa.project_id = p.id
        )
      ) ORDER BY p.created_at`)
      .bind(user.email).all<ProjectRow>(),
    DB.prepare(`SELECT tm.id, tm.team_id, tm.email, tm.display_name, tm.role, tm.status, tm.project_scope
      FROM team_members tm WHERE tm.team_id IN (
        SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND status IN ('active', 'invited')
      ) ORDER BY tm.display_name, tm.email`).bind(user.email).all<MemberRow>(),
    DB.prepare(`SELECT mpa.team_id, mpa.member_email, mpa.project_id FROM member_project_access mpa
      WHERE mpa.team_id IN (SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND status IN ('active', 'invited'))`)
      .bind(user.email).all<MemberProjectRow>(),
    DB.prepare(`SELECT c.id, c.team_id, c.code_hint, c.role, c.max_uses, c.use_count, c.expires_at, c.active, c.created_at
      FROM team_invite_codes c WHERE c.team_id IN (
        SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND role = 'lead' AND status = 'active'
      ) ORDER BY c.created_at DESC LIMIT 50`).bind(user.email).all<InviteCodeRow>(),
    DB.prepare(`SELECT icp.invite_code_id, icp.project_id FROM invite_code_projects icp
      WHERE icp.invite_code_id IN (SELECT id FROM team_invite_codes WHERE team_id IN (
        SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND role = 'lead' AND status = 'active'
      ))`).bind(user.email).all<InviteProjectRow>(),
    DB.prepare(`SELECT te.id, te.team_id, te.action, te.summary, te.actor_name, te.created_at
      FROM team_events te WHERE te.team_id IN (
        SELECT team_id FROM team_members WHERE lower(email) = lower(?) AND status IN ('active', 'invited')
      ) ORDER BY te.id DESC LIMIT 80`).bind(user.email).all<TeamEventRow>(),
  ]);
  const teams = membershipRows.results.map((membership: MembershipRow) => {
    const role = validRole(membership.role);
    return {
      id: membership.team_id,
      name: membership.team_name,
      slug: membership.team_slug,
      role,
      status: membership.status,
      permissions: ROLE_PERMISSIONS[role],
      projects: projectRows.results.filter((project: ProjectRow) => project.team_id === membership.team_id).map((project: ProjectRow) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        storageBytes: project.storage_bytes,
        fileCount: project.file_count,
      })),
      members: memberRows.results.filter((member: MemberRow) => member.team_id === membership.team_id).map((member: MemberRow) => ({
        id: member.id,
        email: member.email,
        displayName: member.display_name,
        role: validRole(member.role),
        status: member.status,
        projectScope: member.project_scope === "selected" ? "selected" : "all",
        projectIds: member.role === "lead" || member.project_scope !== "selected"
          ? projectRows.results.filter((project: ProjectRow) => project.team_id === membership.team_id).map((project: ProjectRow) => project.id)
          : memberProjectRows.results.filter((access: MemberProjectRow) => access.team_id === membership.team_id && access.member_email.toLowerCase() === member.email.toLowerCase()).map((access: MemberProjectRow) => access.project_id),
      })),
      inviteCodes: role === "lead" ? inviteRows.results.filter((invite: InviteCodeRow) => invite.team_id === membership.team_id).map((invite: InviteCodeRow) => ({
        id: invite.id,
        codeHint: invite.code_hint,
        role: validRole(invite.role),
        maxUses: invite.max_uses,
        useCount: invite.use_count,
        expiresAt: invite.expires_at,
        active: Boolean(invite.active),
        createdAt: invite.created_at,
        projectIds: inviteProjectRows.results.filter((item: InviteProjectRow) => item.invite_code_id === invite.id).map((item: InviteProjectRow) => item.project_id),
      })) : [],
      events: eventRows.results.filter((event: TeamEventRow) => event.team_id === membership.team_id).slice(0, 20).map((event: TeamEventRow) => ({
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

  if (action === "create-team-code") {
    const role = body.role === "engineer" ? "engineer" : "viewer";
    const projectIds = Array.from(new Set(Array.isArray(body.projectIds) ? body.projectIds.map((value) => clean(value, 80)).filter(Boolean) : []));
    const maxUses = Math.max(1, Math.min(100, Math.round(Number(body.maxUses) || 1)));
    const expiryDays = Math.max(1, Math.min(90, Math.round(Number(body.expiryDays) || 14)));
    if (!projectIds.length) return Response.json({ error: "Select at least one rocket for this code." }, { status: 400 });
    const validProjects = await DB.prepare(`SELECT id FROM projects WHERE team_id = ? AND id IN (${projectIds.map(() => "?").join(",")})`)
      .bind(access.team.id, ...projectIds).all<{ id: string }>();
    if (validProjects.results.length !== projectIds.length) return Response.json({ error: "One or more selected rockets do not belong to this team." }, { status: 400 });
    const code = generatedTeamCode();
    const codeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString();
    await DB.batch([
      DB.prepare(`INSERT INTO team_invite_codes (id, team_id, code_hash, code_hint, role, max_uses, expires_at, created_by_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(codeId, access.team.id, await sha256(code.replace(/[^A-Z0-9]/g, "")), `••••-${code.slice(-4)}`, role, maxUses, expiresAt, user.email),
      ...projectIds.map((projectId) => DB.prepare(`INSERT INTO invite_code_projects (invite_code_id, project_id) VALUES (?, ?)`).bind(codeId, projectId)),
    ]);
    await recordTeamEvent(DB, { teamId: access.team.id, action: "code.created", targetType: "invite-code", targetId: codeId, summary: `Created ${role} team code for ${projectIds.length} rocket${projectIds.length === 1 ? "" : "s"}`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ code, codeId, role, projectIds, maxUses, expiresAt }, { status: 201 });
  }

  if (action === "revoke-team-code") {
    const codeId = clean(body.codeId, 80);
    const result = await DB.prepare(`UPDATE team_invite_codes SET active = 0 WHERE id = ? AND team_id = ?`).bind(codeId, access.team.id).run();
    if ((result.meta.changes ?? 0) !== 1) return Response.json({ error: "Team code not found." }, { status: 404 });
    await recordTeamEvent(DB, { teamId: access.team.id, action: "code.revoked", targetType: "invite-code", targetId: codeId, summary: "Revoked a team code", actorName: user.displayName, actorEmail: user.email });
    return Response.json({ revoked: true });
  }

  if (action === "update-member-projects") {
    const memberId = Number(body.memberId);
    const projectIds = Array.from(new Set(Array.isArray(body.projectIds) ? body.projectIds.map((value) => clean(value, 80)).filter(Boolean) : []));
    if (!projectIds.length) return Response.json({ error: "Assign at least one rocket to this member." }, { status: 400 });
    const member = await DB.prepare(`SELECT id, email, role FROM team_members WHERE team_id = ? AND id = ?`).bind(access.team.id, memberId).first<{ id: number; email: string; role: TeamRole }>();
    if (!member) return Response.json({ error: "Member not found." }, { status: 404 });
    if (member.role === "lead") return Response.json({ error: "Team leads always have access to every rocket." }, { status: 409 });
    const validProjects = await DB.prepare(`SELECT id FROM projects WHERE team_id = ? AND id IN (${projectIds.map(() => "?").join(",")})`)
      .bind(access.team.id, ...projectIds).all<{ id: string }>();
    if (validProjects.results.length !== projectIds.length) return Response.json({ error: "One or more selected rockets do not belong to this team." }, { status: 400 });
    await DB.batch([
      DB.prepare(`UPDATE team_members SET project_scope = 'selected', updated_at = CURRENT_TIMESTAMP WHERE team_id = ? AND id = ?`).bind(access.team.id, memberId),
      DB.prepare(`DELETE FROM member_project_access WHERE team_id = ? AND lower(member_email) = lower(?)`).bind(access.team.id, member.email),
      ...projectIds.map((projectId) => DB.prepare(`INSERT INTO member_project_access (team_id, member_email, project_id, granted_by_email) VALUES (?, ?, ?, ?)`)
        .bind(access.team.id, member.email.toLowerCase(), projectId, user.email)),
    ]);
    await recordTeamEvent(DB, { teamId: access.team.id, action: "access.changed", targetType: "member", targetId: String(memberId), summary: `Assigned ${member.email} to ${projectIds.length} rocket${projectIds.length === 1 ? "" : "s"}`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ updated: true });
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

  if (action === "remove-member") {
    const memberId = Number(body.memberId);
    const member = await DB.prepare(`SELECT id, email, display_name, role FROM team_members WHERE team_id = ? AND id = ?`)
      .bind(access.team.id, memberId).first<{ id: number; email: string; display_name: string; role: TeamRole }>();
    if (!member) return Response.json({ error: "Member not found." }, { status: 404 });
    if (member.email.toLowerCase() === user.email.toLowerCase()) return Response.json({ error: "You cannot remove your own active account." }, { status: 409 });
    if (member.role === "lead") {
      const count = await DB.prepare(`SELECT count(*) AS total FROM team_members WHERE team_id = ? AND role = 'lead' AND status = 'active'`)
        .bind(access.team.id).first<{ total: number }>();
      if ((count?.total ?? 0) <= 1) return Response.json({ error: "A team must retain at least one active lead." }, { status: 409 });
    }
    await DB.batch([
      DB.prepare(`DELETE FROM member_project_access WHERE team_id = ? AND lower(member_email) = lower(?)`).bind(access.team.id, member.email),
      DB.prepare(`DELETE FROM team_members WHERE team_id = ? AND id = ?`).bind(access.team.id, memberId),
    ]);
    await recordTeamEvent(DB, { teamId: access.team.id, action: "member.removed", targetType: "member", targetId: String(memberId), summary: `Removed ${member.display_name} (${member.email}) from the team`, actorName: user.displayName, actorEmail: user.email });
    return Response.json({ removed: true });
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

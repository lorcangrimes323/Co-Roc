import { ensureOrkSchema, getOrkEnvironment } from "../../../db/ork-store";
import { requireProjectAccess } from "../access";

type ReleaseAction = "request" | "release" | "approve" | "reject" | "restore";

async function releaseState(projectId: string) {
  const { DB } = getOrkEnvironment();
  const [releaseRows, requestRows] = await Promise.all([
    DB.prepare(`SELECT id, release_number AS releaseNumber, working_version AS workingVersion,
      title, notes, sha256, created_by_name AS createdByName, created_by_email AS createdByEmail,
      created_at AS createdAt FROM ork_releases WHERE project_id = ? ORDER BY release_number DESC`).bind(projectId).all(),
    DB.prepare(`SELECT id, working_version AS workingVersion, title, notes, status,
      requested_by_name AS requestedByName, requested_by_email AS requestedByEmail,
      requested_at AS requestedAt, reviewed_by_name AS reviewedByName,
      reviewed_at AS reviewedAt, release_number AS releaseNumber
      FROM ork_release_requests WHERE project_id = ? ORDER BY requested_at DESC LIMIT 50`).bind(projectId).all(),
  ]);
  return { releases: releaseRows.results, requests: requestRows.results };
}

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  await ensureOrkSchema();
  return Response.json(await releaseState(result.access.project.id));
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: ReleaseAction; title?: string; notes?: string; requestId?: string; releaseNumber?: number };
  const action = body.action;
  const permission = action === "request" ? "requestRelease" : "approveRelease";
  const result = await requireProjectAccess(request, permission);
  if (!result.ok) return result.response;
  if (!action) return Response.json({ error: "A version action is required." }, { status: 400 });

  await ensureOrkSchema();
  const { DB } = getOrkEnvironment();
  const { project, user } = result.access;
  const workspace = await DB.prepare(`SELECT version, current_object_key AS objectKey, sha256 FROM ork_workspaces WHERE project_id = ?`)
    .bind(project.id).first<{ version: number; objectKey: string; sha256: string }>();
  if (!workspace) return Response.json({ error: "Import an .ork file before creating a controlled version." }, { status: 409 });

  if (action === "request") {
    const existing = await DB.prepare(`SELECT id FROM ork_release_requests WHERE project_id = ? AND working_version = ? AND status = 'pending'`)
      .bind(project.id, workspace.version).first<{ id: string }>();
    if (existing) return Response.json({ error: "This working update is already awaiting approval." }, { status: 409 });
    const id = crypto.randomUUID();
    await DB.prepare(`INSERT INTO ork_release_requests
      (id, project_id, working_version, title, notes, object_key, sha256, requested_by_name, requested_by_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, project.id, workspace.version, body.title?.trim() || `Working update W${workspace.version}`, body.notes?.trim() || "", workspace.objectKey, workspace.sha256, user.displayName, user.email).run();
    return Response.json({ ...(await releaseState(project.id)), requestId: id }, { status: 201 });
  }

  if (action === "reject") {
    if (!body.requestId) return Response.json({ error: "Select a version request." }, { status: 400 });
    await DB.prepare(`UPDATE ork_release_requests SET status = 'rejected', reviewed_by_name = ?, reviewed_by_email = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'pending'`).bind(user.displayName, user.email, body.requestId, project.id).run();
    return Response.json(await releaseState(project.id));
  }

  if (action === "restore") {
    const releaseNumber = Number(body.releaseNumber);
    const release = await DB.prepare(`SELECT release_number AS releaseNumber, working_version AS workingVersion, object_key AS objectKey, sha256
      FROM ork_releases WHERE project_id = ? AND release_number = ?`).bind(project.id, releaseNumber).first<{ releaseNumber: number; workingVersion: number; objectKey: string; sha256: string }>();
    if (!release) return Response.json({ error: "That controlled version does not exist." }, { status: 404 });
    const nextWorking = workspace.version + 1;
    await DB.batch([
      DB.prepare(`UPDATE ork_workspaces SET current_object_key = ?, sha256 = ?, version = ?, updated_by_name = ?, updated_by_email = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`)
        .bind(release.objectKey, release.sha256, nextWorking, user.displayName, user.email, project.id),
      DB.prepare(`INSERT INTO ork_changes (project_id, version, component_id, component_code, field, previous_value, next_value, author_name, author_email)
        VALUES (?, ?, 'vehicle', 'PROJECT', 'release.restored', ?, ?, ?, ?)`)
        .bind(project.id, nextWorking, `W${workspace.version}`, `V${release.releaseNumber}`, user.displayName, user.email),
    ]);
    return Response.json({ ...(await releaseState(project.id)), restoredVersion: nextWorking });
  }

  let pinned = workspace;
  let requestId: string | null = null;
  if (action === "approve") {
    if (!body.requestId) return Response.json({ error: "Select a version request." }, { status: 400 });
    const requested = await DB.prepare(`SELECT id, working_version AS version, title, notes, object_key AS objectKey, sha256
      FROM ork_release_requests WHERE id = ? AND project_id = ? AND status = 'pending'`).bind(body.requestId, project.id)
      .first<{ id: string; version: number; title: string; notes: string; objectKey: string; sha256: string }>();
    if (!requested) return Response.json({ error: "That version request is no longer pending." }, { status: 409 });
    pinned = requested;
    requestId = requested.id;
    body.title = body.title?.trim() || requested.title;
    body.notes = body.notes?.trim() || requested.notes;
  }

  const duplicate = await DB.prepare(`SELECT release_number AS releaseNumber FROM ork_releases WHERE project_id = ? AND sha256 = ? LIMIT 1`)
    .bind(project.id, pinned.sha256).first<{ releaseNumber: number }>();
  if (duplicate) return Response.json({ error: `This exact configuration is already controlled as V${duplicate.releaseNumber}.` }, { status: 409 });

  const count = await DB.prepare(`SELECT COALESCE(MAX(release_number), 0) AS latest FROM ork_releases WHERE project_id = ?`)
    .bind(project.id).first<{ latest: number }>();
  const releaseNumber = Number(count?.latest ?? 0) + 1;
  const statements = [DB.prepare(`INSERT INTO ork_releases
    (project_id, release_number, working_version, title, notes, object_key, sha256, created_by_name, created_by_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(project.id, releaseNumber, pinned.version, body.title?.trim() || `Release V${releaseNumber}`, body.notes?.trim() || "", pinned.objectKey, pinned.sha256, user.displayName, user.email)];
  if (requestId) statements.push(DB.prepare(`UPDATE ork_release_requests SET status = 'approved', reviewed_by_name = ?, reviewed_by_email = ?, reviewed_at = CURRENT_TIMESTAMP, release_number = ? WHERE id = ?`)
    .bind(user.displayName, user.email, releaseNumber, requestId));
  await DB.batch(statements);
  return Response.json({ ...(await releaseState(project.id)), releaseNumber }, { status: 201 });
}

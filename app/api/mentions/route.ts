import { ensureComponentRecordSchema, getComponentRecordEnvironment } from "../../../db/component-record-store";
import { requireProjectAccess } from "../access";

function mapRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    value,
  ]));
}

async function unreadCount(projectId: string, email: string) {
  const { DB } = getComponentRecordEnvironment();
  const row = await DB.prepare(`SELECT count(*) AS total FROM component_mentions
    WHERE project_id = ? AND lower(recipient_email) = lower(?) AND read_at IS NULL`)
    .bind(projectId, email)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function GET(request: Request) {
  const accessResult = await requireProjectAccess(request, "view");
  if (!accessResult.ok) return accessResult.response;
  await ensureComponentRecordSchema();
  const { DB } = getComponentRecordEnvironment();
  const { project, user } = accessResult.access;
  const rows = await DB.prepare(`SELECT id, project_id, component_id, component_code, comment_id,
      recipient_name, author_name, body_excerpt, read_at, created_at
    FROM component_mentions
    WHERE project_id = ? AND lower(recipient_email) = lower(?)
    ORDER BY (read_at IS NOT NULL), id DESC
    LIMIT 60`)
    .bind(project.id, user.email)
    .all<Record<string, unknown>>();
  return Response.json({
    notifications: rows.results.map(mapRow),
    unreadCount: await unreadCount(project.id, user.email),
  });
}

export async function POST(request: Request) {
  const accessResult = await requireProjectAccess(request, "view");
  if (!accessResult.ok) return accessResult.response;
  await ensureComponentRecordSchema();
  const { DB } = getComponentRecordEnvironment();
  const { project, user } = accessResult.access;
  let body: { action?: string; id?: number };
  try { body = await request.json() as { action?: string; id?: number }; }
  catch { return Response.json({ error: "A valid JSON request body is required." }, { status: 400 }); }

  if (body.action === "mark-all-read") {
    await DB.prepare(`UPDATE component_mentions SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE project_id = ? AND lower(recipient_email) = lower(?)`)
      .bind(project.id, user.email).run();
  } else if (body.action === "mark-read" && Number.isInteger(Number(body.id)) && Number(body.id) > 0) {
    await DB.prepare(`UPDATE component_mentions SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE id = ? AND project_id = ? AND lower(recipient_email) = lower(?)`)
      .bind(Number(body.id), project.id, user.email).run();
  } else {
    return Response.json({ error: "A valid mention action is required." }, { status: 400 });
  }

  return Response.json({ unreadCount: await unreadCount(project.id, user.email) });
}

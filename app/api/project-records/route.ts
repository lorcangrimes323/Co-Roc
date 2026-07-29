import { ensureComponentRecordSchema, getComponentRecordEnvironment } from "../../../db/component-record-store";
import { requireProjectAccess } from "../access";

function mapRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    value,
  ]));
}

export async function GET(request: Request) {
  const access = await requireProjectAccess(request, "view");
  if (!access.ok) return access.response;
  await ensureComponentRecordSchema();
  const { DB } = getComponentRecordEnvironment();
  const projectId = access.access.project.id;
  const [artifacts, tests, events] = await Promise.all([
    DB.prepare(`SELECT * FROM component_artifacts WHERE project_id = ? ORDER BY component_id, category, id DESC`).bind(projectId).all<Record<string, unknown>>(),
    DB.prepare(`SELECT * FROM component_tests WHERE project_id = ? ORDER BY status ASC, component_id, id DESC`).bind(projectId).all<Record<string, unknown>>(),
    DB.prepare(`SELECT * FROM component_record_events WHERE project_id = ? ORDER BY id DESC LIMIT 250`).bind(projectId).all<Record<string, unknown>>(),
  ]);
  return Response.json({
    artifacts: artifacts.results.map(mapRow),
    tests: tests.results.map(mapRow),
    events: events.results.map(mapRow),
  });
}

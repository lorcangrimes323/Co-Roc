import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { revisions } from "../../../db/schema";
import { requireProjectAccess } from "../access";

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  const projectId = result.access.project.id;

  const rows = await getDb()
    .select()
    .from(revisions)
    .where(eq(revisions.projectId, projectId))
    .orderBy(desc(revisions.id))
    .limit(20);

  return Response.json({ revisions: rows });
}

export async function POST(request: Request) {
  const result = await requireProjectAccess(request, "requestRelease");
  if (!result.ok) return result.response;
  return Response.json({ error: "Revisions have been replaced by controlled versions. Use /api/releases to request or approve a release baseline." }, { status: 410 });
}

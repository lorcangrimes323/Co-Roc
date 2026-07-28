import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureOrkSchema } from "../../../db/ork-store";
import { orkSnapshots, orkWorkspaces, revisions } from "../../../db/schema";
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
  const result = await requireProjectAccess(request, "createRevision");
  if (!result.ok) return result.response;
  const { user, project } = result.access;

  const payload = (await request.json()) as {
    title?: string;
    componentId?: string;
    componentCode?: string;
  };
  const title = payload.title?.trim();
  const componentId = payload.componentId?.trim();
  const componentCode = payload.componentCode?.trim();

  if (!title || !componentId || !componentCode) {
    return Response.json({ error: "Revision details are incomplete." }, { status: 400 });
  }

  await ensureOrkSchema();
  const db = getDb();
  const [revision] = await db
    .insert(revisions)
    .values({
      projectId: project.id,
      title,
      componentId,
      componentCode,
      authorName: user.displayName,
      authorEmail: user.email,
    })
    .returning();

  const [workspace] = await db.select().from(orkWorkspaces).where(eq(orkWorkspaces.projectId, project.id)).limit(1);
  if (workspace) {
    await db.insert(orkSnapshots).values({
      projectId: workspace.projectId,
      version: workspace.version,
      title,
      objectKey: workspace.currentObjectKey,
      sha256: workspace.sha256,
      authorName: user.displayName,
      authorEmail: user.email,
    }).onConflictDoNothing();
  }

  return Response.json({ revision, snapshotVersion: workspace?.version ?? null }, { status: 201 });
}

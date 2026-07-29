import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureOrkSchema } from "../../../../db/ork-store";
import { orkChanges, orkReleaseRequests, orkReleases, orkSnapshots } from "../../../../db/schema";
import { requireProjectAccess } from "../../access";

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  const projectId = result.access.project.id;
  await ensureOrkSchema();
  const db = getDb();
  const [changes, snapshots, releases, requests] = await Promise.all([
    db.select().from(orkChanges).where(eq(orkChanges.projectId, projectId)).orderBy(desc(orkChanges.id)).limit(100),
    db.select().from(orkSnapshots).where(eq(orkSnapshots.projectId, projectId)).orderBy(desc(orkSnapshots.id)).limit(30),
    db.select().from(orkReleases).where(eq(orkReleases.projectId, projectId)).orderBy(desc(orkReleases.releaseNumber)).limit(30),
    db.select().from(orkReleaseRequests).where(eq(orkReleaseRequests.projectId, projectId)).orderBy(desc(orkReleaseRequests.requestedAt)).limit(50),
  ]);
  return Response.json({ changes, snapshots, releases, requests });
}

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { releaseProjectStorage, reserveProjectStorage, STORAGE_LIMITS } from "../../../db/access-store";
import { documents } from "../../../db/schema";
import { getComponentRecordEnvironment } from "../../../db/component-record-store";
import { requireProjectAccess } from "../access";

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;

  const componentId = new URL(request.url).searchParams.get("componentId");
  if (!componentId) {
    return Response.json({ error: "componentId is required." }, { status: 400 });
  }

  const rows = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.projectId, result.access.project.id), eq(documents.componentId, componentId)))
    .orderBy(desc(documents.id));

  return Response.json({ documents: rows });
}

export async function POST(request: Request) {
  const result = await requireProjectAccess(request, "uploadEvidence");
  if (!result.ok) return result.response;
  const { user, project } = result.access;

  const form = await request.formData();
  const componentId = String(form.get("componentId") ?? "").trim();
  const file = form.get("file");

  if (!componentId || !(file instanceof File)) {
    return Response.json({ error: "A component and file are required." }, { status: 400 });
  }
  if (file.size > STORAGE_LIMITS.maxArtifactBytes) {
    return Response.json({ error: "Files must be 24 MB or smaller." }, { status: 413 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const objectKey = `${project.id}/legacy-documents/${componentId}/${crypto.randomUUID()}-${safeName}`;
  if (!await reserveProjectStorage(project.id, file.size, 1)) {
    return Response.json({ error: "This project has reached its 2 GB storage limit." }, { status: 413 });
  }
  try {
    await getComponentRecordEnvironment().FILES.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    });
  } catch (error) {
    await releaseProjectStorage(project.id, file.size, 1);
    throw error;
  }

  const [document] = await getDb()
    .insert(documents)
    .values({
      projectId: project.id,
      componentId,
      fileName: file.name,
      objectKey,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedByName: user.displayName,
      uploadedByEmail: user.email,
    })
    .returning();

  return Response.json({ document }, { status: 201 });
}

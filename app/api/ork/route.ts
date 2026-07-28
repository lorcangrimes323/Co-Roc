import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureOrkSchema, getOrkEnvironment, sha256Hex } from "../../../db/ork-store";
import { orkChanges, orkWorkspaces } from "../../../db/schema";
import { releaseProjectStorage, reserveProjectStorage, STORAGE_LIMITS } from "../../../db/access-store";
import { requireProjectAccess } from "../access";

const EDITABLE_FIELDS = new Set(["name", "length", "diameter", "wallThickness", "mass", "material", "file.imported", "file.replaced"]);

type ChangePayload = {
  componentId: string;
  componentCode: string;
  field: string;
  previousValue: string;
  nextValue: string;
};

function metadata(row: typeof orkWorkspaces.$inferSelect) {
  return {
    projectId: row.projectId,
    sourceName: row.sourceName,
    version: row.version,
    sha256: row.sha256,
    updatedByName: row.updatedByName,
    updatedByEmail: row.updatedByEmail,
    updatedAt: row.updatedAt,
  };
}

function localOrkHeaders(request: Request, sourceName: string) {
  const headers = new Headers({
    "content-type": "application/zip",
    "cache-control": "no-store",
  });
  if (new URL(request.url).searchParams.get("download") === "1") {
    const safeName = sourceName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "working.ork";
    headers.set("content-disposition", `attachment; filename="${safeName}"`);
  }
  return headers;
}

async function workspaceRow(projectId: string) {
  const [row] = await getDb().select().from(orkWorkspaces).where(eq(orkWorkspaces.projectId, projectId)).limit(1);
  return row;
}

function validOrk(file: File) {
  return file.size > 0 && file.size <= STORAGE_LIMITS.maxOrkBytes && file.name.toLowerCase().endsWith(".ork");
}

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  const projectId = result.access.project.id;
  await ensureOrkSchema();
  const row = await workspaceRow(projectId);
  if (!row) return Response.json({ error: "No shared OpenRocket workspace exists yet." }, { status: 404 });

  const afterVersion = Number(new URL(request.url).searchParams.get("afterVersion") ?? -1);
  if (Number.isFinite(afterVersion) && afterVersion >= row.version) {
    return new Response(null, { status: 204, headers: { "x-ork-version": String(row.version) } });
  }

  const object = await getOrkEnvironment().FILES.get(row.currentObjectKey);
  if (!object) return Response.json({ error: "The working .ork object is missing." }, { status: 503 });
  const headers = localOrkHeaders(request, row.sourceName);
  headers.set("x-ork-version", String(row.version));
  headers.set("x-ork-sha256", row.sha256);
  headers.set("x-ork-source-name", encodeURIComponent(row.sourceName));
  headers.set("x-ork-updated-by", encodeURIComponent(row.updatedByName));
  headers.set("x-ork-updated-at", row.updatedAt);
  return new Response(object.body, { headers });
}

export async function POST(request: Request) {
  const result = await requireProjectAccess(request, "editOrk");
  if (!result.ok) return result.response;
  const { user, project } = result.access;
  const projectId = project.id;
  await ensureOrkSchema();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !validOrk(file)) {
    return Response.json({ error: "A valid .ork file no larger than 25 MB is required." }, { status: 400 });
  }

  const existing = await workspaceRow(projectId);
  const requestedBase = Number(form.get("baseVersion") ?? 0);
  if (existing && requestedBase !== existing.version) {
    return Response.json({ error: "The shared file changed before this import completed.", workspace: metadata(existing) }, { status: 409 });
  }

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const nextVersion = existing ? existing.version + 1 : 1;
  const versionKey = `${projectId}/versions/v${nextVersion}-${crypto.randomUUID()}.ork`;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const originalKey = existing?.originalObjectKey ?? `${projectId}/original/${crypto.randomUUID()}-${safeName}`;
  const { FILES } = getOrkEnvironment();
  const reservedBytes = file.size * (existing ? 1 : 2);
  const reservedFiles = existing ? 1 : 2;
  if (!await reserveProjectStorage(projectId, reservedBytes, reservedFiles)) {
    return Response.json({ error: "This project has reached its 2 GB storage limit." }, { status: 413 });
  }
  try {
    if (!existing) await FILES.put(originalKey, bytes, { httpMetadata: { contentType: "application/zip" } });
    await FILES.put(versionKey, bytes, { httpMetadata: { contentType: "application/zip" } });
  } catch {
    await FILES.delete(versionKey);
    if (!existing) await FILES.delete(originalKey);
    await releaseProjectStorage(projectId, reservedBytes, reservedFiles);
    return Response.json({ error: "The .ork file could not be stored. No project data was changed." }, { status: 503 });
  }

  const db = getDb();
  if (existing) {
    const updated = await db.update(orkWorkspaces).set({
      sourceName: file.name,
      currentObjectKey: versionKey,
      version: nextVersion,
      sha256,
      updatedByName: user.displayName,
      updatedByEmail: user.email,
      updatedAt: new Date().toISOString(),
    }).where(and(eq(orkWorkspaces.projectId, projectId), eq(orkWorkspaces.version, existing.version))).returning();
    if (!updated.length) {
      await FILES.delete(versionKey);
      await releaseProjectStorage(projectId, reservedBytes, reservedFiles);
      const current = await workspaceRow(projectId);
      return Response.json({ error: "The shared file changed during import.", workspace: current ? metadata(current) : null }, { status: 409 });
    }
  } else {
    await db.insert(orkWorkspaces).values({
      projectId,
      sourceName: file.name,
      originalObjectKey: originalKey,
      currentObjectKey: versionKey,
      version: nextVersion,
      sha256,
      updatedByName: user.displayName,
      updatedByEmail: user.email,
      updatedAt: new Date().toISOString(),
    });
  }

  await db.insert(orkChanges).values({
    projectId,
    version: nextVersion,
    componentId: "vehicle",
    componentCode: "ORK",
    field: existing ? "file.replaced" : "file.imported",
    previousValue: existing?.sourceName ?? "none",
    nextValue: file.name,
    authorName: user.displayName,
    authorEmail: user.email,
  });
  const row = await workspaceRow(projectId);
  return Response.json({ workspace: row ? metadata(row) : null }, { status: 201 });
}

export async function PUT(request: Request) {
  const result = await requireProjectAccess(request, "editOrk");
  if (!result.ok) return result.response;
  const { user, project } = result.access;
  const projectId = project.id;
  await ensureOrkSchema();
  const form = await request.formData();
  const file = form.get("file");
  const baseVersion = Number(form.get("baseVersion"));
  let changes: ChangePayload[] = [];
  try { changes = JSON.parse(String(form.get("changes") ?? "[]")) as ChangePayload[]; } catch { /* validated below */ }
  const uniqueChanges = Array.from(new Map(changes.map((change) => [`${change.componentId}:${change.field}`, change])).values());
  if (!(file instanceof File) || !validOrk(file) || !Number.isInteger(baseVersion) || !uniqueChanges.length || uniqueChanges.length > 50) {
    return Response.json({ error: "The update payload is incomplete." }, { status: 400 });
  }
  if (uniqueChanges.some((change) => !change.componentId || !change.componentCode || !EDITABLE_FIELDS.has(change.field))) {
    return Response.json({ error: "The update contains an unsupported field." }, { status: 400 });
  }

  const current = await workspaceRow(projectId);
  if (!current) return Response.json({ error: "No shared OpenRocket workspace exists yet." }, { status: 404 });
  if (current.version !== baseVersion) {
    return Response.json({ error: "A teammate saved a newer version.", workspace: metadata(current) }, { status: 409 });
  }

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const nextVersion = baseVersion + 1;
  const objectKey = `${projectId}/versions/v${nextVersion}-${crypto.randomUUID()}.ork`;
  const { FILES } = getOrkEnvironment();
  if (!await reserveProjectStorage(projectId, file.size, 1)) {
    return Response.json({ error: "This project has reached its 2 GB storage limit." }, { status: 413 });
  }
  try {
    await FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/zip" } });
  } catch {
    await releaseProjectStorage(projectId, file.size, 1);
    return Response.json({ error: "The .ork version could not be stored. Your local draft is still recoverable." }, { status: 503 });
  }

  const db = getDb();
  const updated = await db.update(orkWorkspaces).set({
    currentObjectKey: objectKey,
    version: nextVersion,
    sha256,
    updatedByName: user.displayName,
    updatedByEmail: user.email,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(orkWorkspaces.projectId, projectId), eq(orkWorkspaces.version, baseVersion))).returning();
  if (!updated.length) {
    await FILES.delete(objectKey);
    await releaseProjectStorage(projectId, file.size, 1);
    const latest = await workspaceRow(projectId);
    return Response.json({ error: "A teammate saved first.", workspace: latest ? metadata(latest) : null }, { status: 409 });
  }

  await db.insert(orkChanges).values(uniqueChanges.map((change) => ({
    projectId,
    version: nextVersion,
    componentId: change.componentId,
    componentCode: change.componentCode,
    field: change.field,
    previousValue: String(change.previousValue),
    nextValue: String(change.nextValue),
    authorName: user.displayName,
    authorEmail: user.email,
  })));
  return Response.json({ workspace: metadata(updated[0]), changes: uniqueChanges.length });
}

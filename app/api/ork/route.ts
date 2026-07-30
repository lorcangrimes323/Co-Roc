import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureOrkSchema, getOrkEnvironment, sha256Hex } from "../../../db/ork-store";
import { orkChanges, orkWorkspaces } from "../../../db/schema";
import { releaseProjectStorage, reserveProjectStorage, STORAGE_LIMITS } from "../../../db/access-store";
import { requireProjectAccess } from "../access";

const EDITABLE_FIELDS = new Set(["name", "length", "diameter", "wallThickness", "mass", "material", "simulationSetup", "file.imported", "file.replaced"]);

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

const ORK_BINARY_CONTENT_TYPE = "application/vnd.co-roc.ork";

function decodedHeader(request: Request, name: string) {
  const value = request.headers.get(name) ?? "";
  try { return decodeURIComponent(value); } catch { return ""; }
}

async function readOrkUpload(request: Request) {
  if (request.headers.get("content-type")?.toLowerCase().startsWith(ORK_BINARY_CONTENT_TYPE)) {
    const sourceName = decodedHeader(request, "x-co-roc-file-name");
    const bytes = await request.arrayBuffer();
    return {
      file: new File([bytes], sourceName, { type: "application/zip" }),
      baseVersion: Number(request.headers.get("x-co-roc-base-version") ?? 0),
      changes: decodedHeader(request, "x-co-roc-changes"),
    };
  }

  const form = await request.formData();
  return {
    file: form.get("file"),
    baseVersion: Number(form.get("baseVersion") ?? 0),
    changes: String(form.get("changes") ?? "[]"),
  };
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
  const upload = await readOrkUpload(request);
  const file = upload.file;
  if (!(file instanceof File) || !validOrk(file)) {
    return Response.json({ error: "A valid .ork file no larger than 25 MB is required." }, { status: 400 });
  }

  const existing = await workspaceRow(projectId);
  if (existing) {
    return Response.json({
      error: "The live ORK cannot be replaced directly. Compare the edited file and submit it through the controlled ORK proposal workflow.",
      workspace: metadata(existing),
      proposalEndpoint: "/api/ork/proposals",
    }, { status: 409 });
  }
  const requestedBase = upload.baseVersion;
  if (requestedBase !== 0) return Response.json({ error: "This project does not have a working ORK at that base version." }, { status: 409 });

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const nextVersion = 1;
  const versionKey = `${projectId}/versions/v${nextVersion}-${crypto.randomUUID()}.ork`;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const originalKey = `${projectId}/original/${crypto.randomUUID()}-${safeName}`;
  const { FILES } = getOrkEnvironment();
  const reservedBytes = file.size * 2;
  const reservedFiles = 2;
  if (!await reserveProjectStorage(projectId, reservedBytes, reservedFiles)) {
    return Response.json({ error: "This project has reached its 2 GB storage limit." }, { status: 413 });
  }
  try {
    await FILES.put(originalKey, bytes, { httpMetadata: { contentType: "application/zip" } });
    await FILES.put(versionKey, bytes, { httpMetadata: { contentType: "application/zip" } });
  } catch {
    await FILES.delete(versionKey);
    await FILES.delete(originalKey);
    await releaseProjectStorage(projectId, reservedBytes, reservedFiles);
    return Response.json({ error: "The .ork file could not be stored. No project data was changed." }, { status: 503 });
  }

  const db = getDb();
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

  await db.insert(orkChanges).values({
    projectId,
    version: nextVersion,
    componentId: "vehicle",
    componentCode: "ORK",
    field: "file.imported",
    previousValue: "none",
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
  const upload = await readOrkUpload(request);
  const file = upload.file;
  const baseVersion = upload.baseVersion;
  let changes: ChangePayload[] = [];
  try { changes = JSON.parse(upload.changes || "[]") as ChangePayload[]; } catch { /* validated below */ }
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

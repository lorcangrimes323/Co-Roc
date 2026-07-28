import { ensureComponentRecordSchema, getComponentRecordEnvironment } from "../../../db/component-record-store";
import { releaseProjectStorage, reserveProjectStorage, STORAGE_LIMITS } from "../../../db/access-store";
import { requireProjectAccess } from "../access";

const ARTIFACT_CATEGORIES = new Set(["drawing", "document", "test-evidence", "photo", "video"]);

type RecordUser = { displayName: string; email: string };

function textValue(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function mapRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    value,
  ]));
}

async function addEvent(input: {
  projectId: string;
  componentId: string;
  componentCode: string;
  action: string;
  entityType: string;
  entityId: number;
  summary: string;
  payload?: unknown;
  orkVersion: number | null;
  user: RecordUser;
}) {
  const { DB } = getComponentRecordEnvironment();
  await DB.prepare(`INSERT INTO component_record_events (
    project_id, component_id, component_code, action, entity_type, entity_id,
    summary, payload_json, ork_version, author_name, author_email
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.projectId,
      input.componentId,
      input.componentCode,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      JSON.stringify(input.payload ?? {}),
      input.orkVersion,
      input.user.displayName,
      input.user.email,
    )
    .run();
}

export async function GET(request: Request) {
  const accessResult = await requireProjectAccess(request, "view");
  if (!accessResult.ok) return accessResult.response;
  const projectId = accessResult.access.project.id;

  const url = new URL(request.url);
  const componentId = textValue(url.searchParams.get("componentId"), 160);
  if (!componentId) return Response.json({ error: "componentId is required." }, { status: 400 });

  await ensureComponentRecordSchema();
  const { DB, FILES } = getComponentRecordEnvironment();
  const artifactId = numberValue(url.searchParams.get("artifactId"));
  if (artifactId && url.searchParams.get("download") === "1") {
    const artifact = await DB.prepare(`SELECT object_key, file_name, content_type
      FROM component_artifacts WHERE project_id = ? AND component_id = ? AND id = ?`)
      .bind(projectId, componentId, artifactId)
      .first<{ object_key: string; file_name: string; content_type: string }>();
    if (!artifact) return Response.json({ error: "Record not found." }, { status: 404 });
    const object = await FILES.get(artifact.object_key);
    if (!object) return Response.json({ error: "Stored file not found." }, { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": artifact.content_type,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(artifact.file_name)}`,
        "cache-control": "private, no-store",
      },
    });
  }

  const [artifactRows, testRows, commentRows, eventRows] = await Promise.all([
    DB.prepare(`SELECT * FROM component_artifacts WHERE project_id = ? AND component_id = ? ORDER BY id DESC`)
      .bind(projectId, componentId).all<Record<string, unknown>>(),
    DB.prepare(`SELECT * FROM component_tests WHERE project_id = ? AND component_id = ? ORDER BY status ASC, id DESC`)
      .bind(projectId, componentId).all<Record<string, unknown>>(),
    DB.prepare(`SELECT * FROM component_comments WHERE project_id = ? AND component_id = ? ORDER BY id DESC`)
      .bind(projectId, componentId).all<Record<string, unknown>>(),
    DB.prepare(`SELECT * FROM component_record_events WHERE project_id = ? AND component_id = ? ORDER BY id DESC LIMIT 80`)
      .bind(projectId, componentId).all<Record<string, unknown>>(),
  ]);

  return Response.json({
    artifacts: artifactRows.results.map(mapRow),
    tests: testRows.results.map(mapRow),
    comments: commentRows.results.map((row) => {
      const mapped = mapRow(row) as Record<string, unknown>;
      try { mapped.mentions = JSON.parse(String(mapped.mentionsJson || "[]")); } catch { mapped.mentions = []; }
      return mapped;
    }),
    events: eventRows.results.map(mapRow),
  });
}

export async function POST(request: Request) {
  await ensureComponentRecordSchema();
  const { DB, FILES } = getComponentRecordEnvironment();
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const accessResult = await requireProjectAccess(request, "uploadEvidence");
    if (!accessResult.ok) return accessResult.response;
    const { user, project } = accessResult.access;
    const projectId = project.id;
    const form = await request.formData();
    const componentId = textValue(form.get("componentId"), 160);
    const componentCode = textValue(form.get("componentCode"), 80);
    const category = textValue(form.get("category"), 40);
    const revision = textValue(form.get("revision"), 24).toUpperCase() || "A";
    const orkVersion = numberValue(form.get("orkVersion"));
    const file = form.get("file");
    const suppliedTitle = textValue(form.get("title"), 180);
    if (!componentId || !componentCode || !ARTIFACT_CATEGORIES.has(category) || !(file instanceof File)) {
      return Response.json({ error: "Component, category, and file are required." }, { status: 400 });
    }
    if (file.size > STORAGE_LIMITS.maxArtifactBytes) {
      return Response.json({ error: "Files must be 24 MB or smaller in this preview." }, { status: 413 });
    }

    const title = suppliedTitle || file.name.replace(/\.[^.]+$/, "");
    const previous = category === "drawing"
      ? await DB.prepare(`SELECT id FROM component_artifacts
          WHERE project_id = ? AND component_id = ? AND category = 'drawing' AND title = ? AND status = 'current'
          ORDER BY id DESC LIMIT 1`)
        .bind(projectId, componentId, title).first<{ id: number }>()
      : null;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const objectKey = `${projectId}/records/${componentId}/${crypto.randomUUID()}-${safeName}`;
    if (!await reserveProjectStorage(projectId, file.size, 1)) {
      return Response.json({ error: "This project has reached its 2 GB storage limit." }, { status: 413 });
    }
    try { await FILES.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { componentId, componentCode, category, revision, uploadedBy: user.email },
    }); } catch (error) {
      await releaseProjectStorage(projectId, file.size, 1);
      throw error;
    }

    const result = await DB.prepare(`INSERT INTO component_artifacts (
      project_id, component_id, component_code, category, title, revision, status,
      file_name, object_key, content_type, size_bytes, ork_version, supersedes_id,
      uploaded_by_name, uploaded_by_email
    ) VALUES (?, ?, ?, ?, ?, ?, 'current', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        projectId, componentId, componentCode, category, title, revision,
        file.name, objectKey, file.type || "application/octet-stream", file.size,
        orkVersion, previous?.id ?? null, user.displayName, user.email,
      )
      .run();
    const artifactId = Number(result.meta.last_row_id);
    if (previous) {
      await DB.prepare(`UPDATE component_artifacts SET status = 'superseded'
        WHERE project_id = ? AND component_id = ? AND id = ?`)
        .bind(projectId, componentId, previous.id).run();
    }
    await addEvent({
      projectId, componentId, componentCode, action: "uploaded", entityType: "artifact", entityId: artifactId,
      summary: `${category === "drawing" ? `Drawing revision ${revision}` : category} added: ${title}`,
      payload: { category, revision, fileName: file.name, supersedesId: previous?.id ?? null },
      orkVersion, user,
    });
    return Response.json({ id: artifactId }, { status: 201 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  const action = textValue(body.action, 40);
  const permission = action === "create-test" ? "createTest" : action === "complete-test" ? "completeTest" : "comment";
  const accessResult = await requireProjectAccess(request, permission);
  if (!accessResult.ok) return accessResult.response;
  const { user, project } = accessResult.access;
  const projectId = project.id;
  const componentId = textValue(body.componentId, 160);
  const componentCode = textValue(body.componentCode, 80);
  const orkVersion = numberValue(body.orkVersion);
  if (!componentId || !componentCode) {
    return Response.json({ error: "Component identity is required." }, { status: 400 });
  }

  if (action === "create-test") {
    const title = textValue(body.title, 160);
    const requirement = textValue(body.requirement, 1200);
    if (!title || !requirement) return Response.json({ error: "Test title and acceptance requirement are required." }, { status: 400 });
    const result = await DB.prepare(`INSERT INTO component_tests (
      project_id, component_id, component_code, title, requirement, status,
      owner_name, owner_email, ork_version
    ) VALUES (?, ?, ?, ?, ?, 'required', ?, ?, ?)`)
      .bind(projectId, componentId, componentCode, title, requirement, user.displayName, user.email, orkVersion)
      .run();
    const testId = Number(result.meta.last_row_id);
    await addEvent({
      projectId, componentId, componentCode, action: "required", entityType: "test", entityId: testId,
      summary: `Test required: ${title}`, payload: { requirement }, orkVersion, user,
    });
    return Response.json({ id: testId }, { status: 201 });
  }

  if (action === "complete-test") {
    const testId = numberValue(body.testId);
    const completionNotes = textValue(body.completionNotes, 1200) || "Completion recorded in the component engineering record.";
    if (!testId) return Response.json({ error: "testId is required." }, { status: 400 });
    const test = await DB.prepare(`SELECT title FROM component_tests WHERE project_id = ? AND component_id = ? AND id = ?`)
      .bind(projectId, componentId, testId).first<{ title: string }>();
    if (!test) return Response.json({ error: "Test not found." }, { status: 404 });
    await DB.prepare(`UPDATE component_tests SET status = 'complete', completion_notes = ?,
      completed_by_name = ?, completed_by_email = ?, completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP, ork_version = ?
      WHERE project_id = ? AND component_id = ? AND id = ?`)
      .bind(completionNotes, user.displayName, user.email, orkVersion, projectId, componentId, testId)
      .run();
    await addEvent({
      projectId, componentId, componentCode, action: "completed", entityType: "test", entityId: testId,
      summary: `Test complete: ${test.title}`, payload: { completionNotes }, orkVersion, user,
    });
    return Response.json({ id: testId });
  }

  if (action === "add-comment") {
    const comment = textValue(body.body, 3000);
    if (!comment) return Response.json({ error: "Comment cannot be empty." }, { status: 400 });
    const mentions = Array.from(comment.matchAll(/@([A-Za-z][A-Za-z .'-]{1,40})/g), (match) => match[1].trim())
      .filter((name, index, items) => items.indexOf(name) === index)
      .slice(0, 12);
    const result = await DB.prepare(`INSERT INTO component_comments (
      project_id, component_id, component_code, body, mentions_json, ork_version,
      author_name, author_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(projectId, componentId, componentCode, comment, JSON.stringify(mentions), orkVersion, user.displayName, user.email)
      .run();
    const commentId = Number(result.meta.last_row_id);
    await addEvent({
      projectId, componentId, componentCode, action: "commented", entityType: "comment", entityId: commentId,
      summary: mentions.length ? `Commented and mentioned ${mentions.join(", ")}` : "Comment added",
      payload: { mentions }, orkVersion, user,
    });
    return Response.json({ id: commentId, mentions }, { status: 201 });
  }

  return Response.json({ error: "Unsupported component-record action." }, { status: 400 });
}

import { ensureOrkSchema, getOrkEnvironment, sha256Hex } from "../../../../db/ork-store";
import { releaseProjectStorage, reserveProjectStorage, STORAGE_LIMITS } from "../../../../db/access-store";
import { requireProjectAccess } from "../../access";

type ProposalField = {
  field: string;
  label: string;
  previousValue: string;
  nextValue: string;
  category: "geometry" | "mass" | "material" | "configuration" | "structure";
};

type ProposalItem = {
  componentId: string;
  componentCode: string;
  componentName: string;
  componentKind: string;
  changeType: "added" | "removed" | "modified";
  geometryChanged: boolean;
  changes: ProposalField[];
  rationale: string;
};

type ProposalRow = {
  id: string;
  baseVersion: number;
  sourceName: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  summary: string;
  status: "pending" | "approved" | "rejected" | "conflict";
  changedComponents: number;
  geometryChanges: number;
  submittedByName: string;
  submittedByEmail: string;
  submittedAt: string;
  reviewedByName: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  appliedVersion: number | null;
};

function validOrk(file: File) {
  return file.size > 0 && file.size <= STORAGE_LIMITS.maxOrkBytes && file.name.toLowerCase().endsWith(".ork");
}

function safeItems(value: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 80) return null;
  const items = parsed as ProposalItem[];
  if (new Set(items.map((item) => item?.componentId)).size !== items.length) return null;
  const valid = items.every((item) =>
    item && typeof item.componentId === "string" && item.componentId.length <= 160
    && typeof item.componentCode === "string" && item.componentCode.length <= 40
    && typeof item.componentName === "string" && item.componentName.length <= 200
    && typeof item.componentKind === "string" && item.componentKind.length <= 100
    && ["added", "removed", "modified"].includes(item.changeType)
    && typeof item.geometryChanged === "boolean"
    && typeof item.rationale === "string" && item.rationale.trim().length >= 5 && item.rationale.trim().length <= 2000
    && Array.isArray(item.changes) && item.changes.length > 0 && item.changes.length <= 40
    && item.changes.every((change) => change && typeof change.field === "string" && change.field.length <= 100
      && typeof change.label === "string" && change.label.length <= 160
      && typeof change.previousValue === "string" && change.previousValue.length <= 5000
      && typeof change.nextValue === "string" && change.nextValue.length <= 5000
      && ["geometry", "mass", "material", "configuration", "structure"].includes(change.category))
  );
  return valid ? items.map((item) => ({ ...item, rationale: item.rationale.trim() })) : null;
}

async function proposalState(projectId: string) {
  const { DB } = getOrkEnvironment();
  const [proposalRows, itemRows] = await Promise.all([
    DB.prepare(`SELECT id, base_version AS baseVersion, source_name AS sourceName, sha256,
      size_bytes AS sizeBytes, summary, status, changed_components AS changedComponents,
      geometry_changes AS geometryChanges, submitted_by_name AS submittedByName,
      submitted_by_email AS submittedByEmail, submitted_at AS submittedAt,
      reviewed_by_name AS reviewedByName, reviewed_by_email AS reviewedByEmail,
      reviewed_at AS reviewedAt, review_notes AS reviewNotes, applied_version AS appliedVersion
      FROM ork_change_proposals WHERE project_id = ? ORDER BY submitted_at DESC LIMIT 50`)
      .bind(projectId).all<ProposalRow>(),
    DB.prepare(`SELECT id, proposal_id AS proposalId, component_id AS componentId,
      component_code AS componentCode, component_name AS componentName, component_kind AS componentKind,
      change_type AS changeType, geometry_changed AS geometryChanged, changes_json AS changesJson, rationale
      FROM ork_change_proposal_items WHERE project_id = ? ORDER BY id`).bind(projectId).all<{
        id: number; proposalId: string; componentId: string; componentCode: string; componentName: string;
        componentKind: string; changeType: ProposalItem["changeType"]; geometryChanged: number; changesJson: string; rationale: string;
      }>(),
  ]);
  const itemsByProposal = new Map<string, Array<Omit<ProposalItem, "geometryChanged"> & { id: number; geometryChanged: boolean }>>();
  for (const row of itemRows.results) {
    let changes: ProposalField[] = [];
    try { changes = JSON.parse(row.changesJson) as ProposalField[]; } catch { /* keep the proposal inspectable */ }
    const items = itemsByProposal.get(row.proposalId) ?? [];
    items.push({ id: row.id, componentId: row.componentId, componentCode: row.componentCode, componentName: row.componentName, componentKind: row.componentKind, changeType: row.changeType, geometryChanged: Boolean(row.geometryChanged), changes, rationale: row.rationale });
    itemsByProposal.set(row.proposalId, items);
  }
  return proposalRows.results.map((proposal) => ({ ...proposal, items: itemsByProposal.get(proposal.id) ?? [] }));
}

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  await ensureOrkSchema();
  const url = new URL(request.url);
  const proposalId = url.searchParams.get("proposalId");
  if (proposalId && url.searchParams.get("download") === "1") {
    const { DB, FILES } = getOrkEnvironment();
    const row = await DB.prepare(`SELECT source_name AS sourceName, object_key AS objectKey FROM ork_change_proposals WHERE id = ? AND project_id = ?`)
      .bind(proposalId, result.access.project.id).first<{ sourceName: string; objectKey: string }>();
    if (!row) return Response.json({ error: "That proposed ORK does not exist." }, { status: 404 });
    const object = await FILES.get(row.objectKey);
    if (!object) return Response.json({ error: "The proposed ORK file is unavailable." }, { status: 503 });
    const safeName = row.sourceName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "proposed.ork";
    return new Response(object.body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${safeName}"`, "cache-control": "no-store" } });
  }
  return Response.json({ proposals: await proposalState(result.access.project.id) });
}

export async function POST(request: Request) {
  const result = await requireProjectAccess(request, "editOrk");
  if (!result.ok) return result.response;
  await ensureOrkSchema();
  const { DB, FILES } = getOrkEnvironment();
  const { project, user } = result.access;
  const form = await request.formData();
  const file = form.get("file");
  const baseVersion = Number(form.get("baseVersion"));
  const summary = String(form.get("summary") ?? "").trim();
  const items = safeItems(String(form.get("items") ?? ""));
  if (!(file instanceof File) || !validOrk(file) || !Number.isInteger(baseVersion) || summary.length < 8 || summary.length > 4000 || !items) {
    return Response.json({ error: "The proposed ORK, summary or component rationales are incomplete." }, { status: 400 });
  }
  const workspace = await DB.prepare(`SELECT version, sha256 FROM ork_workspaces WHERE project_id = ?`)
    .bind(project.id).first<{ version: number; sha256: string }>();
  if (!workspace) return Response.json({ error: "Import the first project ORK before proposing a replacement." }, { status: 409 });
  if (workspace.version !== baseVersion) return Response.json({ error: `The working copy advanced to W${workspace.version}. Download it and rebuild this proposal before submitting.`, currentVersion: workspace.version }, { status: 409 });
  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  if (sha256 === workspace.sha256) return Response.json({ error: "This file is identical to the current working ORK." }, { status: 409 });
  const duplicate = await DB.prepare(`SELECT id FROM ork_change_proposals WHERE project_id = ? AND sha256 = ? AND status IN ('pending', 'approved') LIMIT 1`)
    .bind(project.id, sha256).first<{ id: string }>();
  if (duplicate) return Response.json({ error: "This exact ORK has already been submitted for review." }, { status: 409 });

  const proposalId = crypto.randomUUID();
  const objectKey = `${project.id}/proposals/${proposalId}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  if (!await reserveProjectStorage(project.id, file.size, 1)) return Response.json({ error: "This project has reached its 2 GB storage limit." }, { status: 413 });
  try {
    await FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/zip" } });
    const statements = [DB.prepare(`INSERT INTO ork_change_proposals
      (id, project_id, base_version, source_name, object_key, sha256, size_bytes, summary, changed_components, geometry_changes, submitted_by_name, submitted_by_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(proposalId, project.id, baseVersion, file.name, objectKey, sha256, file.size, summary, items.length, items.filter((item) => item.geometryChanged).length, user.displayName, user.email),
    ...items.map((item) => DB.prepare(`INSERT INTO ork_change_proposal_items
      (proposal_id, project_id, component_id, component_code, component_name, component_kind, change_type, geometry_changed, changes_json, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(proposalId, project.id, item.componentId, item.componentCode, item.componentName, item.componentKind, item.changeType, item.geometryChanged ? 1 : 0, JSON.stringify(item.changes), item.rationale))];
    await DB.batch(statements);
  } catch {
    await FILES.delete(objectKey);
    await releaseProjectStorage(project.id, file.size, 1);
    return Response.json({ error: "The proposed ORK could not be stored. The live file was not changed." }, { status: 503 });
  }
  return Response.json({ proposalId, proposals: await proposalState(project.id) }, { status: 201 });
}

export async function PUT(request: Request) {
  let body: { proposalId?: string; action?: "approve" | "reject"; reviewNotes?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "A review decision is required." }, { status: 400 }); }
  const result = await requireProjectAccess(request, "reviewOrkChange");
  if (!result.ok) return result.response;
  if (!body.proposalId || !["approve", "reject"].includes(body.action ?? "")) return Response.json({ error: "Select a pending proposal and decision." }, { status: 400 });
  const reviewNotes = body.reviewNotes?.trim() ?? "";
  if (reviewNotes.length > 4000 || body.action === "reject" && reviewNotes.length < 5) return Response.json({ error: "A concise rejection reason is required." }, { status: 400 });
  await ensureOrkSchema();
  const { DB, FILES } = getOrkEnvironment();
  const { project, user } = result.access;
  const proposal = await DB.prepare(`SELECT id, base_version AS baseVersion, source_name AS sourceName, object_key AS objectKey, sha256, status
    FROM ork_change_proposals WHERE id = ? AND project_id = ?`).bind(body.proposalId, project.id)
    .first<{ id: string; baseVersion: number; sourceName: string; objectKey: string; sha256: string; status: string }>();
  if (!proposal || proposal.status !== "pending") return Response.json({ error: "That ORK proposal is no longer awaiting review." }, { status: 409 });

  if (body.action === "reject") {
    const updated = await DB.prepare(`UPDATE ork_change_proposals SET status = 'rejected', reviewed_by_name = ?, reviewed_by_email = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
      WHERE id = ? AND project_id = ? AND status = 'pending'`).bind(user.displayName, user.email, reviewNotes, proposal.id, project.id).run();
    if (!(updated.meta.changes ?? 0)) return Response.json({ error: "This proposal was reviewed by someone else first." }, { status: 409 });
    return Response.json({ proposals: await proposalState(project.id) });
  }

  const workspace = await DB.prepare(`SELECT version FROM ork_workspaces WHERE project_id = ?`).bind(project.id).first<{ version: number }>();
  if (!workspace || workspace.version !== proposal.baseVersion) {
    await DB.prepare(`UPDATE ork_change_proposals SET status = 'conflict', reviewed_by_name = ?, reviewed_by_email = ?, reviewed_at = CURRENT_TIMESTAMP,
      review_notes = ? WHERE id = ? AND project_id = ? AND status = 'pending'`)
      .bind(user.displayName, user.email, `Working copy advanced from W${proposal.baseVersion} to W${workspace?.version ?? "unknown"}. Rebase and resubmit.`, proposal.id, project.id).run();
    return Response.json({ error: `This proposal was based on W${proposal.baseVersion}, but the working copy is now W${workspace?.version ?? "—"}. It has been marked as a conflict.`, currentVersion: workspace?.version, proposals: await proposalState(project.id) }, { status: 409 });
  }

  const nextVersion = workspace.version + 1;
  if (!await FILES.head(proposal.objectKey)) {
    return Response.json({ error: "The exact proposed ORK is no longer available. The working copy was not changed." }, { status: 503 });
  }
  const promoted = await DB.prepare(`UPDATE ork_workspaces SET source_name = ?, current_object_key = ?, version = ?, sha256 = ?, updated_by_name = ?, updated_by_email = ?, updated_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND version = ?`).bind(proposal.sourceName, proposal.objectKey, nextVersion, proposal.sha256, user.displayName, user.email, project.id, workspace.version).run();
  if (!(promoted.meta.changes ?? 0)) return Response.json({ error: "The working copy changed during approval. Reload the review queue." }, { status: 409 });

  const itemRows = await DB.prepare(`SELECT component_id AS componentId, component_code AS componentCode, changes_json AS changesJson
    FROM ork_change_proposal_items WHERE proposal_id = ? AND project_id = ? ORDER BY id`).bind(proposal.id, project.id).all<{ componentId: string; componentCode: string; changesJson: string }>();
  const changeStatements = itemRows.results.flatMap((item) => {
    let changes: ProposalField[] = [];
    try { changes = JSON.parse(item.changesJson) as ProposalField[]; } catch { /* proposal remains the full audit source */ }
    return changes.map((change) => DB.prepare(`INSERT OR IGNORE INTO ork_changes
      (project_id, version, component_id, component_code, field, previous_value, next_value, author_name, author_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(project.id, nextVersion, item.componentId, item.componentCode, change.field, change.previousValue, change.nextValue, user.displayName, user.email));
  }).slice(0, 90);
  await DB.batch([
    ...changeStatements,
    DB.prepare(`UPDATE ork_change_proposals SET status = 'approved', reviewed_by_name = ?, reviewed_by_email = ?, reviewed_at = CURRENT_TIMESTAMP,
      review_notes = ?, applied_version = ? WHERE id = ? AND project_id = ? AND status = 'pending'`)
      .bind(user.displayName, user.email, reviewNotes, nextVersion, proposal.id, project.id),
  ]);
  return Response.json({ appliedVersion: nextVersion, proposals: await proposalState(project.id) });
}

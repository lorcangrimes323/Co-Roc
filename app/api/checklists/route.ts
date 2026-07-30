import { ensureChecklistSchema, getChecklistEnvironment } from "../../../db/checklist-store";
import { requireProjectAccess } from "../access";

type ChecklistStep = {
  id: string; type: string; title: string; instruction: string; responsibility: string;
  signoff: string; critical: boolean; expectedResult: string; tools: string;
  part: null | { source: "ork" | "custom"; id: string; code: string; name: string };
};
type ChecklistSection = { id: string; title: string; description: string; steps: ChecklistStep[] };
type ChecklistDefinition = { sections: ChecklistSection[] };

const textValue = (value: unknown, limit: number) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function validateDefinition(input: unknown): ChecklistDefinition | null {
  if (!input || typeof input !== "object" || !Array.isArray((input as { sections?: unknown }).sections)) return null;
  const sections = (input as { sections: unknown[] }).sections;
  if (sections.length > 20) return null;
  let totalSteps = 0;
  const parsed = sections.map((section) => {
    if (!section || typeof section !== "object") return null;
    const candidate = section as { id?: unknown; title?: unknown; description?: unknown; steps?: unknown };
    if (!Array.isArray(candidate.steps)) return null;
    totalSteps += candidate.steps.length;
    if (totalSteps > 300) return null;
    const steps = candidate.steps.map((step) => {
      if (!step || typeof step !== "object") return null;
      const value = step as Record<string, unknown>;
      const rawPart = value.part && typeof value.part === "object" ? value.part as Record<string, unknown> : null;
      const source = rawPart?.source === "custom" ? "custom" : "ork";
      return {
        id: textValue(value.id, 80) || crypto.randomUUID(),
        type: ["action", "verification", "hold", "warning", "arming"].includes(String(value.type)) ? String(value.type) : "action",
        title: textValue(value.title, 180), instruction: textValue(value.instruction, 3000),
        responsibility: textValue(value.responsibility, 80),
        signoff: ["none", "initials", "initials-time", "dual"].includes(String(value.signoff)) ? String(value.signoff) : "initials",
        critical: Boolean(value.critical), expectedResult: textValue(value.expectedResult, 600), tools: textValue(value.tools, 400),
        part: rawPart ? { source, id: textValue(rawPart.id, 120), code: textValue(rawPart.code, 80), name: textValue(rawPart.name, 180) } : null,
      } satisfies ChecklistStep;
    });
    if (steps.some((step) => !step)) return null;
    return { id: textValue(candidate.id, 80) || crypto.randomUUID(), title: textValue(candidate.title, 140), description: textValue(candidate.description, 500), steps: steps as ChecklistStep[] };
  });
  if (parsed.some((section) => !section)) return null;
  return { sections: parsed as ChecklistSection[] };
}

function emptyDefinition(): ChecklistDefinition {
  return { sections: [
    { id: crypto.randomUUID(), title: "Vehicle assembly", description: "Mechanical assembly in controlled sequence.", steps: [] },
    { id: crypto.randomUUID(), title: "Avionics & power", description: "Power, continuity and flight-computer verification.", steps: [] },
    { id: crypto.randomUUID(), title: "Recovery systems", description: "Recovery packing, retention and deployment checks.", steps: [] },
    { id: crypto.randomUUID(), title: "Pad integration", description: "Rail, ground support and final pad configuration.", steps: [] },
    { id: crypto.randomUUID(), title: "Arming procedure", description: "Controlled arming sequence and safe-state hold points.", steps: [] },
    { id: crypto.randomUUID(), title: "Launch approval", description: "Final status poll and authority to proceed.", steps: [] },
  ] };
}

async function state(projectId: string) {
  const { DB } = getChecklistEnvironment();
  const [checklists, customParts] = await Promise.all([
    DB.prepare(`SELECT id, title, mission, launch_site AS launchSite, scheduled_for AS scheduledFor, status, revision,
      baseline_release_number AS baselineReleaseNumber, definition_json AS definitionJson,
      created_by_name AS createdByName, updated_by_name AS updatedByName, created_at AS createdAt, updated_at AS updatedAt,
      released_by_name AS releasedByName, released_at AS releasedAt
      FROM launch_checklists WHERE project_id = ? ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, updated_at DESC`).bind(projectId).all(),
    DB.prepare(`SELECT id, code, name, category, description, created_by_name AS createdByName, created_at AS createdAt
      FROM checklist_custom_parts WHERE project_id = ? ORDER BY category, name`).bind(projectId).all(),
  ]);
  return {
    checklists: checklists.results.map((row) => {
      const item = row as Record<string, unknown>;
      try { return { ...item, definition: JSON.parse(String(item.definitionJson)), definitionJson: undefined }; }
      catch { return { ...item, definition: emptyDefinition(), definitionJson: undefined }; }
    }),
    customParts: customParts.results,
  };
}

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  await ensureChecklistSchema();
  return Response.json(await state(result.access.project.id));
}

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const action = textValue(body.action, 40);
  const permission = action === "release" ? "releaseChecklist" : "editChecklist";
  const result = await requireProjectAccess(request, permission);
  if (!result.ok) return result.response;
  await ensureChecklistSchema();
  const { DB } = getChecklistEnvironment();
  const { project, user } = result.access;

  if (action === "create") {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await DB.prepare(`INSERT INTO launch_checklists
      (id, project_id, title, mission, launch_site, scheduled_for, definition_json, created_by_name, created_by_email, updated_by_name, updated_by_email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, project.id, textValue(body.title, 180) || "New launch checklist", textValue(body.mission, 180), textValue(body.launchSite, 180), textValue(body.scheduledFor, 60) || null, JSON.stringify(emptyDefinition()), user.displayName, user.email, user.displayName, user.email, now, now).run();
    return Response.json({ ...(await state(project.id)), selectedId: id }, { status: 201 });
  }

  if (action === "custom-part") {
    const code = textValue(body.code, 80).toUpperCase();
    const name = textValue(body.name, 180);
    if (!code || !name) return Response.json({ error: "Custom equipment needs a code and name." }, { status: 400 });
    try {
      await DB.prepare(`INSERT INTO checklist_custom_parts (id, project_id, code, name, category, description, created_by_name, created_by_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), project.id, code, name, textValue(body.category, 120) || "Ground support equipment", textValue(body.description, 500), user.displayName, user.email).run();
    } catch { return Response.json({ error: `Equipment code ${code} already exists.` }, { status: 409 }); }
    return Response.json(await state(project.id), { status: 201 });
  }

  const checklistId = textValue(body.checklistId, 80);
  const existing = await DB.prepare(`SELECT id, status, revision, title, mission, launch_site AS launchSite, scheduled_for AS scheduledFor,
    baseline_release_number AS baselineReleaseNumber, definition_json AS definitionJson, updated_at AS updatedAt
    FROM launch_checklists WHERE id = ? AND project_id = ?`).bind(checklistId, project.id).first<Record<string, unknown>>();
  if (!existing) return Response.json({ error: "Checklist not found." }, { status: 404 });

  if (action === "save") {
    if (existing.status === "released") return Response.json({ error: "Released checklists are immutable. Create a new revision before editing." }, { status: 409 });
    const definition = validateDefinition(body.definition);
    if (!definition) return Response.json({ error: "Checklist structure is invalid or exceeds the engineering limits." }, { status: 400 });
    const baseUpdatedAt = textValue(body.baseUpdatedAt, 80);
    if (baseUpdatedAt && baseUpdatedAt !== existing.updatedAt) return Response.json({ error: "A teammate updated this checklist. Reload before saving your changes.", code: "CONFLICT" }, { status: 409 });
    const now = new Date().toISOString();
    await DB.prepare(`UPDATE launch_checklists SET title = ?, mission = ?, launch_site = ?, scheduled_for = ?, baseline_release_number = ?, definition_json = ?, updated_by_name = ?, updated_by_email = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
      .bind(textValue(body.title, 180) || existing.title, textValue(body.mission, 180), textValue(body.launchSite, 180), textValue(body.scheduledFor, 60) || null, Number.isFinite(Number(body.baselineReleaseNumber)) ? Number(body.baselineReleaseNumber) : null, JSON.stringify(definition), user.displayName, user.email, now, checklistId, project.id).run();
    return Response.json({ ...(await state(project.id)), selectedId: checklistId });
  }

  if (action === "release") {
    if (existing.status === "released") return Response.json({ error: "This checklist revision is already released." }, { status: 409 });
    const definition = validateDefinition(JSON.parse(String(existing.definitionJson)));
    const stepCount = definition?.sections.reduce((total, section) => total + section.steps.length, 0) ?? 0;
    const armingSteps = definition?.sections.flatMap((section) => section.steps).filter((step) => step.type === "arming").length ?? 0;
    if (stepCount < 1 || armingSteps < 1) return Response.json({ error: "A released launch checklist must contain steps and at least one controlled arming action." }, { status: 409 });
    const now = new Date().toISOString();
    await DB.prepare(`UPDATE launch_checklists SET status = 'released', released_by_name = ?, released_by_email = ?, released_at = ?, updated_by_name = ?, updated_by_email = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
      .bind(user.displayName, user.email, now, user.displayName, user.email, now, checklistId, project.id).run();
    return Response.json({ ...(await state(project.id)), selectedId: checklistId });
  }

  if (action === "new-revision") {
    if (existing.status !== "released") return Response.json({ error: "Save the current draft instead of duplicating it." }, { status: 409 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await DB.prepare(`INSERT INTO launch_checklists
      (id, project_id, title, mission, launch_site, scheduled_for, status, revision, baseline_release_number, definition_json, created_by_name, created_by_email, updated_by_name, updated_by_email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, project.id, existing.title, existing.mission, existing.launchSite, existing.scheduledFor || null, Number(existing.revision) + 1, existing.baselineReleaseNumber || null, existing.definitionJson, user.displayName, user.email, user.displayName, user.email, now, now).run();
    return Response.json({ ...(await state(project.id)), selectedId: id }, { status: 201 });
  }

  return Response.json({ error: "Unsupported checklist action." }, { status: 400 });
}

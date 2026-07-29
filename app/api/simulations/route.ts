import { ensureOrkSchema } from "../../../db/ork-store";
import { releaseProjectStorage, reserveProjectStorage } from "../../../db/access-store";
import { ensureSimulationSchema, getSimulationEnvironment } from "../../../db/simulation-store";
import { requireProjectAccess } from "../access";

type WorkspaceRow = {
  current_object_key: string;
  version: number;
  sha256: string;
};

type SimulationResponse = {
  engine: string;
  engineVersion: string;
  calculatedAt: string;
  simulationIndex: number;
  name: string;
  status: string;
  branchName: string;
  conditions: Record<string, unknown>;
  summary: Record<string, number | null>;
  warnings: Array<{ type: string; priority: string; description: string }>;
  events: Array<{ type: string; time: number }>;
  series: Array<Record<string, number | null>>;
};

function rowToCamel(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    value,
  ]));
}

function serviceConfiguration(request: Request) {
  const { OPENROCKET_SIM_URL, OPENROCKET_SIM_TOKEN } = getSimulationEnvironment();
  const hostname = new URL(request.url).hostname;
  const localPreview = hostname === "localhost" || hostname === "127.0.0.1";
  return {
    url: OPENROCKET_SIM_URL?.replace(/\/$/, "") || (localPreview ? "http://127.0.0.1:8080" : ""),
    token: OPENROCKET_SIM_TOKEN || "",
    localPreview,
  };
}

function encodedOptions(options: unknown) {
  if (!options || typeof options !== "object") return "";
  const bytes = new TextEncoder().encode(JSON.stringify(options));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isDemoRequest(request: Request) {
  return new URL(request.url).searchParams.get("demo") === "1";
}

export async function GET(request: Request) {
  const service = serviceConfiguration(request);
  if (isDemoRequest(request)) return Response.json({ configured: Boolean(service.url), runs: [] });
  const access = await requireProjectAccess(request, "view");
  if (!access.ok) return access.response;
  await ensureSimulationSchema();
  const { DB, FILES } = getSimulationEnvironment();
  const projectId = access.access.project.id;
  const runId = new URL(request.url).searchParams.get("runId")?.trim();
  if (runId) {
    const row = await DB.prepare(`SELECT result_object_key FROM simulation_runs WHERE id = ? AND project_id = ?`)
      .bind(runId, projectId).first<{ result_object_key: string }>();
    if (!row) return Response.json({ error: "Simulation run not found." }, { status: 404 });
    const object = await FILES.get(row.result_object_key);
    if (!object) return Response.json({ error: "Stored simulation result is missing." }, { status: 503 });
    return new Response(object.body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  }
  const rows = await DB.prepare(`SELECT id, ork_version, ork_sha256, simulation_index, simulation_name,
      engine, engine_version, max_altitude, max_velocity, max_acceleration, max_mach,
      warning_count, run_by_name, created_at
    FROM simulation_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 30`)
    .bind(projectId).all<Record<string, unknown>>();
  return Response.json({ configured: Boolean(service.url), runs: rows.results.map(rowToCamel) });
}

export async function POST(request: Request) {
  const service = serviceConfiguration(request);
  if (!service.url) {
    return Response.json({ error: "The official OpenRocket Core service is not configured for this deployment.", code: "SOLVER_OFFLINE" }, { status: 503 });
  }
  const contentType = request.headers.get("content-type") || "";
  const previewBytes = contentType.includes("application/octet-stream") ? await request.arrayBuffer() : null;
  const demoRequest = Boolean(previewBytes) && isDemoRequest(request);
  const access = demoRequest ? null : await requireProjectAccess(request, "editOrk");
  if (access && !access.ok) return access.response;
  const body = previewBytes ? {} : await request.json().catch(() => ({})) as { simulationIndex?: unknown; options?: unknown };
  const simulationIndex = Number(previewBytes ? request.headers.get("x-simulation-index") ?? 0 : body.simulationIndex ?? 0);
  let options: unknown = body.options;
  if (previewBytes) {
    try { options = JSON.parse(request.headers.get("x-simulation-options") || "{}"); }
    catch { return Response.json({ error: "Simulation options are not valid JSON." }, { status: 400 }); }
  }
  if (!Number.isInteger(simulationIndex) || simulationIndex < 0 || simulationIndex > 100) {
    return Response.json({ error: "A valid simulation index is required." }, { status: 400 });
  }
  if (previewBytes && previewBytes.byteLength > 2_000_000) {
    return Response.json({ error: "Demo simulations are limited to 2 MB OpenRocket files." }, { status: 413 });
  }

  await ensureOrkSchema();
  await ensureSimulationSchema();
  const { DB, FILES } = getSimulationEnvironment();
  const projectId = access?.access.project.id ?? "demo-banshee";
  const workspace = previewBytes ? null : await DB.prepare(`SELECT current_object_key, version, sha256 FROM ork_workspaces WHERE project_id = ?`)
    .bind(projectId).first<WorkspaceRow>();
  if (!previewBytes && !workspace) return Response.json({ error: "Import an .ork file before running a simulation." }, { status: 404 });
  const ork = workspace ? await FILES.get(workspace.current_object_key) : null;
  if (!previewBytes && !ork) return Response.json({ error: "The current .ork file is missing." }, { status: 503 });
  if (previewBytes && !demoRequest) {
    return Response.json({ error: "Untracked simulations are only available in demo mode." }, { status: 403 });
  }

  let solverResponse: Response;
  try {
    solverResponse = await fetch(`${service.url}/simulate?index=${simulationIndex}`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        ...(service.token ? { authorization: `Bearer ${service.token}` } : {}),
        ...(encodedOptions(options) ? { "x-openrocket-options": encodedOptions(options) } : {}),
      },
      body: previewBytes ?? await ork!.arrayBuffer(),
      // Free solver instances have a small CPU allocation and may need several
      // minutes for complex high-power configurations. Keep the request bounded,
      // but do not discard a valid OpenRocket run at the former two-minute limit.
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    return Response.json({ error: "The OpenRocket Core service could not be reached.", code: "SOLVER_OFFLINE" }, { status: 503 });
  }
  const payload = await solverResponse.text();
  if (!solverResponse.ok) {
    return new Response(payload, { status: solverResponse.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }

  const result = JSON.parse(payload) as SimulationResponse;
  if (previewBytes) return Response.json({ result, demo: true }, { status: 200 });
  const bytes = new TextEncoder().encode(payload);
  const runId = crypto.randomUUID();
  const objectKey = `${projectId}/simulations/${runId}.json`;
  if (!await reserveProjectStorage(projectId, bytes.byteLength, 1)) {
    return Response.json({ error: "This project has reached its storage limit." }, { status: 413 });
  }
  try {
    await FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/json" } });
    await DB.prepare(`INSERT INTO simulation_runs (
      id, project_id, ork_version, ork_sha256, simulation_index, simulation_name,
      engine, engine_version, result_object_key, max_altitude, max_velocity,
      max_acceleration, max_mach, warning_count, run_by_name, run_by_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        runId, projectId, workspace!.version, workspace!.sha256, simulationIndex, result.name,
        result.engine, result.engineVersion, objectKey, result.summary.maxAltitude,
        result.summary.maxVelocity, result.summary.maxAcceleration, result.summary.maxMach,
        result.warnings.length, access!.access.user.displayName, access!.access.user.email,
      ).run();
  } catch {
    await FILES.delete(objectKey);
    await releaseProjectStorage(projectId, bytes.byteLength, 1);
    return Response.json({ error: "The simulation completed but its traceable result could not be stored." }, { status: 503 });
  }
  return Response.json({ runId, orkVersion: workspace!.version, orkSha256: workspace!.sha256, result }, { status: 201 });
}

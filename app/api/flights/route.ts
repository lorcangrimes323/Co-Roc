import { ensureFlightSchema, getFlightEnvironment } from "../../../db/flight-store";
import { releaseProjectStorage, reserveProjectStorage } from "../../../db/access-store";
import { buildCatsCflFlightData, buildFlightData, isCatsCfl, type FlightColumnMapping } from "../../../lib/flight-data";
import { requireProjectAccess } from "../access";

const MAX_FLIGHT_BYTES = 24 * 1024 * 1024;
const value = (input: FormDataEntryValue | null, fallback = "") => typeof input === "string" ? input.trim() : fallback;
const finite = (input: FormDataEntryValue | null, fallback = 0) => Number.isFinite(Number(input)) ? Number(input) : fallback;

async function list(projectId: string) {
  const { DB } = getFlightEnvironment();
  const result = await DB.prepare(`SELECT id, name, flight_date AS flightDate, computer, source_file_name AS sourceFileName, source_format AS sourceFormat,
    launch_site_name AS launchSiteName, launch_latitude AS launchLatitude, launch_longitude AS launchLongitude,
    launch_altitude AS launchAltitude, heading_degrees AS headingDegrees, ork_version AS orkVersion,
    sample_count AS sampleCount, duration, max_altitude AS maxAltitude, max_velocity AS maxVelocity,
    max_acceleration AS maxAcceleration, max_distance AS maxDistance, landing_distance AS landingDistance,
    has_gps AS hasGps, warnings_json AS warningsJson, imported_by_name AS importedByName, created_at AS createdAt
    FROM flight_records WHERE project_id = ? ORDER BY COALESCE(flight_date, created_at) DESC, created_at DESC`).bind(projectId).all();
  return result.results.map((row) => {
    const item = row as Record<string, unknown>;
    let warnings: string[] = [];
    try { warnings = JSON.parse(String(item.warningsJson)); } catch { /* keep an empty warning list */ }
    return { ...item, hasGps: Boolean(item.hasGps), warnings, warningsJson: undefined };
  });
}

export async function GET(request: Request) {
  const result = await requireProjectAccess(request, "view");
  if (!result.ok) return result.response;
  await ensureFlightSchema();
  const url = new URL(request.url);
  const flightId = url.searchParams.get("flightId");
  if (!flightId) return Response.json({ flights: await list(result.access.project.id) });
  const { DB, FILES } = getFlightEnvironment();
  const row = await DB.prepare(`SELECT processed_object_key AS processedObjectKey, raw_object_key AS rawObjectKey,
    source_format AS sourceFormat, launch_latitude AS launchLatitude, launch_longitude AS launchLongitude,
    launch_altitude AS launchAltitude, heading_degrees AS headingDegrees, mapping_json AS mappingJson,
    processed_size_bytes AS processedSizeBytes
    FROM flight_records WHERE id = ? AND project_id = ?`)
    .bind(flightId, result.access.project.id).first<{ processedObjectKey: string; rawObjectKey: string; sourceFormat: string; launchLatitude: number; launchLongitude: number; launchAltitude: number; headingDegrees: number; mappingJson: string; processedSizeBytes: number }>();
  if (!row) return Response.json({ error: "Flight record not found." }, { status: 404 });
  const object = await FILES.get(row.processedObjectKey);
  if (!object) return Response.json({ error: "Flight trajectory is temporarily unavailable." }, { status: 503 });
  const existing = await object.text();
  try {
    const decoded = JSON.parse(existing) as { parserVersion?: number };
    if (row.sourceFormat !== "CFL" || decoded.parserVersion === 2) {
      return new Response(existing, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
    }
    const raw = await FILES.get(row.rawObjectKey);
    if (!raw) throw new Error("The original CFL is unavailable.");
    let mapping: FlightColumnMapping = {};
    try { mapping = JSON.parse(row.mappingJson || "{}"); } catch { /* native CFL mappings are automatic */ }
    const parsed = buildCatsCflFlightData(await raw.arrayBuffer(), {
      mapping,
      launchLatitude: Number(row.launchLatitude),
      launchLongitude: Number(row.launchLongitude),
      launchAltitude: Number(row.launchAltitude),
      headingDegrees: Number(row.headingDegrees),
    });
    const rebuilt = JSON.stringify({ parserVersion: 2, points: parsed.points, gnssPoints: parsed.gnssPoints, summary: parsed.summary, mapping: parsed.mapping, columns: parsed.columns, warnings: parsed.warnings, sourceRows: parsed.sourceRows, sourceFormat: "CFL", firmwareVersion: parsed.firmwareVersion, events: parsed.events });
    const rebuiltBytes = new TextEncoder().encode(rebuilt).byteLength;
    const difference = rebuiltBytes - Number(row.processedSizeBytes || 0);
    if (difference <= 0 || await reserveProjectStorage(result.access.project.id, difference, 0)) {
      await FILES.put(row.processedObjectKey, rebuilt, { httpMetadata: { contentType: "application/json" }, customMetadata: { projectId: result.access.project.id, flightId, kind: "processed-flight", parserVersion: "2" } });
      await DB.prepare(`UPDATE flight_records SET processed_size_bytes = ?, sample_count = ?, duration = ?, max_altitude = ?, max_velocity = ?, max_acceleration = ?, max_distance = ?, landing_distance = ?, has_gps = ? WHERE id = ? AND project_id = ?`)
        .bind(rebuiltBytes, parsed.summary.sampleCount, parsed.summary.duration, parsed.summary.apogee, parsed.summary.maxVelocity, parsed.summary.maxAcceleration, parsed.summary.maxDistance, parsed.summary.landingDistance, parsed.summary.hasGps ? 1 : 0, flightId, result.access.project.id).run();
      if (difference < 0) await releaseProjectStorage(result.access.project.id, -difference, 0);
    }
    return new Response(rebuilt, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } catch {
    return new Response(existing, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  const result = await requireProjectAccess(request, "uploadEvidence");
  if (!result.ok) return result.response;
  await ensureFlightSchema();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a CATS .cfl flight log." }, { status: 400 });
  if (file.size < 1 || file.size > MAX_FLIGHT_BYTES) return Response.json({ error: "Flight logs must be between 1 byte and 24 MB." }, { status: 413 });
  let mapping: FlightColumnMapping = {};
  try { mapping = JSON.parse(value(form.get("mapping"), "{}")); } catch { return Response.json({ error: "Column mapping is invalid." }, { status: 400 }); }
  let parsed;
  let sourceFormat: "CFL" | "CSV" = "CSV";
  const bytes = await file.arrayBuffer();
  try {
    const options = {
      mapping,
      launchLatitude: finite(form.get("launchLatitude")),
      launchLongitude: finite(form.get("launchLongitude")),
      launchAltitude: finite(form.get("launchAltitude")),
      headingDegrees: finite(form.get("headingDegrees")),
    };
    const nativeCfl = /\.cfl$/i.test(file.name) || isCatsCfl(bytes);
    if (nativeCfl && !isCatsCfl(bytes)) throw new Error("This .cfl file does not contain a recognised CATS binary flight log.");
    sourceFormat = nativeCfl ? "CFL" : "CSV";
    parsed = nativeCfl ? buildCatsCflFlightData(bytes, options) : buildFlightData(new TextDecoder().decode(bytes), options);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The flight data could not be parsed." }, { status: 400 });
  }
  const { DB, FILES } = getFlightEnvironment();
  const { project, user } = result.access;
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "flight.cfl";
  const rawKey = `projects/${project.id}/flights/${id}/raw-${safeName}`;
  const processedKey = `projects/${project.id}/flights/${id}/trajectory.json`;
  const processed = JSON.stringify({ parserVersion: 2, points: parsed.points, gnssPoints: parsed.gnssPoints, summary: parsed.summary, mapping: parsed.mapping, columns: parsed.columns, warnings: parsed.warnings, sourceRows: parsed.sourceRows, sourceFormat, firmwareVersion: parsed.firmwareVersion, events: parsed.events });
  const processedBytes = new TextEncoder().encode(processed).byteLength;
  const storageBytes = file.size + processedBytes;
  if (!await reserveProjectStorage(project.id, storageBytes, 2)) return Response.json({ error: "This project has reached its storage allowance." }, { status: 507 });
  try {
    await Promise.all([
      FILES.put(rawKey, bytes, { httpMetadata: { contentType: sourceFormat === "CFL" ? "application/octet-stream" : file.type || "text/csv" }, customMetadata: { projectId: project.id, flightId: id, kind: "raw-flight", sourceFormat } }),
      FILES.put(processedKey, processed, { httpMetadata: { contentType: "application/json" }, customMetadata: { projectId: project.id, flightId: id, kind: "processed-flight" } }),
    ]);
    await DB.prepare(`INSERT INTO flight_records
      (id, project_id, name, flight_date, computer, source_file_name, source_format, launch_site_name,
       launch_latitude, launch_longitude, launch_altitude, heading_degrees, ork_version, raw_object_key,
       processed_object_key, source_size_bytes, processed_size_bytes, sample_count, duration, max_altitude,
       max_velocity, max_acceleration, max_distance, landing_distance, has_gps, mapping_json, warnings_json,
       imported_by_name, imported_by_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, project.id, value(form.get("name"), file.name.replace(/\.[^.]+$/, "")), value(form.get("flightDate")) || null,
        value(form.get("computer"), "CATS Vega"), file.name, sourceFormat, value(form.get("launchSiteName")), finite(form.get("launchLatitude")),
        finite(form.get("launchLongitude")), finite(form.get("launchAltitude")), finite(form.get("headingDegrees")),
        Number.isFinite(Number(form.get("orkVersion"))) ? Number(form.get("orkVersion")) : null, rawKey, processedKey, file.size, processedBytes,
        parsed.summary.sampleCount, parsed.summary.duration, parsed.summary.apogee, parsed.summary.maxVelocity, parsed.summary.maxAcceleration,
        parsed.summary.maxDistance, parsed.summary.landingDistance, parsed.summary.hasGps ? 1 : 0, JSON.stringify(parsed.mapping),
        JSON.stringify(parsed.warnings), user.displayName, user.email).run();
  } catch (error) {
    await Promise.allSettled([FILES.delete(rawKey), FILES.delete(processedKey)]);
    await releaseProjectStorage(project.id, storageBytes, 2);
    return Response.json({ error: error instanceof Error ? error.message : "The flight record could not be stored." }, { status: 500 });
  }
  return Response.json({ flights: await list(project.id), selectedId: id }, { status: 201 });
}

export async function DELETE(request: Request) {
  const result = await requireProjectAccess(request, "manageProjects");
  if (!result.ok) return result.response;
  await ensureFlightSchema();
  const flightId = new URL(request.url).searchParams.get("flightId");
  const { DB, FILES } = getFlightEnvironment();
  const row = await DB.prepare(`SELECT raw_object_key AS rawObjectKey, processed_object_key AS processedObjectKey,
    source_size_bytes AS sourceSizeBytes, processed_size_bytes AS processedSizeBytes FROM flight_records WHERE id = ? AND project_id = ?`)
    .bind(flightId, result.access.project.id).first<{ rawObjectKey: string; processedObjectKey: string; sourceSizeBytes: number; processedSizeBytes: number }>();
  if (!row) return Response.json({ error: "Flight record not found." }, { status: 404 });
  await DB.prepare(`DELETE FROM flight_records WHERE id = ? AND project_id = ?`).bind(flightId, result.access.project.id).run();
  await Promise.allSettled([FILES.delete(row.rawObjectKey), FILES.delete(row.processedObjectKey)]);
  await releaseProjectStorage(result.access.project.id, Number(row.sourceSizeBytes) + Number(row.processedSizeBytes), 2);
  return Response.json({ flights: await list(result.access.project.id) });
}

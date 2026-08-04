"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { OpenRocketModel } from "../lib/openrocket";
import { buildCatsCflFlightData, buildFlightData, inferFlightMapping, inspectCatsCfl, isCatsCfl, parseFlightTable, simulatedGroundTrack, type CatsCflInspection, type CatsFlightEvent, type FlightChannel, type FlightColumnMapping, type FlightPoint, type FlightSummary } from "../lib/flight-data";
import { FlightPathMap } from "./flight-path-map";

type FlightRecord = Omit<FlightSummary, "apogee"> & {
  id: string; name: string; flightDate?: string | null; computer: string; sourceFileName: string; launchSiteName: string;
  launchLatitude: number; launchLongitude: number; launchAltitude: number; headingDegrees: number; orkVersion?: number | null;
  importedByName: string; createdAt: string; warnings: string[]; maxAltitude: number; sourceFormat?: "CFL" | "CSV";
};
type Trajectory = { points: FlightPoint[]; gnssPoints?: FlightPoint[]; mapping?: FlightColumnMapping; columns?: string[]; warnings?: string[]; sourceFormat?: "CFL" | "CSV"; firmwareVersion?: string; events?: CatsFlightEvent[]; summary?: FlightSummary; parserVersion?: number };
type Props = {
  model: OpenRocketModel | null;
  mode: "demo" | "live";
  workspaceVersion: number | null;
  headers: () => Record<string, string>;
  canImport: boolean;
  canDelete: boolean;
  theme: "light" | "dark";
  accent: string;
  onNotice: (message: string) => void;
};

const channelDetails: Array<{ key: FlightChannel; label: string; optional?: boolean }> = [
  { key: "time", label: "Elapsed time" }, { key: "altitude", label: "Altitude" },
  { key: "latitude", label: "GNSS latitude", optional: true }, { key: "longitude", label: "GNSS longitude", optional: true },
  { key: "velocity", label: "Total velocity", optional: true }, { key: "verticalVelocity", label: "Vertical velocity", optional: true },
  { key: "acceleration", label: "Acceleration", optional: true }, { key: "pressure", label: "Pressure", optional: true },
  { key: "temperature", label: "Temperature", optional: true }, { key: "battery", label: "Battery voltage", optional: true },
  { key: "north", label: "North offset", optional: true }, { key: "east", label: "East offset", optional: true },
];

function demoTrajectory() {
  const launch = { latitude: 54.4899, longitude: -6.0995, altitude: 62 };
  const points = Array.from({ length: 241 }, (_, index) => {
    const time = index * 0.8;
    const rise = 3900 * (1 - Math.exp(-time / 10.5));
    const altitudeAgl = time < 30 ? rise * (1 - Math.max(0, time - 22) / 22) : Math.max(0, 4050 * (1 - (time - 30) / 165));
    const north = Math.sin(time / 35) * 70 + time * 1.25;
    const east = time * 0.82 + Math.sin(time / 9) * 8;
    const earth = 6_378_137;
    return {
      time,
      latitude: launch.latitude + north / earth * 180 / Math.PI,
      longitude: launch.longitude + east / (earth * Math.cos(launch.latitude * Math.PI / 180)) * 180 / Math.PI,
      altitude: launch.altitude + altitudeAgl,
      velocity: time < 18 ? 390 * Math.sin(Math.PI * time / 36) : Math.max(7, 95 - time * .44),
      verticalVelocity: time < 30 ? 170 * Math.sin(Math.PI * time / 60) : -24,
      acceleration: time < 8 ? 146 * Math.sin(Math.PI * time / 16) : 9.8,
      pressure: 1012 * Math.exp(-altitudeAgl / 8500), temperature: 15 - altitudeAgl * .0065, battery: 8.35 - time * .0007,
    };
  });
  const summary: FlightSummary = { sampleCount: points.length, duration: points.at(-1)!.time, apogee: Math.max(...points.map((point) => point.altitude)), maxVelocity: 390, maxAcceleration: 146, maxDistance: 365, landingDistance: 342, hasGps: true };
  return { launch, points, summary };
}

const demo = demoTrajectory();
const demoEvents: CatsFlightEvent[] = [
  { time: 0.4, name: "Launch detected", action: 1, argument: 0 },
  { time: 6.4, name: "Motor burnout", action: 2, argument: 0 },
  { time: 30.4, name: "Apogee", action: 3, argument: 0 },
  { time: 31.2, name: "Drogue deployment", action: 4, argument: 0 },
  { time: 142.4, name: "Main deployment", action: 5, argument: 0 },
];
const demoRecord: FlightRecord = { id: "demo-banshee", name: "Banshee Mk II · Flight 02", flightDate: "2026-07-28", computer: "CATS Vega", sourceFileName: "banshee-flight-02.cfl", sourceFormat: "CFL", launchSiteName: "L4C approved range", launchLatitude: demo.launch.latitude, launchLongitude: demo.launch.longitude, launchAltitude: demo.launch.altitude, headingDegrees: 32, orkVersion: 5, importedByName: "Demo dataset", createdAt: "2026-07-28T12:14:00Z", warnings: [], sampleCount: demo.summary.sampleCount, duration: demo.summary.duration, maxAltitude: demo.summary.apogee, maxVelocity: demo.summary.maxVelocity, maxAcceleration: demo.summary.maxAcceleration, maxDistance: demo.summary.maxDistance, landingDistance: demo.summary.landingDistance, hasGps: demo.summary.hasGps };

function Metric({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail?: string }) {
  return <div className="flight-metric"><span>{label}</span><strong>{value} {unit && <small>{unit}</small>}</strong>{detail && <em>{detail}</em>}</div>;
}

function ChannelChart({ points, channel, label, colour }: { points: FlightPoint[]; channel: keyof FlightPoint; label: string; colour: string }) {
  const values = points.map((point) => Number(point[channel])).filter(Number.isFinite);
  if (values.length < 2) return <div className="flight-channel-empty">{label} was not present in this log.</div>;
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const available = points.filter((point) => Number.isFinite(Number(point[channel])));
  const path = available.map((point, index) => `${index ? "L" : "M"}${index / Math.max(1, available.length - 1) * 100},${38 - (Number(point[channel]) - min) / range * 34}`).join(" ");
  return <div className="flight-channel-chart"><header><strong>{label}</strong><span>{max.toFixed(1)} max</span></header><svg viewBox="0 0 100 40" preserveAspectRatio="none"><path d={path} fill="none" stroke={colour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg><footer><span>{min.toFixed(1)}</span><span>{max.toFixed(1)}</span></footer></div>;
}

function FlightTimeline({ points, events, duration, value, onChange }: { points: FlightPoint[]; events: CatsFlightEvent[]; duration: number; value: number; onChange: (index: number) => void }) {
  const visibleEvents = events.filter((event) => event.time >= 0 && event.time <= Math.max(duration, 0));
  const indexAtTime = (time: number) => {
    if (!points.length) return 0;
    let closest = 0;
    for (let index = 1; index < points.length; index += 1) if (Math.abs(points[index].time - time) < Math.abs(points[closest].time - time)) closest = index;
    return closest;
  };
  const jump = (time: number) => onChange(indexAtTime(time));
  return <div className="flight-playback-track">
    {visibleEvents.length > 0 && <div className="flight-event-key" aria-label="Flight events">{visibleEvents.map((event, index) => <button key={`key-${event.time}-${event.name}-${index}`} type="button" onClick={() => jump(event.time)}><b>{String(index + 1).padStart(2, "0")}</b><span>{event.name}<small>{event.time.toFixed(2)} s</small></span></button>)}</div>}
    <div className="flight-range-track"><input aria-label="Flight playback position" type="range" min="0" max={Math.max(0, points.length - 1)} value={value} onChange={(event) => onChange(Number(event.target.value))} />{visibleEvents.map((event, index) => <button key={`tick-${event.time}-${event.name}-${index}`} className="flight-timeline-event" type="button" style={{ left: `${Math.max(0, Math.min(100, event.time / Math.max(duration, .001) * 100))}%` } as CSSProperties} title={`${event.name} · ${event.time.toFixed(2)} s`} aria-label={`Jump to ${event.name} at ${event.time.toFixed(2)} seconds`} onClick={() => jump(event.time)}><i>{index + 1}</i></button>)}</div>
  </div>;
}

function FlightImportModal({ model, workspaceVersion, theme, accent, onCancel, onComplete, onNotice, mode, headers }: { model: OpenRocketModel | null; workspaceVersion: number | null; theme: "light" | "dark"; accent: string; onCancel: () => void; onComplete: (record?: FlightRecord, trajectory?: Trajectory) => void; onNotice: (message: string) => void; mode: "demo" | "live"; headers: () => Record<string, string> }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [cflBytes, setCflBytes] = useState<ArrayBuffer | null>(null);
  const [cflInspection, setCflInspection] = useState<CatsCflInspection | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<FlightColumnMapping>({});
  const firstSetup = model?.simulations[0];
  const [site, setSite] = useState({ name: "", latitude: firstSetup?.launchLatitude || 54.4899, longitude: firstSetup?.launchLongitude || -6.0995, altitude: firstSetup?.launchAltitude || 0, heading: firstSetup ? firstSetup.launchRodDirection * 180 / Math.PI : 0 });
  const [name, setName] = useState(""); const [flightDate, setFlightDate] = useState(""); const [computer, setComputer] = useState("CATS Vega");
  const [preview, setPreview] = useState<ReturnType<typeof buildFlightData> | null>(null); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);

  async function choose(next: File | null) {
    if (!next) return;
    setPreview(null); setError("");
    try {
      const bytes = await next.arrayBuffer();
      const nativeCfl = /\.cfl$/i.test(next.name) || isCatsCfl(bytes);
      if (nativeCfl) {
        if (!isCatsCfl(bytes)) throw new Error("This .cfl file does not contain a recognised CATS binary flight log.");
        const inspection = inspectCatsCfl(bytes);
        setCflBytes(bytes); setCflInspection(inspection); setText(""); setColumns(inspection.channels); setMapping({});
        if (inspection.launchLatitude !== undefined && inspection.launchLongitude !== undefined) {
          setSite((value) => ({ ...value, latitude: inspection.launchLatitude!, longitude: inspection.launchLongitude! }));
        }
      } else {
        const contents = new TextDecoder().decode(bytes);
        const table = parseFlightTable(contents);
        setCflBytes(null); setCflInspection(null); setText(contents); setColumns(table.columns); setMapping(inferFlightMapping(table.columns));
      }
      setFile(next); setName(next.name.replace(/\.[^.]+$/, ""));
    } catch (reason) {
      setFile(null); setCflBytes(null); setCflInspection(null); setColumns([]);
      setError(reason instanceof Error ? reason.message : "The flight log could not be read.");
    }
  }
  function buildPreview() {
    const options = { mapping, launchLatitude: site.latitude, launchLongitude: site.longitude, launchAltitude: site.altitude, headingDegrees: site.heading };
    return cflBytes ? buildCatsCflFlightData(cflBytes, options) : buildFlightData(text, options);
  }
  function rebuild() {
    try { setPreview(buildPreview()); setError(""); }
    catch (reason) { setPreview(null); setError(reason instanceof Error ? reason.message : "Preview failed."); }
  }
  async function save() {
    if (!file) { setError("Choose a CATS .cfl flight log first."); return; }
    let built = preview;
    if (!built) { try { built = buildPreview(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed."); return; } }
    if (mode === "demo") {
      onComplete({ id: `demo-${Date.now()}`, name: name || file.name, flightDate, computer, sourceFileName: file.name, sourceFormat: built.sourceFormat, launchSiteName: site.name, launchLatitude: site.latitude, launchLongitude: site.longitude, launchAltitude: site.altitude, headingDegrees: site.heading, orkVersion: workspaceVersion, importedByName: "Demo user", createdAt: new Date().toISOString(), warnings: built.warnings, sampleCount: built.summary.sampleCount, duration: built.summary.duration, maxAltitude: built.summary.apogee, maxVelocity: built.summary.maxVelocity, maxAcceleration: built.summary.maxAcceleration, maxDistance: built.summary.maxDistance, landingDistance: built.summary.landingDistance, hasGps: built.summary.hasGps }, { points: built.points, gnssPoints: built.gnssPoints, mapping: built.mapping, columns: built.columns, warnings: built.warnings, sourceFormat: built.sourceFormat, firmwareVersion: built.firmwareVersion, events: built.events, summary: built.summary, parserVersion: 2 });
      onNotice("Flight log reconstructed locally · demo data is not saved"); return;
    }
    setSaving(true); setError("");
    const form = new FormData();
    form.set("file", file); form.set("name", name); form.set("flightDate", flightDate); form.set("computer", computer); form.set("launchSiteName", site.name);
    form.set("launchLatitude", String(site.latitude)); form.set("launchLongitude", String(site.longitude)); form.set("launchAltitude", String(site.altitude)); form.set("headingDegrees", String(site.heading)); form.set("mapping", JSON.stringify(mapping)); form.set("orkVersion", String(workspaceVersion ?? ""));
    try {
      const response = await fetch("/api/flights", { method: "POST", headers: headers(), body: form });
      const payload = await response.json() as { error?: string; selectedId?: string; flights?: FlightRecord[] };
      if (!response.ok) throw new Error(payload.error || "Flight import failed.");
      onComplete(payload.flights?.find((item) => item.id === payload.selectedId), { points: built.points, gnssPoints: built.gnssPoints, mapping: built.mapping, columns: built.columns, warnings: built.warnings, sourceFormat: built.sourceFormat, firmwareVersion: built.firmwareVersion, events: built.events, summary: built.summary, parserVersion: 2 });
      onNotice(`${name || file.name} imported · ${built.summary.sampleCount.toLocaleString()} trajectory samples`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Flight import failed."); } finally { setSaving(false); }
  }
  return <div className="flight-modal-backdrop"><section className="flight-import-modal" role="dialog" aria-modal="true" aria-labelledby="flight-import-title">
    <header><div><span>POST-FLIGHT DATA</span><h2 id="flight-import-title">Import a CATS .CFL flight log</h2><p>Read the native Vega flight log, establish the launch datum and inspect the measured trajectory before it becomes part of the record.</p></div><button type="button" onClick={onCancel} aria-label="Close import">&times;</button></header>
    <div className="flight-import-grid"><div className="flight-import-form">
      <section><h3>1 · Native flight log</h3><label className="flight-file-picker" htmlFor="cats-flight-log"><strong>{file ? file.name : "Choose CATS .CFL file"}</strong><span>{file ? cflInspection ? `${(file.size / 1024).toFixed(1)} KB · firmware ${cflInspection.firmwareVersion} · ${cflInspection.sampleCount.toLocaleString()} estimates` : `${(file.size / 1024).toFixed(1)} KB · ${columns.length} columns detected` : "Native CATS binary logs; CSV remains available as a fallback"}</span></label><input id="cats-flight-log" className="visually-hidden" type="file" accept=".cfl,.csv,.txt,.tsv,application/octet-stream,text/csv,text/plain" onChange={(event) => void choose(event.target.files?.[0] ?? null)} />
        <div className="flight-basic-grid"><label>Flight name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Flight date<input type="date" value={flightDate} onChange={(event) => setFlightDate(event.target.value)} /></label><label>Flight computer<input value={computer} onChange={(event) => setComputer(event.target.value)} /></label></div></section>
      <section><h3>2 · Flight channels</h3>{cflInspection ? <div className="flight-native-channels"><div><strong>Native CATS CFL detected</strong><span>The binary channel definitions and SI scaling are applied automatically—no manual mapping is required.</span></div><dl><div><dt>Firmware</dt><dd>{cflInspection.firmwareVersion}</dd></div><div><dt>Duration</dt><dd>{cflInspection.duration.toFixed(1)} s</dd></div><div><dt>Events</dt><dd>{cflInspection.events.length}</dd></div><div><dt>Channels</dt><dd>{cflInspection.channels.join(" · ")}</dd></div></dl></div> : <div className="flight-mapping-grid">{channelDetails.map(({ key, label, optional }) => <label key={key}>{label}<small>{optional ? "OPTIONAL" : "REQUIRED"}</small><select value={mapping[key] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [key]: event.target.value || undefined }))}><option value="">Not mapped</option>{columns.map((column) => <option key={column}>{column}</option>)}</select></label>)}</div>}</section>
      <section><h3>3 · Launch datum</h3><div className="flight-basic-grid"><label>Site name<input value={site.name} onChange={(event) => setSite((value) => ({ ...value, name: event.target.value }))} placeholder="Approved range" /></label><label>Latitude<input type="number" step="0.000001" value={site.latitude} onChange={(event) => setSite((value) => ({ ...value, latitude: Number(event.target.value) }))} /></label><label>Longitude<input type="number" step="0.000001" value={site.longitude} onChange={(event) => setSite((value) => ({ ...value, longitude: Number(event.target.value) }))} /></label><label>Altitude MSL<input type="number" value={site.altitude} onChange={(event) => setSite((value) => ({ ...value, altitude: Number(event.target.value) }))} /></label><label>Launch heading<input type="number" min="0" max="360" value={site.heading} onChange={(event) => setSite((value) => ({ ...value, heading: Number(event.target.value) }))} /></label></div><FlightPathMap compact theme={theme} accent={accent} launchSite={{ latitude: site.latitude, longitude: site.longitude, altitude: site.altitude }} measured={preview?.gnssPoints ?? preview?.points ?? []} events={preview?.events ?? []} onLaunchSiteChange={({ latitude, longitude }) => setSite((value) => ({ ...value, latitude, longitude }))} /></section>
    </div><aside className="flight-import-preview"><span>RECONSTRUCTION CHECK</span>{preview ? <><Metric label="Valid samples" value={preview.summary.sampleCount.toLocaleString()} /><Metric label="Apogee" value={Math.round(preview.summary.apogee).toLocaleString()} unit="m MSL" /><Metric label="Ground track" value={Math.round(preview.summary.maxDistance).toLocaleString()} unit="m" />{preview.firmwareVersion && <Metric label="CATS firmware" value={preview.firmwareVersion} />}<div className="flight-import-warnings">{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}{!preview.warnings.length && <p className="flight-valid">Native CFL decoded; GNSS trajectory is ready to store.</p>}</div></> : <p>Choose a CFL, confirm its launch datum, then generate the preview.</p>}<button type="button" className="button button-secondary" disabled={!file} onClick={rebuild}>Generate preview</button></aside></div>
    {error && <div className="flight-import-error">{error}</div>}<footer><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="button" disabled={!file || saving} onClick={() => void save()}>{saving ? "Saving flight…" : "Add to flight record"}</button></footer>
  </section></div>;
}

export function PostFlightWorkspace({ model, mode, workspaceVersion, headers, canImport, canDelete, theme, accent, onNotice }: Props) {
  const [flights, setFlights] = useState<FlightRecord[]>(mode === "demo" ? [demoRecord] : []);
  const [selectedId, setSelectedId] = useState(mode === "demo" ? demoRecord.id : "");
  const [trajectories, setTrajectories] = useState<Record<string, Trajectory>>(mode === "demo" ? { [demoRecord.id]: { points: demo.points, events: demoEvents } } : {});
  const [importOpen, setImportOpen] = useState(false); const [loading, setLoading] = useState(mode === "live"); const [playing, setPlaying] = useState(false); const [timeIndex, setTimeIndex] = useState(0); const [showSimulation, setShowSimulation] = useState(false);
  const selected = flights.find((flight) => flight.id === selectedId) ?? flights[0]; const trajectory = selected ? trajectories[selected.id] : undefined;
  const simulation = model?.simulations.find((item) => item.series?.length);
  const simulated = useMemo(() => simulation?.series?.length && selected ? simulatedGroundTrack(simulation.series, { latitude: selected.launchLatitude, longitude: selected.launchLongitude, altitude: selected.launchAltitude, headingDegrees: Number.isFinite(simulation.launchRodDirection) ? simulation.launchRodDirection * 180 / Math.PI : selected.headingDegrees }) : [], [simulation, selected]);

  async function loadList() {
    if (mode !== "live") return;
    setLoading(true);
    try { const response = await fetch("/api/flights", { headers: headers(), cache: "no-store" }); const payload = await response.json() as { flights?: FlightRecord[] }; if (!response.ok) throw new Error(); setFlights(payload.flights ?? []); setSelectedId((current) => current || payload.flights?.[0]?.id || ""); }
    catch { onNotice("Post-flight records could not be loaded"); } finally { setLoading(false); }
  }
  useEffect(() => { void loadList(); }, [mode]);
  useEffect(() => {
    if (!selected || trajectories[selected.id] || mode !== "live") return;
    void (async () => { try { const response = await fetch(`/api/flights?flightId=${encodeURIComponent(selected.id)}`, { headers: headers(), cache: "no-store" }); if (!response.ok) throw new Error(); const data = await response.json() as Trajectory; setTrajectories((values) => ({ ...values, [selected.id]: data })); if (data.summary) setFlights((items) => items.map((item) => item.id === selected.id ? { ...item, sampleCount: data.summary!.sampleCount, duration: data.summary!.duration, maxAltitude: data.summary!.apogee, maxVelocity: data.summary!.maxVelocity, maxAcceleration: data.summary!.maxAcceleration, maxDistance: data.summary!.maxDistance, landingDistance: data.summary!.landingDistance, hasGps: data.summary!.hasGps } : item)); } catch { onNotice("The selected flight trajectory could not be loaded"); } })();
  }, [selected?.id, mode]);
  useEffect(() => { setTimeIndex(0); setPlaying(false); }, [selectedId]);
  useEffect(() => {
    const points = trajectory?.points;
    if (!playing || !points?.length) return;
    const firstIndex = Math.min(timeIndex, points.length - 1);
    const firstTime = points[firstIndex].time;
    const startedAt = performance.now();
    let frame = 0;
    const advance = (now: number) => {
      const targetTime = firstTime + (now - startedAt) / 1000;
      if (targetTime >= points.at(-1)!.time) {
        setTimeIndex(points.length - 1);
        setPlaying(false);
        return;
      }
      let low = firstIndex;
      let high = points.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high + 1) / 2);
        if (points[middle].time <= targetTime) low = middle;
        else high = middle - 1;
      }
      setTimeIndex(low);
      frame = window.requestAnimationFrame(advance);
    };
    frame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, trajectory?.points]);
  async function removeFlight() { if (!selected || !window.confirm(`Remove ${selected.name} and its stored telemetry? This cannot be undone.`)) return; const response = await fetch(`/api/flights?flightId=${encodeURIComponent(selected.id)}`, { method: "DELETE", headers: headers() }); const payload = await response.json() as { flights?: FlightRecord[]; error?: string }; if (!response.ok) { onNotice(payload.error || "Flight record could not be removed"); return; } setFlights(payload.flights ?? []); setSelectedId(payload.flights?.[0]?.id ?? ""); onNotice("Flight record removed"); }
  function complete(record?: FlightRecord, nextTrajectory?: Trajectory) { setImportOpen(false); if (!record) { void loadList(); return; } setFlights((items) => [record, ...items.filter((item) => item.id !== record.id)]); if (nextTrajectory) setTrajectories((items) => ({ ...items, [record.id]: nextTrajectory })); setSelectedId(record.id); }

  const active = trajectory?.points[Math.min(timeIndex, Math.max(0, (trajectory?.points.length ?? 1) - 1))];
  const mapPoints = trajectory?.gnssPoints?.length ? trajectory.gnssPoints : trajectory?.points ?? [];
  return <section className="workspace-module postflight-module"><header className="postflight-heading"><div><span>FLIGHT TEST DATA</span><h1>Post-flight visualisation</h1><p>Decode CATS Vega CFL logs, reconstruct measured flights on 3D terrain and retain the evidence against the working configuration.</p></div><button className="button button-primary" type="button" disabled={!canImport} onClick={() => setImportOpen(true)}>＋ Import .CFL flight</button></header>
    <div className="postflight-layout"><aside className="flight-record-list"><header><span>FLIGHT RECORDS</span><strong>{flights.length}</strong></header>{loading && <p>Loading flight records…</p>}{flights.map((flight) => <button key={flight.id} type="button" className={flight.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(flight.id)}><span>{flight.flightDate ? new Date(`${flight.flightDate}T12:00:00`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "UNDATED"}</span><strong>{flight.name}</strong><small>{flight.computer} · {flight.sampleCount.toLocaleString()} samples</small><em>{flight.sourceFormat === "CFL" ? "CATS CFL" : flight.hasGps ? "GNSS" : "RECONSTRUCTED"}</em></button>)}{!loading && !flights.length && <div className="flight-empty"><strong>No flight data yet</strong><span>Import the native .cfl log from a CATS Vega to start the post-flight record.</span></div>}</aside>
      <main className="flight-visualiser">{selected ? <><div className="flight-visualiser-bar"><div><span>MEASURED FLIGHT</span><h2>{selected.name}</h2><p>{selected.launchSiteName || `${selected.launchLatitude.toFixed(5)}, ${selected.launchLongitude.toFixed(5)}`} · linked to W{selected.orkVersion ?? "—"}</p></div><label><input type="checkbox" checked={showSimulation} disabled={!simulated.length} onChange={(event) => setShowSimulation(event.target.checked)} /> Simulation overlay</label></div>
        <FlightPathMap theme={theme} accent={accent} measured={mapPoints} simulated={showSimulation ? simulated : []} events={trajectory?.events ?? []} activePoint={active} launchSite={{ latitude: selected.launchLatitude, longitude: selected.launchLongitude, altitude: selected.launchAltitude }} />
        <div className="flight-playback"><button className="flight-playback-toggle" type="button" aria-label={playing ? "Pause flight" : "Play flight"} title={playing ? "Pause flight" : "Play flight"} aria-pressed={playing} disabled={!trajectory?.points.length} onClick={() => { if (playing) { setPlaying(false); return; } if (timeIndex >= (trajectory?.points.length ?? 1) - 1) setTimeIndex(0); setPlaying(true); }}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span></button><span>{active ? `${active.time.toFixed(1)} s` : "—"}</span><FlightTimeline points={trajectory?.points ?? []} events={trajectory?.events ?? []} duration={selected.duration} value={timeIndex} onChange={(index) => { setPlaying(false); setTimeIndex(index); }} /><span>{selected.duration.toFixed(1)} s</span></div></> : <div className="postflight-empty-map"><strong>Select or import a flight</strong><span>The 3D trajectory and flight channels will appear here.</span></div>}</main>
      <aside className="flight-inspector">{selected && <><header><span>FLIGHT SUMMARY</span><h2>{selected.name}</h2><p>{selected.sourceFileName}</p></header><div className="flight-metric-grid"><Metric label="Apogee" value={Math.round(selected.maxAltitude).toLocaleString()} unit="m" /><Metric label="Max speed" value={selected.maxVelocity === null ? "—" : selected.maxVelocity.toFixed(1)} unit="m/s" /><Metric label="Max accel." value={selected.maxAcceleration === null ? "—" : selected.maxAcceleration.toFixed(1)} unit="m/s²" /><Metric label="Ground range" value={Math.round(selected.maxDistance).toLocaleString()} unit="m" /></div><section className="flight-current-state"><span>CURSOR</span><dl><div><dt>Time</dt><dd>{active?.time.toFixed(2) ?? "—"} s</dd></div><div><dt>Altitude</dt><dd>{active ? Math.round(active.altitude).toLocaleString() : "—"} m</dd></div><div><dt>Velocity</dt><dd>{active?.velocity?.toFixed(1) ?? "—"} m/s</dd></div><div><dt>Position</dt><dd>{active ? `${active.latitude.toFixed(5)}, ${active.longitude.toFixed(5)}` : "—"}</dd></div></dl></section><div className="flight-charts"><ChannelChart points={trajectory?.points ?? []} channel="altitude" label="Altitude · m MSL" colour={accent} /><ChannelChart points={trajectory?.points ?? []} channel="velocity" label="Velocity · m/s" colour="#157f54" /><ChannelChart points={trajectory?.points ?? []} channel="acceleration" label="Acceleration · m/s²" colour="#b1721b" /></div>{trajectory?.events?.length ? <section className="flight-events"><span>CATS FLIGHT EVENTS</span>{trajectory.events.map((event, index) => <div key={`${event.time}-${event.name}-${index}`}><strong>{event.name}</strong><em>{event.time.toFixed(2)} s</em></div>)}</section> : null}<section className="flight-provenance"><span>TRACEABILITY</span><p><strong>Source</strong>{selected.sourceFormat ?? trajectory?.sourceFormat ?? "CSV"}</p>{trajectory?.firmwareVersion && <p><strong>CATS firmware</strong>{trajectory.firmwareVersion}</p>}<p><strong>Imported by</strong>{selected.importedByName}</p><p><strong>Working copy</strong>W{selected.orkVersion ?? "—"}</p><p><strong>Trajectory</strong>{selected.hasGps ? "Measured GNSS" : "Vertical reconstruction"}</p></section>{canDelete && mode === "live" && <button className="flight-delete" type="button" onClick={() => void removeFlight()}>Remove flight record</button>}</>}</aside></div>
    {importOpen && <FlightImportModal model={model} workspaceVersion={workspaceVersion} theme={theme} accent={accent} onCancel={() => setImportOpen(false)} onComplete={complete} onNotice={onNotice} mode={mode} headers={headers} />}
  </section>;
}

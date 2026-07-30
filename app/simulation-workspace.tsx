"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { encodeOpenRocketAsync, saveOpenRocketSimulation, saveOpenRocketSimulationResult, type OpenRocketModel, type OpenRocketSimulation, type OpenRocketSimulationSample, type OpenRocketSimulationSetup } from "../lib/openrocket";

type SimulationOptionsInput = OpenRocketSimulationSetup;

export type LiveResult = {
  engine: string;
  engineVersion: string;
  calculatedAt: string;
  simulationIndex: number;
  name: string;
  status: string;
  branchName: string;
  conditions: Record<string, unknown>;
  summary: Record<string, number | null>;
  warnings: OpenRocketSimulation["warnings"];
  events: OpenRocketSimulation["events"];
  series: OpenRocketSimulationSample[];
};

type RunRow = {
  id: string;
  orkVersion: number;
  simulationIndex: number;
  simulationName: string;
  engineVersion: string;
  maxAltitude: number | null;
  maxVelocity: number | null;
  maxMach: number | null;
  warningCount: number;
  runByName: string;
  createdAt: string;
};

function displayNumber(input: number | null | undefined, digits = 1) {
  return input == null || !Number.isFinite(input) ? "—" : input.toFixed(digits);
}

function finite(input: unknown, fallback: number) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function degrees(radians: number) {
  return Number.isFinite(radians) ? radians * 180 / Math.PI : 0;
}

function optionsFromSimulation(simulation: OpenRocketSimulation, name = simulation.name): SimulationOptionsInput {
  return {
    name,
    launchRodLength: simulation.launchRodLength,
    launchIntoWind: simulation.launchIntoWind,
    launchRodAngleDegrees: simulation.launchRodAngle,
    launchRodDirectionDegrees: simulation.launchRodDirection,
    windModelType: simulation.windModelType.toUpperCase().includes("MULTI") ? "MULTI_LEVEL" : "AVERAGE",
    windSpeed: simulation.windSpeed,
    windDeviation: simulation.windDeviation,
    windTurbulence: simulation.windTurbulence,
    windDirectionDegrees: degrees(simulation.windDirection),
    windAltitudeReference: "MSL",
    windLevels: simulation.windLevels.map((level) => ({ ...level, directionDegrees: degrees(level.direction) })),
    launchAltitude: simulation.launchAltitude,
    launchLatitude: simulation.launchLatitude,
    launchLongitude: simulation.launchLongitude,
    geodeticMethod: (["FLAT", "SPHERICAL", "WGS84"].includes(simulation.geodeticMethod.toUpperCase()) ? simulation.geodeticMethod.toUpperCase() : "SPHERICAL") as SimulationOptionsInput["geodeticMethod"],
    isaAtmosphere: simulation.isaAtmosphere,
    launchTemperatureC: Number.isFinite(simulation.launchTemperature) ? simulation.launchTemperature - 273.15 : 15,
    launchPressureHpa: Number.isFinite(simulation.launchPressure) ? simulation.launchPressure / 100 : 1013.25,
    timeStep: simulation.timeStep || 0.01,
    maxSimulationTime: simulation.maxSimulationTime || 1200,
    maxStepAngleDegrees: degrees(simulation.maxStepAngle || 0.0523598776),
    randomSeed: simulation.randomSeed || 0,
  };
}

function archivedSimulationBase(result: LiveResult): OpenRocketSimulation {
  const condition = (key: string, fallback: number) => finite(result.conditions[key], fallback);
  return {
    id: `archived-${result.simulationIndex}`,
    name: result.name,
    status: result.status,
    configurationId: "",
    branchName: result.branchName,
    windSpeed: condition("windSpeed", 0),
    launchRodLength: condition("launchRodLength", 0),
    launchIntoWind: false,
    launchRodAngle: 0,
    launchRodDirection: 0,
    launchAltitude: condition("launchAltitude", 0),
    launchLatitude: condition("launchLatitude", 0),
    launchLongitude: condition("launchLongitude", 0),
    geodeticMethod: "",
    isaAtmosphere: true,
    launchTemperature: 288.15,
    launchPressure: 101325,
    timeStep: condition("timeStep", 0.01),
    maxSimulationTime: 1200,
    maxStepAngle: 0.0523598776,
    randomSeed: 0,
    windModelType: "AVERAGE",
    windDeviation: 0,
    windTurbulence: 0,
    windDirection: 0,
    windLevels: [],
    maxAltitude: Number.NaN,
    maxVelocity: Number.NaN,
    maxAcceleration: Number.NaN,
    maxMach: Number.NaN,
    timeToApogee: Number.NaN,
    flightTime: Number.NaN,
    groundHitVelocity: Number.NaN,
    launchRodVelocity: Number.NaN,
    deploymentVelocity: Number.NaN,
    optimumDelay: Number.NaN,
    railExitStability: Number.NaN,
    railExitCg: Number.NaN,
    railExitCp: Number.NaN,
    launchMass: Number.NaN,
    launchMotorMass: Number.NaN,
    referenceMach: Number.NaN,
    referenceStability: Number.NaN,
    referenceCg: Number.NaN,
    referenceCp: Number.NaN,
    warnings: [],
    events: [],
    series: [],
  };
}

export function liveToSimulation(result: LiveResult, base: OpenRocketSimulation, modelDiameter?: number): OpenRocketSimulation {
  const summary = result.summary;
  const condition = (key: string, fallback: number) => finite(result.conditions[key], fallback);
  const referenceSample = result.series
    .filter((sample) => Number.isFinite(sample.mach) && Number.isFinite(sample.stability) && Number.isFinite(sample.cg) && Number.isFinite(sample.cp))
    .sort((left, right) => Math.abs(left.mach - 0.3) - Math.abs(right.mach - 0.3))[0];
  const launchSample = result.series.find((sample) => Number.isFinite(sample.mass));
  const motorMassSample = result.series.find((sample) => Number.isFinite(sample.motorMass));
  const referenceCg = finite(launchSample?.cg, finite(summary.launchCg, finite(summary.railExitCg, base.referenceCg)));
  const referenceCp = finite(referenceSample?.cp, finite(summary.railExitCp, base.referenceCp));
  const referenceDiameter = Number.isFinite(modelDiameter) && modelDiameter! > 0
    ? modelDiameter!
    : (base.referenceCp - base.referenceCg) / base.referenceStability;
  const referenceStability = Number.isFinite(referenceCg) && Number.isFinite(referenceCp) && Number.isFinite(referenceDiameter) && referenceDiameter > 0
    ? (referenceCp - referenceCg) / referenceDiameter
    : finite(referenceSample?.stability, finite(summary.railExitStability, base.referenceStability));
  return {
    ...base,
    id: base.id,
    name: result.name,
    status: result.status,
    branchName: base.branchName || result.branchName,
    windSpeed: condition("windSpeed", base.windSpeed),
    launchRodLength: condition("launchRodLength", base.launchRodLength),
    launchAltitude: condition("launchAltitude", base.launchAltitude),
    timeStep: condition("timeStep", base.timeStep),
    maxAltitude: finite(summary.maxAltitude, Number.NaN),
    maxVelocity: finite(summary.maxVelocity, Number.NaN),
    maxAcceleration: finite(summary.maxAcceleration, Number.NaN),
    maxMach: finite(summary.maxMach, Number.NaN),
    timeToApogee: finite(summary.timeToApogee, Number.NaN),
    flightTime: finite(summary.flightTime, Number.NaN),
    groundHitVelocity: finite(summary.groundHitVelocity, Number.NaN),
    launchRodVelocity: finite(summary.launchRodVelocity, Number.NaN),
    deploymentVelocity: finite(summary.deploymentVelocity, Number.NaN),
    optimumDelay: finite(summary.optimumDelay, Number.NaN),
    railExitStability: finite(summary.railExitStability, Number.NaN),
    railExitCg: finite(summary.railExitCg, Number.NaN),
    railExitCp: finite(summary.railExitCp, Number.NaN),
    launchMass: finite(launchSample?.mass, finite(summary.launchMass, base.launchMass)),
    launchMotorMass: finite(motorMassSample?.motorMass, finite(summary.launchMotorMass, base.launchMotorMass)),
    referenceMach: finite(referenceSample?.mach, base.referenceMach),
    referenceStability,
    referenceCg,
    referenceCp,
    warnings: result.warnings,
    events: result.events,
    series: result.series,
  };
}

function FlightChart({ samples, themeKey }: { samples: OpenRocketSimulationSample[]; themeKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    const width = rect.width;
    const height = rect.height;
    const pad = { left: 52, right: 18, top: 18, bottom: 30 };
    const plotWidth = Math.max(1, width - pad.left - pad.right);
    const plotHeight = Math.max(1, height - pad.top - pad.bottom);
    const styles = getComputedStyle(canvas);
    const text = styles.getPropertyValue("--muted").trim() || "#666";
    const line = styles.getPropertyValue("--line-strong").trim() || "#ddd";
    const accent = styles.getPropertyValue("--accent").trim() || "#c92335";
    context.clearRect(0, 0, width, height);
    const valid = samples.filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.altitude));
    const maxTime = Math.max(1, ...valid.map((sample) => sample.time));
    const maxAltitude = Math.max(1, ...valid.map((sample) => sample.altitude));
    context.strokeStyle = line;
    context.fillStyle = text;
    context.font = "10px monospace";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index++) {
      const y = pad.top + plotHeight * index / 4;
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
      context.fillText(`${Math.round(maxAltitude * (1 - index / 4))} m`, 4, y + 3);
    }
    for (let index = 0; index <= 5; index++) {
      const x = pad.left + plotWidth * index / 5;
      context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke();
      context.fillText(`${Math.round(maxTime * index / 5)} s`, x - 10, height - 9);
    }
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.beginPath();
    valid.forEach((sample, index) => {
      const x = pad.left + sample.time / maxTime * plotWidth;
      const y = pad.top + (1 - sample.altitude / maxAltitude) * plotHeight;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }, [samples, themeKey]);
  return <canvas ref={canvasRef} className="flight-chart" aria-label="Altitude against time" />;
}

function NumberField({ label, unit, value, min, max, step = "any", onChange }: { label: string; unit?: string; value: number; min?: number; max?: number; step?: number | "any"; onChange: (value: number) => void }) {
  return <label className="simulation-field"><span>{label}{unit && <small>{unit}</small>}</span><input type="number" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function SimulationEditor({ initial, title, onCancel, onSave }: { initial: SimulationOptionsInput; title: string; onCancel: () => void; onSave: (options: SimulationOptionsInput) => void }) {
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof SimulationOptionsInput>(key: K, next: SimulationOptionsInput[K]) => setDraft((current) => ({ ...current, [key]: next }));
  const setLevel = (index: number, key: keyof SimulationOptionsInput["windLevels"][number], next: number) => setDraft((current) => ({
    ...current,
    windLevels: current.windLevels.map((level, levelIndex) => levelIndex === index ? { ...level, [key]: next } : level),
  }));
  return <div className="simulation-editor-backdrop" role="presentation" onMouseDown={onCancel}>
    <form className="simulation-editor" role="dialog" aria-modal="true" aria-labelledby="simulation-editor-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <header><div><span className="eyebrow">OPENROCKET SIMULATION</span><h2 id="simulation-editor-title">{title}</h2><p>Conditions are passed directly to OpenRocket Core in SI units.</p></div><button type="button" aria-label="Close simulation editor" onClick={onCancel}>×</button></header>
      <div className="simulation-editor-body">
        <section><h3>Case</h3><label className="simulation-field wide"><span>Simulation name</span><input value={draft.name} required maxLength={80} onChange={(event) => set("name", event.target.value)} /></label></section>
        <section><h3>Launch guide</h3><div className="simulation-form-grid"><NumberField label="Rail / rod length" unit="m" value={draft.launchRodLength} min={0.01} max={1000} onChange={(next) => set("launchRodLength", next)} /><NumberField label="Angle from vertical" unit="deg" value={draft.launchRodAngleDegrees} min={0} max={30} onChange={(next) => set("launchRodAngleDegrees", next)} /><NumberField label="Direction" unit="deg" value={draft.launchRodDirectionDegrees} min={0} max={360} onChange={(next) => set("launchRodDirectionDegrees", next)} /><label className="simulation-check"><input type="checkbox" checked={draft.launchIntoWind} onChange={(event) => set("launchIntoWind", event.target.checked)} /><span>Automatically launch into wind</span></label></div></section>
        <section><h3>Wind model</h3><div className="simulation-form-grid"><label className="simulation-field"><span>Model</span><select value={draft.windModelType} onChange={(event) => set("windModelType", event.target.value as SimulationOptionsInput["windModelType"])}><option value="AVERAGE">Average wind</option><option value="MULTI_LEVEL">Multi-level wind</option></select></label>{draft.windModelType === "AVERAGE" ? <><NumberField label="Average speed" unit="m/s" value={draft.windSpeed} min={0} max={300} onChange={(next) => set("windSpeed", next)} /><NumberField label="Standard deviation" unit="m/s" value={draft.windDeviation} min={0} max={100} onChange={(next) => set("windDeviation", next)} /><NumberField label="Turbulence intensity" unit="0–1" value={draft.windTurbulence} min={0} max={1} step={0.01} onChange={(next) => set("windTurbulence", next)} /><NumberField label="Direction" unit="deg" value={draft.windDirectionDegrees} min={0} max={360} onChange={(next) => set("windDirectionDegrees", next)} /></> : <label className="simulation-field"><span>Altitude reference</span><select value={draft.windAltitudeReference} onChange={(event) => set("windAltitudeReference", event.target.value as "MSL" | "AGL")}><option value="MSL">Mean sea level</option><option value="AGL">Above ground</option></select></label>}</div>{draft.windModelType === "MULTI_LEVEL" && <div className="wind-levels"><header><span>ALTITUDE</span><span>SPEED</span><span>DIRECTION</span><span>STD. DEV.</span><span /></header>{draft.windLevels.map((level, index) => <div key={index}><input aria-label={`Wind level ${index + 1} altitude`} type="number" value={level.altitude} onChange={(event) => setLevel(index, "altitude", Number(event.target.value))} /><input aria-label={`Wind level ${index + 1} speed`} type="number" min="0" value={level.speed} onChange={(event) => setLevel(index, "speed", Number(event.target.value))} /><input aria-label={`Wind level ${index + 1} direction`} type="number" min="0" max="360" value={level.directionDegrees} onChange={(event) => setLevel(index, "directionDegrees", Number(event.target.value))} /><input aria-label={`Wind level ${index + 1} deviation`} type="number" min="0" value={level.standardDeviation} onChange={(event) => setLevel(index, "standardDeviation", Number(event.target.value))} /><button type="button" aria-label={`Remove wind level ${index + 1}`} onClick={() => set("windLevels", draft.windLevels.filter((_level, levelIndex) => levelIndex !== index))}>×</button></div>)}<button type="button" onClick={() => set("windLevels", [...draft.windLevels, { altitude: 0, speed: 0, directionDegrees: 0, standardDeviation: 0 }])}>+ Add wind level</button></div>}</section>
        <section><h3>Launch site &amp; Earth model</h3><div className="simulation-form-grid"><NumberField label="Altitude" unit="m MSL" value={draft.launchAltitude} min={-1000} max={100000} onChange={(next) => set("launchAltitude", next)} /><NumberField label="Latitude" unit="deg" value={draft.launchLatitude} min={-90} max={90} onChange={(next) => set("launchLatitude", next)} /><NumberField label="Longitude" unit="deg" value={draft.launchLongitude} min={-180} max={180} onChange={(next) => set("launchLongitude", next)} /><label className="simulation-field"><span>Geodetic calculation</span><select value={draft.geodeticMethod} onChange={(event) => set("geodeticMethod", event.target.value as SimulationOptionsInput["geodeticMethod"])}><option value="FLAT">Flat Earth</option><option value="SPHERICAL">Spherical Earth</option><option value="WGS84">WGS84 ellipsoid</option></select></label></div></section>
        <section><h3>Atmosphere</h3><div className="simulation-form-grid"><label className="simulation-check"><input type="checkbox" checked={draft.isaAtmosphere} onChange={(event) => set("isaAtmosphere", event.target.checked)} /><span>Use International Standard Atmosphere</span></label>{!draft.isaAtmosphere && <><NumberField label="Ground temperature" unit="°C" value={draft.launchTemperatureC} min={-90} max={70} onChange={(next) => set("launchTemperatureC", next)} /><NumberField label="Ground pressure" unit="hPa" value={draft.launchPressureHpa} min={100} max={1200} onChange={(next) => set("launchPressureHpa", next)} /></>}</div></section>
        <section><h3>Numerical integration</h3><div className="simulation-form-grid"><NumberField label="Time step" unit="s" value={draft.timeStep} min={0.001} max={1} step={0.001} onChange={(next) => set("timeStep", next)} /><NumberField label="Maximum simulation time" unit="s" value={draft.maxSimulationTime} min={1} max={86400} onChange={(next) => set("maxSimulationTime", next)} /><NumberField label="Maximum step angle" unit="deg" value={draft.maxStepAngleDegrees} min={0.01} max={30} onChange={(next) => set("maxStepAngleDegrees", next)} /><NumberField label="Random seed" value={draft.randomSeed} step={1} onChange={(next) => set("randomSeed", next)} /></div></section>
      </div>
      <footer><span>Motor, staging and recovery deployment remain controlled by the selected ORK flight configuration.</span><div><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit">Save case</button></div></footer>
    </form>
  </div>;
}

export function SimulationWorkspace({ model, mode, workspaceVersion, headers, canRun, runBlockedReason, onNotice, onModelChange, themeKey }: {
  model: OpenRocketModel | null;
  mode: "live" | "demo";
  workspaceVersion: number | null;
  headers: () => Record<string, string>;
  canRun: boolean;
  runBlockedReason?: string;
  onNotice: (message: string) => void;
  onModelChange: (model: OpenRocketModel, change: { simulationId: string; name: string; editing: boolean }) => void;
  themeKey: string;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<{ initial: SimulationOptionsInput; draftId?: string } | null>(null);
  const [calculated, setCalculated] = useState<OpenRocketSimulation | null>(null);
  const [calculatedAt, setCalculatedAt] = useState("");
  const [engineVersion, setEngineVersion] = useState("");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [configured, setConfigured] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState("");
  const [viewedRun, setViewedRun] = useState<RunRow | null>(null);
  const [error, setError] = useState("");
  const saved = useMemo(() => model?.simulations ?? [], [model]);
  const cases = useMemo(() => saved.map((simulation, sourceIndex) => ({
    id: simulation.id,
    sourceIndex,
    simulation,
    options: optionsFromSimulation(simulation),
    draft: simulation.status === "not_simulated",
  })), [saved]);
  const selectedCase = cases.find((item) => item.id === selectedId) ?? cases[0] ?? null;
  const selected = calculated ?? selectedCase?.simulation ?? null;
  const simulationEndpoint = mode === "demo" ? "/api/simulations?demo=1" : "/api/simulations";

  async function refreshRuns() {
    try {
      const response = await fetch(simulationEndpoint, { headers: headers(), cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { configured?: boolean; runs?: RunRow[] };
      setConfigured(Boolean(payload.configured));
      setRuns(mode === "live" ? payload.runs ?? [] : []);
    } catch { /* Saved ORK results remain available offline. */ }
  }

  useEffect(() => {
    let active = true;
    fetch(simulationEndpoint, { headers: headers(), cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ configured?: boolean; runs?: RunRow[] }> : null)
      .then((payload) => {
        if (!active || !payload) return;
        setConfigured(Boolean(payload.configured));
        setRuns(mode === "live" ? payload.runs ?? [] : []);
      })
      .catch(() => undefined);
    return () => { active = false; };
    // The parent keys this workspace by project/version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.sourceName, workspaceVersion, mode]);

  function openNewSimulation() {
    if (!selectedCase) return;
    const count = saved.length + 1;
    setEditor({ initial: { ...selectedCase.options, name: `Simulation ${count}`, windLevels: selectedCase.options.windLevels.map((level) => ({ ...level })) } });
  }

  function saveEditor(options: SimulationOptionsInput) {
    if (!model || !selectedCase) return;
    const editing = Boolean(editor?.draftId);
    const next = saveOpenRocketSimulation(model, selectedCase.sourceIndex, options, editor?.draftId);
    onModelChange(next.model, { simulationId: next.simulationId, name: options.name, editing });
    setSelectedId(next.simulationId);
    setCalculated(null);
    setViewedRun(null);
    setEditor(null);
    setError("");
    onNotice(`${options.name} saved to the working OpenRocket file`);
  }

  async function runSimulation() {
    if (!selectedCase || !model || !canRun || !configured) return;
    setRunning(true); setError("");
    try {
      let response: Response;
      if (mode === "demo") {
        const bytes = await encodeOpenRocketAsync(model);
        response = await fetch(simulationEndpoint, {
          method: "POST",
          headers: { ...headers(), "content-type": "application/octet-stream", "x-simulation-index": String(selectedCase.sourceIndex), "x-simulation-options": JSON.stringify(selectedCase.options) },
          body: bytes,
        });
      } else {
        response = await fetch(simulationEndpoint, {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ simulationIndex: selectedCase.sourceIndex, options: selectedCase.options }),
        });
      }
      let payload = await response.json() as { error?: string; detail?: string; failure?: { error?: string; detail?: string }; result?: LiveResult; jobId?: string; status?: string };
      if (response.status === 202 && payload.jobId) {
        const jobUrl = `${simulationEndpoint}${simulationEndpoint.includes("?") ? "&" : "?"}jobId=${encodeURIComponent(payload.jobId)}`;
        for (let attempt = 0; attempt < 450; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          response = await fetch(jobUrl, { headers: headers(), cache: "no-store" });
          payload = await response.json() as { error?: string; detail?: string; failure?: { error?: string; detail?: string }; result?: LiveResult; jobId?: string; status?: string };
          if (response.status !== 202) break;
        }
      }
      if (!response.ok || !payload.result) {
        const summary = payload.error || payload.failure?.error || "OpenRocket simulation failed";
        const detail = payload.detail || payload.failure?.detail;
        throw new Error(detail && detail !== summary ? `${summary}: ${detail}` : summary);
      }
      const completed = liveToSimulation(payload.result, selectedCase.simulation, model.maxRadius * 2);
      setCalculated(completed);
      setViewedRun(null);
      if (mode === "demo") {
        const persisted = saveOpenRocketSimulationResult(model, selectedCase.sourceIndex, completed);
        onModelChange(persisted.model, { simulationId: persisted.simulationId, name: completed.name, editing: true });
      }
      setCalculatedAt(payload.result.calculatedAt);
      setEngineVersion(payload.result.engineVersion);
      onNotice(mode === "live"
        ? `${payload.result.name} calculated and attached to working W${workspaceVersion ?? "—"}`
        : `${payload.result.name} calculated in the local demo ORK`);
      await refreshRuns();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "OpenRocket simulation failed";
      setError(message); onNotice(message);
    } finally { setRunning(false); }
  }

  async function openSavedRun(run: RunRow) {
    if (mode !== "live" || !model) return;
    const baseCase = cases[run.simulationIndex] ?? selectedCase ?? cases[0];
    setLoadingRunId(run.id);
    setError("");
    try {
      const response = await fetch(`${simulationEndpoint}?runId=${encodeURIComponent(run.id)}`, { headers: headers(), cache: "no-store" });
      const payload = await response.json() as LiveResult & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "The saved simulation result could not be loaded.");
      const completed = liveToSimulation(payload, baseCase?.simulation ?? archivedSimulationBase(payload), model.maxRadius * 2);
      if (baseCase) setSelectedId(baseCase.id);
      setCalculated(completed);
      setViewedRun(run);
      setCalculatedAt(payload.calculatedAt || run.createdAt);
      setEngineVersion(payload.engineVersion || run.engineVersion);
      onNotice(`${run.simulationName} loaded from working W${run.orkVersion}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The saved simulation result could not be loaded.";
      setError(message);
      onNotice(message);
    } finally {
      setLoadingRunId("");
    }
  }

  const status = useMemo(() => {
    if (viewedRun) return `ARCHIVED · W${viewedRun.orkVersion}`;
    if (calculated) return "CALCULATED NOW";
    if (selectedCase?.draft) return "DRAFT CASE";
    if (!selected) return "NO SAVED RESULT";
    return selected.status === "outdated" ? "SAVED · OUTDATED" : "SAVED IN .ORK";
  }, [calculated, selected, selectedCase, viewedRun]);

  return <section className="workspace-module simulation-module">
    <aside className="module-tree">
      <header><span className="eyebrow">FLIGHT CONFIGURATIONS</span><h2>Simulation cases</h2><button className="tree-new-simulation" type="button" disabled={!selectedCase || !canRun} onClick={openNewSimulation}>+ New simulation</button></header>
      <div className="module-tree-list">
        {cases.map((item, index) => <button key={item.id} className={item.id === selectedCase?.id ? "active" : ""} type="button" onClick={() => { setSelectedId(item.id); setCalculated(null); setViewedRun(null); setError(""); }}><span className="tree-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.simulation.name}</strong><small>{item.simulation.windSpeed.toFixed(1)} m/s wind · {item.draft ? "draft" : item.simulation.status}</small></span></button>)}
        {!cases.length && <div className="module-empty">No simulation definitions were found in this .ork file.</div>}
      </div>
      <footer>Saved definitions come from the working OpenRocket file. New cases use the selected flight configuration.</footer>
    </aside>
    <div className="simulation-content">
      <header className="module-titlebar"><div><span className="eyebrow">OPENROCKET CORE</span><h2>{selected?.name ?? "Simulation"}</h2><p>{selected ? `${selected.branchName} · ${selected.windSpeed.toFixed(1)} m/s wind · ${selected.launchRodLength.toFixed(1)} m rail` : "Upload a configured .ork file."}</p></div><div className="simulation-actions"><span className={`simulation-state ${selected?.status === "outdated" ? "warning" : ""}`}>{status}</span>{selectedCase?.draft && <button className="button button-secondary" type="button" onClick={() => setEditor({ initial: selectedCase.options, draftId: selectedCase.id })}>Edit setup</button>}<button className="button button-primary" type="button" disabled={!selected || !canRun || !configured || running} title={!configured ? "OpenRocket Core is not connected" : !canRun ? runBlockedReason : undefined} onClick={runSimulation}>{running ? "Running OpenRocket…" : "Run simulation"}</button></div></header>
      {!configured && <div className="solver-banner"><strong>Saved OpenRocket results are available.</strong><span>{mode === "demo" ? "Start the local OpenRocket Core service to execute new demo runs." : "Deploy and connect the verified Core service before executing new runs."}</span></div>}
      {configured && !canRun && runBlockedReason && <div className="solver-banner"><strong>Save the working ORK before calculation.</strong><span>{runBlockedReason}</span></div>}
      {configured && mode === "demo" && <div className="solver-banner"><strong>OpenRocket Core connected.</strong><span>Demo calculations use the hosted Java solver but are not written to team run history.</span></div>}
      {error && <div className="solver-error">{error}</div>}
      {selected ? <>
        <div className="simulation-metrics"><div><span>APOGEE</span><strong>{displayNumber(selected.maxAltitude, 0)} <small>m</small></strong></div><div><span>MAX SPEED</span><strong>{displayNumber(selected.maxVelocity)} <small>m/s</small></strong><em>Mach {displayNumber(selected.maxMach, 3)}</em></div><div><span>MAX ACCELERATION</span><strong>{displayNumber(selected.maxAcceleration)} <small>m/s²</small></strong></div><div><span>RAIL EXIT STABILITY</span><strong>{displayNumber(selected.railExitStability, 2)} <small>cal</small></strong><em>{displayNumber(selected.launchRodVelocity)} m/s</em></div><div><span>FLIGHT TIME</span><strong>{displayNumber(selected.flightTime)} <small>s</small></strong><em>{displayNumber(selected.groundHitVelocity)} m/s landing</em></div></div>
        <section className="chart-card"><header><div><span className="eyebrow">FLIGHT PROFILE</span><h3>Altitude against time</h3></div><span>{selected.series.length} samples · SI units</span></header><FlightChart samples={selected.series} themeKey={themeKey} /></section>
        <div className="simulation-detail-grid"><section><header><span className="eyebrow">CONDITIONS</span><h3>Launch inputs</h3></header><dl><div><dt>Wind speed</dt><dd>{displayNumber(selected.windSpeed)} m/s</dd></div><div><dt>Launch altitude</dt><dd>{displayNumber(selected.launchAltitude, 0)} m</dd></div><div><dt>Rail length</dt><dd>{displayNumber(selected.launchRodLength, 2)} m</dd></div><div><dt>Time step</dt><dd>{displayNumber(selected.timeStep, 3)} s</dd></div></dl></section><section><header><span className="eyebrow">WARNINGS</span><h3>{selected.warnings.length} engineering notices</h3></header><div className="simulation-warnings">{selected.warnings.map((warning, index) => <article key={`${warning.type}-${index}`}><span>{warning.priority}</span><p>{warning.description}</p></article>)}{!selected.warnings.length && <p className="module-empty">No warnings recorded.</p>}</div></section></div>
      </> : <div className="module-empty large">No simulation data to display.</div>}
    </div>
    <aside className="run-history"><header><span className="eyebrow">TRACEABLE RUNS</span><h2>Run history</h2></header>{runs.map((run) => <button key={run.id} type="button" aria-label={`Open ${run.simulationName} calculated against working W${run.orkVersion}`} disabled={Boolean(loadingRunId)} onClick={() => openSavedRun(run)} className={`${run.orkVersion === workspaceVersion ? "run-current-version" : "run-prior-version"}${viewedRun?.id === run.id ? " active" : ""}`}><strong>{run.simulationName}</strong><span>{run.orkVersion === workspaceVersion ? "CURRENT" : "PRIOR"} WORKING W{run.orkVersion} · Core {run.engineVersion}</span><small>{loadingRunId === run.id ? "Loading result…" : `${run.runByName} · ${new Date(run.createdAt).toLocaleString()}`}</small></button>)}{!runs.length && <div className="module-empty">{mode === "demo" ? "Demo runs are not stored." : "No server calculations recorded yet."}</div>}<footer>{viewedRun ? `Viewing immutable result from W${viewedRun.orkVersion}` : calculatedAt && `Latest calculation ${new Date(calculatedAt).toLocaleString()} · Core ${engineVersion}`}</footer></aside>
    {editor && <SimulationEditor initial={editor.initial} title={editor.draftId ? "Edit simulation" : "New simulation"} onCancel={() => setEditor(null)} onSave={saveEditor} />}
  </section>;
}

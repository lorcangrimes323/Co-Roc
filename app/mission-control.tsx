"use client";

import { ChangeEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RocketViewer, RocketViewerHandle } from "./rocket-viewer";
import { RocketSectionHandle, RocketSectionView } from "./rocket-section-view";
import { ProjectRecordWorkspace } from "./project-record-workspace";
import { RevisionWorkspace } from "./revision-workspace";
import { SimulationWorkspace, liveToSimulation, type LiveResult } from "./simulation-workspace";
import { WorkspaceIcon } from "./workspace-icon";
import {
  OpenRocketEditableField,
  OpenRocketModel,
  applyOpenRocketEdit,
  encodeOpenRocket,
  encodeOpenRocketAsync,
  parseOpenRocket,
} from "../lib/openrocket";
import type { ActiveWorkspace, WorkspaceIdentity, WorkspaceTeam } from "./workspace-types";

type ComponentStatus = "verified" | "review" | "draft";
type ThemeMode = "light" | "dark" | "system";
type SaveState = "loading" | "saved" | "draft" | "saving" | "conflict" | "offline";
type AnalysisState = "saved" | "stale" | "calculating" | "current" | "failed";
type WorkspaceModule = "configuration" | "simulation" | "history" | "tests" | "documents";
type PaneSide = "tree" | "record";

const defaultPaneWidths = { tree: 280, record: 460 };

const analysisStateLabel: Record<AnalysisState, string> = {
  saved: "SAVED RESULT",
  stale: "STALE · EDITS PENDING",
  calculating: "CALCULATING",
  current: "CURRENT",
  failed: "CALCULATION FAILED",
};

type PendingChange = {
  id: string;
  componentId: string;
  componentCode: string;
  field: OpenRocketEditableField;
  previousValue: string;
  nextValue: string;
};

type AuditChange = {
  id: number;
  version: number;
  componentId: string;
  componentCode: string;
  field: string;
  previousValue: string;
  nextValue: string;
  authorName: string;
  authorEmail: string;
  createdAt: string;
};

type EngineeringArtifact = {
  id: number;
  category: "drawing" | "document" | "test-evidence" | "photo" | "video";
  title: string;
  revision: string;
  status: "current" | "superseded";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  orkVersion: number | null;
  supersedesId: number | null;
  uploadedByName: string;
  createdAt: string;
};

type EngineeringTest = {
  id: number;
  title: string;
  requirement: string;
  status: "required" | "complete";
  ownerName: string;
  completionNotes: string | null;
  completedByName: string | null;
  completedAt: string | null;
  orkVersion: number | null;
  createdAt: string;
};

type EngineeringComment = {
  id: number;
  body: string;
  mentions: string[];
  orkVersion: number | null;
  authorName: string;
  createdAt: string;
};

type EngineeringEvent = {
  id: number;
  action: string;
  summary: string;
  entityType: string;
  orkVersion: number | null;
  authorName: string;
  createdAt: string;
};

async function responsePayload<T extends object>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  if (!text) return { error: `Request failed (${response.status})` } as T & { error?: string };
  try { return JSON.parse(text) as T & { error?: string }; }
  catch { return { error: text.slice(0, 240) || `Request failed (${response.status})` } as T & { error?: string }; }
}

type ComponentRecord = {
  artifacts: EngineeringArtifact[];
  tests: EngineeringTest[];
  comments: EngineeringComment[];
  events: EngineeringEvent[];
};

const emptyComponentRecord = (): ComponentRecord => ({ artifacts: [], tests: [], comments: [], events: [] });
function personInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function recordDate(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function recordSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type RocketComponent = {
  id: string;
  name: string;
  code: string;
  type: string;
  status: ComponentStatus;
  depth: number;
  length: number;
  diameter: number;
  wallThickness?: number;
  mass: number;
  material: string;
  documents: { name: string; meta: string; state: "current" | "review" }[];
};

type Activity = {
  id: number;
  person: string;
  initials: string;
  action: string;
  target: string;
  detail: string;
  time: string;
  tone: "cyan" | "amber" | "green";
};

const initialComponents: RocketComponent[] = [
  {
    id: "vehicle",
    name: "L4C final",
    code: "L4C-MK2",
    type: "Launch vehicle",
    status: "review",
    depth: 0,
    length: 2060,
    diameter: 90,
    mass: 23.84,
    material: "Mixed assembly",
    documents: [
      { name: "System architecture.pdf", meta: "REV C · 2.4 MB", state: "current" },
      { name: "Mass budget.xlsx", meta: "REV 18 · 186 KB", state: "current" },
    ],
  },
  {
    id: "nose",
    name: "Nose Cone",
    code: "NC-250",
    type: "Haack nose cone",
    status: "verified",
    depth: 1,
    length: 250,
    diameter: 90,
    mass: 0.4,
    material: "Fiberglass",
    documents: [
      { name: "NAS-100 drawing.pdf", meta: "REV D · 1.8 MB", state: "current" },
      { name: "Laminate schedule.pdf", meta: "REV B · 642 KB", state: "current" },
    ],
  },
  {
    id: "payload",
    name: "Forward Body",
    code: "FB-600",
    type: "Body tube",
    status: "verified",
    depth: 1,
    length: 600,
    diameter: 90,
    mass: 0.784,
    material: "Fiberglass",
    documents: [
      { name: "Payload ICD.pdf", meta: "REV C · 980 KB", state: "current" },
      { name: "Tube inspection.csv", meta: "LOT 24-07 · 42 KB", state: "current" },
    ],
  },
  {
    id: "avionics",
    name: "Avionics Coupler",
    code: "AC-150",
    type: "Switchband body tube",
    status: "review",
    depth: 1,
    length: 150,
    diameter: 90,
    mass: 0.208,
    material: "Fiberglass",
    documents: [
      { name: "Avionics bay CAD.step", meta: "REV E · 8.1 MB", state: "current" },
      { name: "CATS Vega integration.pdf", meta: "REV A · 1.2 MB", state: "review" },
    ],
  },
  {
    id: "airframe",
    name: "Lower Body",
    code: "LB-950",
    type: "Body tube",
    status: "review",
    depth: 1,
    length: 950,
    diameter: 90,
    mass: 1.248,
    material: "Fiberglass",
    documents: [
      { name: "STR-410 laminate.pdf", meta: "REV F · 724 KB", state: "current" },
      { name: "Compression test.pdf", meta: "TEST 017 · 3.6 MB", state: "current" },
      { name: "Cure record.pdf", meta: "BATCH 08 · 890 KB", state: "review" },
    ],
  },
  {
    id: "motor",
    name: "Aft Transition",
    code: "TR-110",
    type: "Conical transition",
    status: "verified",
    depth: 1,
    length: 110,
    diameter: 79.6,
    mass: 0.46,
    material: "Aluminum",
    documents: [
      { name: "Motor interface.pdf", meta: "REV C · 2.1 MB", state: "current" },
      { name: "Fastener schedule.csv", meta: "REV B · 28 KB", state: "current" },
    ],
  },
  {
    id: "fins",
    name: "Trapezoidal Fin Set",
    code: "FIN-3X",
    type: "3-fin trapezoidal set",
    status: "draft",
    depth: 2,
    length: 200,
    diameter: 4,
    mass: 0,
    material: "Fiberglass",
    documents: [
      { name: "Fin structural model.pdf", meta: "REV B · 4.7 MB", state: "review" },
      { name: "Core material cert.pdf", meta: "LOT 511 · 340 KB", state: "current" },
    ],
  },
  {
    id: "recovery",
    name: "Camera Pod",
    code: "POD-130",
    type: "External Haack pod",
    status: "verified",
    depth: 1,
    length: 130,
    diameter: 45,
    mass: 0,
    material: "Fiberglass",
    documents: [
      { name: "Recovery concept.pdf", meta: "REV D · 1.1 MB", state: "current" },
      { name: "Ground test 06.mp4", meta: "VERIFIED · 84 MB", state: "current" },
    ],
  },
];

const initialActivity: Activity[] = [
  {
    id: 1,
    person: "Maya Chen",
    initials: "MC",
    action: "approved",
    target: "STR-410 laminate",
    detail: "Analysis and manufacturing evidence accepted",
    time: "11:42",
    tone: "green",
  },
  {
    id: 2,
    person: "Lorcan Grimes",
    initials: "LG",
    action: "changed",
    target: "Main airframe mass",
    detail: "4.72 kg → 4.86 kg · As-built measurement",
    time: "10:18",
    tone: "cyan",
  },
  {
    id: 3,
    person: "Oscar Reid",
    initials: "OR",
    action: "requested review",
    target: "Fin structural model",
    detail: "New load case added for rail departure",
    time: "Yesterday",
    tone: "amber",
  },
];

const collaborators = [
  { initials: "LG", name: "Lorcan Grimes", colour: "cyan" },
  { initials: "MC", name: "Maya Chen", colour: "violet" },
  { initials: "OR", name: "Oscar Reid", colour: "amber" },
];

const componentPrefixes: Record<string, string> = {
  nosecone: "NC", bodytube: "BT", transition: "TR", trapezoidfinset: "FIN",
  freeformfinset: "FIN", ellipticalfinset: "FIN", innertube: "IT", tubecoupler: "TC",
  bulkhead: "BH", centeringring: "CR", engineblock: "EB", masscomponent: "MAS",
  parachute: "PAR", shockcord: "SC", railbutton: "RB", motor: "MTR",
};

function workspaceComponents(model: OpenRocketModel): RocketComponent[] {
  const counters = new Map<string, number>();
  const vehicle: RocketComponent = {
    id: "vehicle", name: model.name, code: "ORK", type: `${model.stages.length}-stage OpenRocket vehicle`,
    status: "verified", depth: 0, length: Math.round(model.length * 1000),
    diameter: Math.round(model.maxRadius * 2 * 1000), mass: 0, material: "Mixed assembly", documents: [],
  };
  return [vehicle, ...model.components.map((component) => {
    const prefix = componentPrefixes[component.kind] ?? component.kind.slice(0, 3).toUpperCase();
    const count = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, count);
    return {
      id: component.id,
      name: component.name,
      code: `${prefix}-${String(count).padStart(3, "0")}`,
      type: component.kind.replaceAll("set", " set").replaceAll("tube", " tube"),
      status: "verified" as const,
      depth: Math.min(4, component.depth + 1),
      length: Math.round(component.length * 1000),
      diameter: Math.round(Math.max(component.foreRadius, component.aftRadius) * 2000),
      wallThickness: ["nosecone", "bodytube", "transition", "innertube", "tubecoupler", "launchlug"].includes(component.kind)
        ? Math.round(component.thickness * 10000) / 10
        : undefined,
      mass: component.mass,
      material: component.material,
      documents: [],
    };
  })];
}

function StatusDot({ status }: { status: ComponentStatus }) {
  return <span className={`status-dot status-${status}`} aria-label={status} />;
}

export function MissionControl({
  user,
  mode,
  workspace,
  teams,
  onProjectChange,
  onManageTeam,
}: {
  user: WorkspaceIdentity;
  mode: "live" | "demo";
  workspace: ActiveWorkspace;
  teams: WorkspaceTeam[];
  onProjectChange?: (projectId: string) => void;
  onManageTeam?: () => void;
}) {
  const placeholderComponent: RocketComponent = { ...initialComponents[0], name: workspace.project.name, code: "PROJECT", length: 0, diameter: 0, mass: 0, documents: [] };
  const [components, setComponents] = useState(mode === "demo" ? initialComponents : [placeholderComponent]);
  const [selectedId, setSelectedId] = useState<string | null>(mode === "demo" ? "airframe" : "vehicle");
  const [activePanel, setActivePanel] = useState<"properties" | "records" | "tests" | "comments">("records");
  const [activity, setActivity] = useState(initialActivity);
  const [notice, setNotice] = useState("Workspace synchronised");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionName, setRevisionName] = useState("STR-410 mass update");
  const [orkModel, setOrkModel] = useState<OpenRocketModel | null>(null);
  const [viewMode, setViewMode] = useState<"components" | "3d">("components");
  const [workspaceModule, setWorkspaceModule] = useState<WorkspaceModule>("configuration");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [accent, setAccent] = useState("#c92335");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rollDegrees, setRollDegrees] = useState(0);
  const [paneWidths, setPaneWidths] = useState(defaultPaneWidths);
  const changeRoll = useCallback((deltaDegrees: number) => {
    setRollDegrees((value) => (value + deltaDegrees + 360) % 360);
  }, []);
  const [workspaceVersion, setWorkspaceVersion] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [analysisState, setAnalysisState] = useState<AnalysisState>("saved");
  const [liveAnalysis, setLiveAnalysis] = useState<OpenRocketModel["simulations"][number] | null>(null);
  const [analysisEngineVersion, setAnalysisEngineVersion] = useState("");
  const [analysisCalculatedAt, setAnalysisCalculatedAt] = useState("");
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [auditChanges, setAuditChanges] = useState<AuditChange[]>([]);
  const [lastSavedBy, setLastSavedBy] = useState<string>("");
  const [conflictMessage, setConflictMessage] = useState("");
  const [componentRecord, setComponentRecord] = useState<ComponentRecord>(emptyComponentRecord);
  const [recordLoading, setRecordLoading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<EngineeringArtifact["category"]>("drawing");
  const [uploadRevision, setUploadRevision] = useState("A");
  const [recordTitle, setRecordTitle] = useState("");
  const [testTitle, setTestTitle] = useState("");
  const [testRequirement, setTestRequirement] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<RocketViewerHandle>(null);
  const sectionRef = useRef<RocketSectionHandle>(null);
  const mainGridRef = useRef<HTMLDivElement>(null);
  const workspaceVersionRef = useRef<number | null>(null);
  const pendingChangesRef = useRef<PendingChange[]>([]);
  const orkModelRef = useRef<OpenRocketModel | null>(null);
  const calculatedVersionRef = useRef<number | null>(null);
  const analysisSequenceRef = useRef(0);
  const can = (permission: WorkspaceTeam["permissions"][number]) => mode === "demo" ? permission === "view" || permission === "editOrk" : workspace.team.permissions.includes(permission);
  const availableProjects = teams.flatMap((team) => team.projects.map((project) => ({ ...project, teamName: team.name })));
  const visibleMembers = workspace.team.members.slice(0, 3);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("co-roc:configuration-pane-widths") || "null") as Partial<typeof defaultPaneWidths> | null;
      if (stored && Number.isFinite(stored.tree) && Number.isFinite(stored.record)) {
        setPaneWidths({ tree: Number(stored.tree), record: Number(stored.record) });
      }
    } catch { /* Keep the engineering defaults when browser storage is unavailable. */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("co-roc:configuration-pane-widths", JSON.stringify(paneWidths)); }
    catch { /* Resizing still works for the current session. */ }
  }, [paneWidths]);

  const constrainedPaneWidths = useCallback((side: PaneSide, requested: number, fixed: typeof defaultPaneWidths, total: number) => {
    const centreMinimum = 420;
    if (side === "tree") return { ...fixed, tree: Math.max(220, Math.min(requested, total - fixed.record - centreMinimum)) };
    return { ...fixed, record: Math.max(340, Math.min(requested, total - fixed.tree - centreMinimum)) };
  }, []);

  function beginPaneResize(side: PaneSide, event: ReactPointerEvent<HTMLDivElement>) {
    const grid = mainGridRef.current;
    if (!grid) return;
    event.preventDefault();
    const bounds = grid.getBoundingClientRect();
    const start = paneWidths;
    const move = (pointer: PointerEvent) => {
      const requested = side === "tree" ? pointer.clientX - bounds.left : bounds.right - pointer.clientX;
      setPaneWidths(constrainedPaneWidths(side, requested, start, bounds.width));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing-panes");
    };
    document.body.classList.add("resizing-panes");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }

  function resizePaneWithKeyboard(side: PaneSide, event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const grid = mainGridRef.current;
    if (!grid) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const requested = side === "tree" ? paneWidths.tree + direction * 16 : paneWidths.record - direction * 16;
    setPaneWidths(constrainedPaneWidths(side, requested, paneWidths, grid.getBoundingClientRect().width));
  }
  const moduleLabel: Record<WorkspaceModule, string> = {
    configuration: "CONFIGURATION",
    simulation: "SIMULATION",
    history: "REVISION HISTORY",
    tests: "TEST REGISTER",
    documents: "DOCUMENTATION",
  };
  const vehicleAnalysis = useMemo(() => {
    if (!orkModel) return null;
    const simulation = liveAnalysis ?? orkModel.simulations.find((item) => Number.isFinite(item.maxAltitude) || Number.isFinite(item.launchMass)) ?? orkModel.simulations[0];
    if (!simulation) return null;
    const componentDryMass = orkModel.components
      .filter((component) => component.kind !== "motor")
      .reduce((total, component) => total + (Number.isFinite(component.mass) ? component.mass : 0), 0);
    const calculatedDryMass = simulation.launchMass - simulation.launchMotorMass;
    const dryMass = Number.isFinite(calculatedDryMass) ? calculatedDryMass : componentDryMass > 0 ? componentDryMass : Number.NaN;
    const stabilityPercent = simulation.referenceStability * (orkModel.maxRadius * 2) / orkModel.length * 100;
    const shown = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "—";
    const configuredName = simulation.branchName && simulation.branchName !== "Flight configuration" ? simulation.branchName : simulation.name;
    return {
      configuration: configuredName,
      dryMass: shown(dryMass, 3),
      loadedMass: shown(simulation.launchMass, 3),
      cg: shown(simulation.referenceCg * 1000, 0),
      cp: shown(simulation.referenceCp * 1000, 0),
      stability: shown(simulation.referenceStability, 2),
      stabilityPercent: shown(stabilityPercent, 2),
      referenceMach: shown(simulation.referenceMach, 3),
      apogee: shown(simulation.maxAltitude, 0),
      maxVelocity: shown(simulation.maxVelocity, 0),
      maxMach: shown(simulation.maxMach, 3),
      maxAcceleration: shown(simulation.maxAcceleration, 0),
    };
  }, [liveAnalysis, orkModel]);

  function openComponentWorkspace(componentId: string, panel: "records" | "tests" | "properties" = "properties") {
    setSelectedId(componentId);
    setActivePanel(panel);
    setWorkspaceModule("configuration");
  }

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("rocket-theme");
    const savedAccent = window.localStorage.getItem("rocket-accent");
    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") setThemeMode(savedTheme);
    if (savedAccent && /^#[0-9a-f]{6}$/i.test(savedAccent)) setAccent(savedAccent);
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    const poll = window.setInterval(async () => {
      const version = workspaceVersionRef.current;
      if (version === null || pendingChangesRef.current.length) return;
      try {
        const response = await fetch(`/api/ork?afterVersion=${version}`, { headers: collaborationHeaders(), cache: "no-store" });
        if (response.status === 204 || !response.ok) return;
        const nextVersion = Number(response.headers.get("x-ork-version"));
        const sourceName = decodeURIComponent(response.headers.get("x-ork-source-name") || orkModelRef.current?.sourceName || "shared-working.ork");
        const model = await parseOpenRocket(await response.arrayBuffer(), sourceName);
        loadModel(model, true);
        setWorkspaceVersion(nextVersion);
        setLastSavedBy(decodeURIComponent(response.headers.get("x-ork-updated-by") || "Teammate"));
        setSaveState("saved");
        setNotice(`Live update received · version ${nextVersion}`);
        await refreshHistory();
      } catch { /* retain the last known-good working copy */ }
    }, 2500);
    return () => window.clearInterval(poll);
  }, [mode, workspace.project.id]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.style.setProperty("--accent", accent);
    };
    applyTheme();
    window.localStorage.setItem("rocket-theme", themeMode);
    window.localStorage.setItem("rocket-accent", accent);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [accent, themeMode]);

  useEffect(() => { workspaceVersionRef.current = workspaceVersion; }, [workspaceVersion]);
  useEffect(() => { pendingChangesRef.current = pendingChanges; }, [pendingChanges]);
  useEffect(() => { orkModelRef.current = orkModel; }, [orkModel]);
  useEffect(() => {
    if (mode !== "live") return;
    const key = `rocket-draft:${workspace.project.id}`;
    if (!pendingChanges.length) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, JSON.stringify({ baseVersion: workspaceVersion, changes: pendingChanges, updatedAt: new Date().toISOString() }));
  }, [mode, pendingChanges, workspace.project.id, workspaceVersion]);

  function collaborationHeaders() {
    return {
      "x-project-id": workspace.project.id,
      ...(user.preview ? {
        "x-local-preview-name": user.name,
        "x-local-preview-email": user.email,
        "x-local-preview-role": user.previewRole ?? "lead",
      } : {}),
    };
  }

  async function refreshHistory() {
    if (mode !== "live") return;
    try {
      const response = await fetch("/api/ork/history", { headers: collaborationHeaders(), cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { changes?: AuditChange[] };
      setAuditChanges(payload.changes ?? []);
    } catch { /* live history is non-blocking */ }
  }

  function activeView() {
    return viewMode === "components" ? sectionRef.current : viewerRef.current;
  }

  const selected = useMemo(
    () => components.find((component) => component.id === selectedId) ?? components[0],
    [components, selectedId],
  );

  async function refreshComponentRecord(componentId: string) {
    if (mode !== "live") { setComponentRecord(emptyComponentRecord()); return; }
    setRecordLoading(true);
    try {
      const response = await fetch(`/api/component-records?componentId=${encodeURIComponent(componentId)}`, {
        headers: collaborationHeaders(),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Record unavailable");
      setComponentRecord(await response.json() as ComponentRecord);
    } catch {
      setComponentRecord(emptyComponentRecord());
      setNotice("The component record could not be loaded");
    } finally {
      setRecordLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedId) return;
    void refreshComponentRecord(selected.id);
  }, [selected.id, selectedId]);

  function loadModel(model: OpenRocketModel, preserveSelection = false) {
    const parsed = workspaceComponents(model);
    setOrkModel(model);
    setComponents(parsed);
    const primary = model.components
      .filter((component) => component.external && component.kind === "bodytube")
      .sort((a, b) => b.length - a.length)[0]
      ?? model.components.find((component) => component.external)
      ?? model.components[0];
    setSelectedId((current) => preserveSelection && current && parsed.some((component) => component.id === current)
      ? current
      : primary?.id ?? "vehicle");
    setNotice(`${model.sourceName} rebuilt · ${model.components.length} components`);
  }

  function restoreLocalDraft(model: OpenRocketModel, version: number) {
    if (mode !== "live") return false;
    const key = `rocket-draft:${workspace.project.id}`;
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || "null") as { baseVersion?: number; changes?: PendingChange[] } | null;
      if (!saved?.changes?.length) return false;
      if (saved.baseVersion !== version) {
        setConflictMessage("A recoverable local draft was based on an older shared version. Reloading will keep the shared file authoritative.");
        setSaveState("conflict");
        return false;
      }
      let recovered = model;
      for (const change of saved.changes) recovered = applyOpenRocketEdit(recovered, change.componentId, change.field, change.nextValue);
      loadModel(recovered);
      setPendingChanges(saved.changes);
      pendingChangesRef.current = saved.changes;
      setSaveState("draft");
      setNotice(`Recovered ${saved.changes.length} unsaved local change${saved.changes.length === 1 ? "" : "s"}`);
      return true;
    } catch {
      window.localStorage.removeItem(key);
      return false;
    }
  }

  useEffect(() => {
    let active = true;
    calculatedVersionRef.current = null;
    analysisSequenceRef.current += 1;
    setLiveAnalysis(null);
    setAnalysisState("saved");
    setAnalysisEngineVersion("");
    setAnalysisCalculatedAt("");
    async function openWorkspace() {
      try {
        if (mode === "demo") {
          const response = await fetch("/models/banshee-mk2.ork");
          if (!response.ok) throw new Error("Demo model unavailable");
          const model = await parseOpenRocket(await response.arrayBuffer(), "L4C configuration Banshee Mk2.ork");
          if (!active) return;
          loadModel(model);
          setWorkspaceVersion(0);
          setLastSavedBy("Demo dataset");
          setSaveState("saved");
          setNotice("Demo workspace; changes stay in this browser session");
          return;
        }
        const shared = await fetch("/api/ork", { headers: collaborationHeaders(), cache: "no-store" });
        if (shared.ok) {
          const sourceName = decodeURIComponent(shared.headers.get("x-ork-source-name") || "shared-working.ork");
          const model = await parseOpenRocket(await shared.arrayBuffer(), sourceName);
          if (!active) return;
          const version = Number(shared.headers.get("x-ork-version"));
          loadModel(model);
          setWorkspaceVersion(version);
          setLastSavedBy(decodeURIComponent(shared.headers.get("x-ork-updated-by") || ""));
          if (!restoreLocalDraft(model, version)) setSaveState("saved");
          await refreshHistory();
          return;
        }

        if (shared.status === 404) {
          setComponents([placeholderComponent]);
          setSelectedId("vehicle");
          setWorkspaceVersion(0);
          setSaveState("saved");
          setNotice("No OpenRocket file yet; import an .ork file to initialise this project");
          return;
        }
        throw new Error("Workspace unavailable");
      } catch {
        if (active) {
          setSaveState("offline");
          setNotice("Import an OpenRocket file to rebuild its geometry");
        }
      }
    }
    void openWorkspace();
    return () => { active = false; };
  }, [mode, workspace.project.id]);

  useEffect(() => {
    if (mode !== "live" || !selectedId) return;

    let active = true;
    fetch(`/api/documents?componentId=${encodeURIComponent(selected.id)}`, { headers: collaborationHeaders() })
      .then((response) => response.ok ? response.json() : { documents: [] })
      .then((payload: { documents?: Array<{ fileName: string; sizeBytes: number; state: string }> }) => {
        if (!active || !payload.documents?.length) return;
        const persisted = payload.documents.map((document) => ({
          name: document.fileName,
          meta: `UPLOADED · ${Math.max(1, Math.round(document.sizeBytes / 1024))} KB`,
          state: document.state === "current" ? "current" as const : "review" as const,
        }));
        setComponents((items) => items.map((component) => {
          if (component.id !== selected.id) return component;
          const existing = new Set(component.documents.map((document) => document.name));
          return { ...component, documents: [...persisted.filter((document) => !existing.has(document.name)), ...component.documents] };
        }));
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, [selected.id, selectedId, mode]);

  function updateSelected<K extends keyof RocketComponent>(key: K, value: RocketComponent[K]) {
    const editableFields = new Set<keyof RocketComponent>(["name", "length", "diameter", "wallThickness", "mass", "material"]);
    const previousValue = selected[key];
    setComponents((items) =>
      items.map((component) =>
        component.id === selected.id ? { ...component, [key]: value, status: "draft" } : component,
      ),
    );
    if (editableFields.has(key) && orkModelRef.current?.components.some((component) => component.id === selected.id)) {
      try {
        const field = key as OpenRocketEditableField;
        const edited = applyOpenRocketEdit(orkModelRef.current, selected.id, field, value as string | number);
        orkModelRef.current = edited;
        setOrkModel(edited);
        if (mode === "demo") {
          setSaveState("draft");
          setNotice(`${selected.code} changed locally; demo data is not saved`);
          return;
        }
        setPendingChanges((items) => {
          const existing = items.find((change) => change.componentId === selected.id && change.field === field);
          const next = existing
            ? items.map((change) => change === existing ? { ...change, nextValue: String(value) } : change)
            : [...items, {
              id: crypto.randomUUID(),
              componentId: selected.id,
              componentCode: selected.code,
              field,
              previousValue: String(previousValue ?? ""),
              nextValue: String(value ?? ""),
            }];
          pendingChangesRef.current = next;
          return next;
        });
        setSaveState("draft");
        setConflictMessage("");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The OpenRocket edit could not be applied");
        return;
      }
    }
    setNotice(`${selected.code} has unsaved changes`);
  }

  function updateSimulationModel(nextModel: OpenRocketModel, change: { simulationId: string; name: string; editing: boolean }) {
    orkModelRef.current = nextModel;
    setOrkModel(nextModel);
    setSaveState("draft");
    if (mode === "demo") {
      setNotice(`${change.name} saved in the local demo ORK; demo data is not uploaded`);
      return;
    }
    const pending: PendingChange = {
      id: crypto.randomUUID(),
      componentId: change.simulationId,
      componentCode: `SIM-${String(nextModel.simulations.findIndex((item) => item.id === change.simulationId) + 1).padStart(3, "0")}`,
      field: "simulationSetup",
      previousValue: change.editing ? "Previous simulation conditions" : "No simulation definition",
      nextValue: change.name,
    };
    setPendingChanges((items) => {
      const next = [...items.filter((item) => !(item.componentId === pending.componentId && item.field === "simulationSetup")), pending];
      pendingChangesRef.current = next;
      return next;
    });
    setConflictMessage("");
  }

  useEffect(() => {
    if (mode !== "live" || !can("editOrk")) return;
    if (!pendingChanges.length || !orkModel || workspaceVersion === null || saveState === "conflict" || saveState === "saving") return;
    const batch = pendingChanges;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const bytes = await encodeOpenRocketAsync(orkModel);
        const headers = new Headers(collaborationHeaders());
        headers.set("content-type", "application/vnd.co-roc.ork");
        headers.set("x-co-roc-file-name", encodeURIComponent(orkModel.sourceName));
        headers.set("x-co-roc-base-version", String(workspaceVersion));
        headers.set("x-co-roc-changes", encodeURIComponent(JSON.stringify(batch.map(({ id: _id, ...change }) => change))));
        const response = await fetch("/api/ork", { method: "PUT", headers, body: bytes });
        const payload = await responsePayload<{ workspace?: { version: number; updatedByName: string } }>(response);
        if (response.status === 409) {
          setSaveState("conflict");
          setConflictMessage(payload.error || "A teammate saved a newer working copy.");
          setNotice("Save paused · shared-file conflict requires review");
          return;
        }
        if (!response.ok || !payload.workspace) throw new Error(payload.error || "Autosave failed");
        const savedIds = new Set(batch.map((change) => change.id));
        setPendingChanges((items) => {
          const remaining = items.filter((change) => !savedIds.has(change.id));
          pendingChangesRef.current = remaining;
          setSaveState(remaining.length ? "draft" : "saved");
          return remaining;
        });
        setWorkspaceVersion(payload.workspace.version);
        window.localStorage.removeItem(`rocket-draft:${workspace.project.id}`);
        setLastSavedBy(payload.workspace.updatedByName);
        setNotice(`Shared .ork saved · version ${payload.workspace.version}`);
        await refreshHistory();
      } catch {
        setSaveState("offline");
        setNotice("Working locally · live save will retry after the connection returns");
      }
    }, saveState === "offline" ? 5000 : 1500);
    return () => window.clearTimeout(timer);
  }, [orkModel, pendingChanges, saveState, workspaceVersion, mode]);

  useEffect(() => {
    if (!orkModel || !pendingChanges.length && saveState !== "draft" && saveState !== "saving" && saveState !== "offline" && saveState !== "conflict") return;
    analysisSequenceRef.current += 1;
    setAnalysisState("stale");
  }, [orkModel, pendingChanges.length, saveState]);

  useEffect(() => {
    if (!orkModel?.simulations.length) return;
    if (mode === "live" && (saveState !== "saved" || pendingChanges.length || workspaceVersion === null)) return;
    if (mode === "live" && calculatedVersionRef.current === workspaceVersion) return;

    const sequence = ++analysisSequenceRef.current;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAnalysisState("calculating");
      try {
        const simulationIndex = 0;
        const endpoint = mode === "demo" ? "/api/simulations?demo=1&preview=1" : "/api/simulations?preview=1";
        const requestHeaders = new Headers(collaborationHeaders());
        let response: Response;
        if (mode === "demo") {
          requestHeaders.set("content-type", "application/octet-stream");
          requestHeaders.set("x-simulation-index", String(simulationIndex));
          response = await fetch(endpoint, { method: "POST", headers: requestHeaders, body: await encodeOpenRocketAsync(orkModel) });
        } else {
          requestHeaders.set("content-type", "application/json");
          response = await fetch(endpoint, { method: "POST", headers: requestHeaders, body: JSON.stringify({ simulationIndex }) });
        }
        let payload = await responsePayload<{ jobId?: string; result?: LiveResult }>(response);
        if (!response.ok || !payload.jobId) throw new Error(payload.error || "OpenRocket preview could not be queued");

        const pollEndpoint = `${endpoint}&jobId=${encodeURIComponent(payload.jobId)}`;
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          if (cancelled || sequence !== analysisSequenceRef.current) return;
          response = await fetch(pollEndpoint, { headers: collaborationHeaders(), cache: "no-store" });
          payload = await responsePayload<{ jobId?: string; result?: LiveResult }>(response);
          if (response.status === 202) continue;
          if (!response.ok || !payload.result) throw new Error(payload.error || "OpenRocket preview calculation failed");

          const base = orkModel.simulations[simulationIndex];
          setLiveAnalysis(liveToSimulation(payload.result, base, orkModel.maxRadius * 2));
          setAnalysisEngineVersion(payload.result.engineVersion);
          setAnalysisCalculatedAt(payload.result.calculatedAt);
          setAnalysisState("current");
          if (mode === "live") calculatedVersionRef.current = workspaceVersion;
          return;
        }
        throw new Error("OpenRocket preview calculation timed out");
      } catch {
        if (!cancelled && sequence === analysisSequenceRef.current) setAnalysisState("failed");
      }
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, orkModel, pendingChanges.length, saveState, workspaceVersion]);

  async function importOrk(event: ChangeEvent<HTMLInputElement>) {
    if (!can("editOrk")) { setNotice("Your role cannot replace the live OpenRocket file"); event.target.value = ""; return; }
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ork")) {
      setNotice("Choose a valid OpenRocket .ork file");
      return;
    }
    setNotice(`Reading ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      const model = await parseOpenRocket(buffer, file.name);
      if (mode === "demo") {
        loadModel(model);
        setWorkspaceVersion(0);
        setSaveState("draft");
        setNotice(`${file.name} loaded locally; demo data is not saved`);
        return;
      }
      const headers = new Headers(collaborationHeaders());
      headers.set("content-type", "application/vnd.co-roc.ork");
      headers.set("x-co-roc-file-name", encodeURIComponent(file.name));
      headers.set("x-co-roc-base-version", String(workspaceVersionRef.current ?? 0));
      const response = await fetch("/api/ork", { method: "POST", headers, body: buffer });
      const payload = await responsePayload<{ workspace?: { version: number; updatedByName: string } }>(response);
      if (response.status === 409) {
        setSaveState("conflict");
        setConflictMessage(payload.error || "The shared file changed before import completed.");
        return;
      }
      if (!response.ok || !payload.workspace) throw new Error(payload.error || "The shared file could not be replaced");
      loadModel(model);
      setPendingChanges([]);
      pendingChangesRef.current = [];
      window.localStorage.removeItem(`rocket-draft:${workspace.project.id}`);
      setWorkspaceVersion(payload.workspace.version);
      setLastSavedBy(payload.workspace.updatedByName);
      setSaveState("saved");
      await refreshHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The OpenRocket file could not be read");
    } finally {
      event.target.value = "";
    }
  }

  async function downloadWorkingOrk() {
    try {
      if (mode === "demo" && orkModel) {
        const url = URL.createObjectURL(new Blob([encodeOpenRocket(orkModel)], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = orkModel.sourceName;
        link.click();
        URL.revokeObjectURL(url);
        setNotice("Downloaded the local demo working copy");
        return;
      }
      const response = await fetch("/api/ork?download=1", { headers: collaborationHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error("Download unavailable");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${orkModel?.sourceName.replace(/\.ork$/i, "") || "shared-working"}-v${workspaceVersion ?? 0}.ork`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded controlled working copy · version ${workspaceVersion ?? "—"}`);
    } catch {
      setNotice("The controlled .ork could not be downloaded");
    }
  }

  async function reloadSharedOrk() {
    try {
      if (mode === "demo") {
        const response = await fetch("/models/banshee-mk2.ork");
        if (!response.ok) throw new Error("Demo model unavailable");
        const model = await parseOpenRocket(await response.arrayBuffer(), "L4C configuration Banshee Mk2.ork");
        loadModel(model);
        setWorkspaceVersion(0);
        setSaveState("saved");
        setNotice("Demo model reset");
        return;
      }
      const response = await fetch("/api/ork", { headers: collaborationHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error("Shared file unavailable");
      const sourceName = decodeURIComponent(response.headers.get("x-ork-source-name") || "shared-working.ork");
      const model = await parseOpenRocket(await response.arrayBuffer(), sourceName);
      loadModel(model, true);
      setWorkspaceVersion(Number(response.headers.get("x-ork-version")));
      setLastSavedBy(decodeURIComponent(response.headers.get("x-ork-updated-by") || "Teammate"));
      setPendingChanges([]);
      pendingChangesRef.current = [];
      window.localStorage.removeItem(`rocket-draft:${workspace.project.id}`);
      setConflictMessage("");
      setSaveState("saved");
      setNotice("Reloaded the authoritative shared .ork");
      await refreshHistory();
    } catch {
      setNotice("The authoritative shared .ork could not be reloaded");
    }
  }

  async function attachDocument(event: ChangeEvent<HTMLInputElement>) {
    if (!can("uploadEvidence")) { setNotice("Your role cannot upload engineering evidence"); return; }
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("componentId", selected.id);
    form.set("componentCode", selected.code);
    form.set("category", uploadCategory);
    form.set("revision", uploadRevision.trim() || "A");
    form.set("title", recordTitle.trim());
    if (workspaceVersion) form.set("orkVersion", String(workspaceVersion));
    form.set("file", file);
    setNotice(`Uploading ${file.name} to ${selected.code}…`);
    try {
      const response = await fetch("/api/component-records", {
        method: "POST",
        headers: collaborationHeaders(),
        body: form,
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      await refreshComponentRecord(selected.id);
      setRecordTitle("");
      setComponents((items) => items.map((component) => component.id === selected.id ? { ...component, status: "review" } : component));
      setNotice(`${file.name} added to ${selected.code} at ORK V${workspaceVersion ?? "—"}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${file.name} could not be uploaded`);
    }
    event.target.value = "";
  }

  async function createRequiredTest() {
    if (!can("createTest")) { setNotice("Only a team lead can issue a test requirement"); return; }
    if (!testTitle.trim() || !testRequirement.trim()) {
      setNotice("Add a test title and a measurable acceptance requirement");
      return;
    }
    try {
      const response = await fetch("/api/component-records", {
        method: "POST",
        headers: { "content-type": "application/json", ...collaborationHeaders() },
        body: JSON.stringify({
          action: "create-test",
          componentId: selected.id,
          componentCode: selected.code,
          orkVersion: workspaceVersion,
          title: testTitle,
          requirement: testRequirement,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Test could not be created");
      setTestTitle("");
      setTestRequirement("");
      await refreshComponentRecord(selected.id);
      setNotice(`Required test added to ${selected.code}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Test could not be created");
    }
  }

  async function completeRequiredTest(test: EngineeringTest) {
    if (!can("completeTest")) { setNotice("Your role cannot complete test requirements"); return; }
    try {
      const response = await fetch("/api/component-records", {
        method: "POST",
        headers: { "content-type": "application/json", ...collaborationHeaders() },
        body: JSON.stringify({
          action: "complete-test",
          componentId: selected.id,
          componentCode: selected.code,
          orkVersion: workspaceVersion,
          testId: test.id,
          completionNotes: `Completion confirmed by ${user.name}. Supporting evidence can be linked from Records.`,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Test could not be completed");
      await refreshComponentRecord(selected.id);
      setNotice(`${test.title} marked complete`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Test could not be completed");
    }
  }

  function insertMention(name: string) {
    setCommentDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${name} `);
  }

  async function postComment() {
    if (!can("comment")) { setNotice("Your role cannot post to the part record"); return; }
    if (!commentDraft.trim()) return;
    try {
      const response = await fetch("/api/component-records", {
        method: "POST",
        headers: { "content-type": "application/json", ...collaborationHeaders() },
        body: JSON.stringify({
          action: "add-comment",
          componentId: selected.id,
          componentCode: selected.code,
          orkVersion: workspaceVersion,
          body: commentDraft,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Comment could not be posted");
      setCommentDraft("");
      await refreshComponentRecord(selected.id);
      setNotice(`Comment posted to ${selected.code}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Comment could not be posted");
    }
  }

  async function createRevision() {
    if (!can("createRevision")) { setNotice("Your role cannot create controlled revisions"); return; }
    if (pendingChangesRef.current.length || saveState === "saving") {
      setNotice("Wait for the shared .ork to finish saving before creating a revision");
      return;
    }
    const label = revisionName.trim() || `${selected.code} update`;
    const newEntry: Activity = {
      id: Date.now(),
      person: user.name,
      initials: user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      action: "created revision",
      target: label,
      detail: `${selected.code} · ${selected.name}`,
      time: "Now",
      tone: "cyan",
    };
    setActivity((items) => [newEntry, ...items]);
    setComponents((items) =>
      items.map((component) =>
        component.id === selected.id ? { ...component, status: "review" } : component,
      ),
    );
    setRevisionOpen(false);
    setNotice(`Revision 29 created · ${label}`);
    try {
      const response = await fetch("/api/revisions", {
        method: "POST",
        headers: { "content-type": "application/json", ...collaborationHeaders() },
        body: JSON.stringify({ title: label, componentId: selected.id, componentCode: selected.code }),
      });
      if (!response.ok) throw new Error("Revision could not be saved");
      const payload = await response.json() as { snapshotVersion?: number | null };
      setNotice(`Immutable revision saved · working version ${payload.snapshotVersion ?? workspaceVersion ?? "—"}`);
      await refreshHistory();
    } catch {
      setNotice(`Revision could not be synchronised`);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div>
            <div className="brand-name">ROCKET CONFIGURATION</div>
            <div className="brand-subtitle">ENGINEERING WORKSPACE</div>
          </div>
        </div>

        <div className="project-switcher">
          <span className="project-kicker">{workspace.team.name} / ACTIVE PROJECT</span>
          {availableProjects.length > 1 ? <select className="project-name project-select" value={workspace.project.id} onChange={(event) => onProjectChange?.(event.target.value)}>{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.teamName} · {project.name}</option>)}</select> : <button className="project-name" type="button" onClick={onManageTeam}>{workspace.project.name} <span>⌄</span></button>}
        </div>

        <div className="topbar-actions">
          <div className={`sync-state sync-${saveState}`}><span className="pulse-dot" />{
            mode === "demo" ? (saveState === "draft" ? "DEMO · LOCAL CHANGES" : "DEMO") : saveState === "saving" ? "SAVING" : saveState === "draft" ? "DRAFT" : saveState === "conflict" ? "CONFLICT" : saveState === "offline" ? "OFFLINE" : saveState === "loading" ? "CONNECTING" : `LIVE · V${workspaceVersion ?? "—"}`
          }</div>
          <div className="avatar-stack" aria-label="Team members">
            {(visibleMembers.length ? visibleMembers : collaborators).map((person, index) => (
              <span key={"email" in person ? person.email : person.initials} className={`avatar avatar-${["amber", "violet", "cyan"][index % 3]}`} title={"displayName" in person ? person.displayName : person.name}>
                {"displayName" in person ? personInitials(person.displayName) : person.initials}
              </span>
            ))}
          </div>
          <button className="user-menu" type="button" title={mode === "demo" ? "Exit demo" : user.email} onClick={mode === "demo" ? () => { window.location.href = "/"; } : onManageTeam}>
            <span>{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
            <span className="user-name">{user.name}<small>{mode === "demo" ? "DEMO" : workspace.team.role}</small></span>
          </button>
        </div>
      </header>

      <aside className="rail">
        <button className={`rail-button ${workspaceModule === "configuration" ? "rail-active" : ""}`} type="button" aria-label="Configuration" data-label="Configuration" onClick={() => setWorkspaceModule("configuration")}><WorkspaceIcon name="configuration" /></button>
        <button className={`rail-button ${workspaceModule === "simulation" ? "rail-active" : ""}`} type="button" aria-label="Simulation" data-label="Simulation" onClick={() => setWorkspaceModule("simulation")}><WorkspaceIcon name="simulation" /></button>
        <button className={`rail-button ${workspaceModule === "history" ? "rail-active" : ""}`} type="button" aria-label="Revision history" data-label="Revision history" onClick={() => { setWorkspaceModule("history"); void refreshHistory(); }}><WorkspaceIcon name="history" /></button>
        <button className={`rail-button ${workspaceModule === "tests" ? "rail-active" : ""}`} type="button" aria-label="Tests" data-label="Tests" onClick={() => setWorkspaceModule("tests")}><WorkspaceIcon name="tests" /></button>
        <button className={`rail-button ${workspaceModule === "documents" ? "rail-active" : ""}`} type="button" aria-label="Documentation" data-label="Documentation" onClick={() => setWorkspaceModule("documents")}><WorkspaceIcon name="documents" /></button>
        <div className="rail-spacer" />
        <button className={`rail-button ${settingsOpen ? "rail-settings-active" : ""}`} type="button" aria-label="Theme settings" data-label="Appearance" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><WorkspaceIcon name="settings" /></button>
      </aside>

      {settingsOpen && (
        <section className="theme-panel" aria-label="Theme settings">
          <div className="theme-panel-heading"><div><span>APPEARANCE</span><h2>Workspace theme</h2></div><button type="button" aria-label="Close theme settings" onClick={() => setSettingsOpen(false)}>×</button></div>
          <label>MODE</label>
          <div className="theme-modes">
            {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
              <button key={mode} type="button" className={themeMode === mode ? "theme-mode-active" : ""} onClick={() => setThemeMode(mode)}>{mode}</button>
            ))}
          </div>
          <label htmlFor="accent-colour">ACCENT COLOUR</label>
          <div className="accent-picker"><input id="accent-colour" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /><code>{accent.toUpperCase()}</code></div>
          <div className="accent-presets" aria-label="Accent presets">
            {["#c92335", "#e5484d", "#b42318", "#111111"].map((colour) => <button key={colour} type="button" aria-label={`Use ${colour}`} style={{ backgroundColor: colour }} onClick={() => setAccent(colour)} />)}
          </div>
          <p>Theme choices are stored in this browser.</p>
        </section>
      )}

      <section className="workspace-header">
        <div>
          <div className="breadcrumbs">{workspace.team.name.toUpperCase()} / {workspace.project.name.toUpperCase()} / <strong>{moduleLabel[workspaceModule]}</strong></div>
          <div className="workspace-title-row">
            <h1>{orkModel?.name || workspace.project.name}</h1>
            <span className="revision-badge"><span /> {mode === "demo" ? "DEMO · LOCAL" : `WORKING · V${workspaceVersion ?? "—"}`}</span>
          </div>
        </div>
        {workspaceModule === "configuration" && <div className="workspace-actions">
          <input ref={fileInput} className="visually-hidden" type="file" accept=".ork" onChange={importOrk} />
          <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={!can("editOrk")}>
            <span>⇧</span> Import .ORK
          </button>
          <button className="button button-secondary" type="button" onClick={downloadWorkingOrk} disabled={workspaceVersion === null}>
            <span>↓</span> Download .ORK
          </button>
          <button className="button button-primary" type="button" onClick={() => setRevisionOpen(true)} disabled={!can("createRevision")} title={!can("createRevision") ? "Your role cannot create revisions" : undefined}>
            <span>＋</span> Create revision
          </button>
        </div>}
      </section>

      <section className="metrics-strip" aria-label="Vehicle summary">
        {workspaceModule === "simulation" ? <>
          <div className="metric"><span>SAVED CASES</span><strong>{orkModel?.simulations.length ?? 0} <small>runs</small></strong></div>
          <div className="metric"><span>APOGEE · CASE 1</span><strong>{orkModel?.simulations[0] ? Math.round(orkModel.simulations[0].maxAltitude).toLocaleString() : "—"} <small>m</small></strong></div>
          <div className="metric"><span>MAX SPEED · CASE 1</span><strong>{orkModel?.simulations[0] ? orkModel.simulations[0].maxVelocity.toFixed(1) : "—"} <small>m/s</small></strong></div>
          <div className="metric"><span>MAX MACH · CASE 1</span><strong>{orkModel?.simulations[0] ? orkModel.simulations[0].maxMach.toFixed(3) : "—"}</strong></div>
          <div className="metric metric-alert"><span>WARNINGS · CASE 1</span><strong>{orkModel?.simulations[0]?.warnings.length ?? 0}</strong><em>Review</em></div>
        </> : <>
          <div className="metric"><span>VEHICLE LENGTH</span><strong>{Math.round((orkModel?.length ?? 0) * 1000).toLocaleString()} <small>mm</small></strong></div>
          <div className="metric"><span>MAX DIAMETER</span><strong>{Math.round((orkModel?.maxRadius ?? 0) * 2000)} <small>mm</small></strong></div>
          <div className="metric"><span>PARSED COMPONENTS</span><strong>{orkModel?.components.length ?? 0} <small>items</small></strong></div>
          <div className="metric"><span>SAVED SIMULATIONS</span><strong>{orkModel?.simulations.length ?? 0} <small>cases</small></strong></div>
          <div className="metric"><span>WORKING VERSION</span><strong>{workspaceVersion ?? "—"} <small>{saveState === "saved" ? "Current" : saveState}</small></strong></div>
        </>}
      </section>

      {workspaceModule === "configuration" && <div
        ref={mainGridRef}
        className="main-grid"
        style={{ "--tree-pane-width": `${paneWidths.tree}px`, "--record-pane-width": `${paneWidths.record}px` } as CSSProperties}
      >
        <div className="pane-resizer pane-resizer-tree" role="separator" aria-label="Resize component tree" aria-orientation="vertical" tabIndex={0} style={{ left: `${paneWidths.tree - 5}px` }} onPointerDown={(event) => beginPaneResize("tree", event)} onKeyDown={(event) => resizePaneWithKeyboard("tree", event)} onDoubleClick={() => setPaneWidths(defaultPaneWidths)} />
        <div className="pane-resizer pane-resizer-record" role="separator" aria-label="Resize engineering record" aria-orientation="vertical" tabIndex={0} style={{ right: `${paneWidths.record - 5}px` }} onPointerDown={(event) => beginPaneResize("record", event)} onKeyDown={(event) => resizePaneWithKeyboard("record", event)} onDoubleClick={() => setPaneWidths(defaultPaneWidths)} />
        <aside className="component-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">STRUCTURE</span><h2>Component tree</h2></div>
            <button className="quiet-button" type="button" aria-label="Component options">•••</button>
          </div>
          <div className="tree-toolbar">
            <button className="tree-filter tree-filter-active" type="button">ALL <span>{components.length}</span></button>
            <button className="tree-filter" type="button">REVIEW <span>{components.filter((component) => component.status === "review").length}</span></button>
          </div>
          <div className="component-tree">
            {components.map((component) => (
              <button
                key={component.id}
                type="button"
                className={`component-row ${component.id === selectedId ? "component-selected" : ""}`}
                style={{ paddingLeft: `${16 + component.depth * 18}px` }}
                onClick={() => setSelectedId(component.id)}
              >
                <span className="tree-branch">{component.depth === 0 ? "⌄" : component.depth === 1 ? "└" : "·"}</span>
                <span className="component-icon">{component.type.includes("fin") ? "△" : component.type.includes("tube") ? "▯" : "◇"}</span>
                <span className="component-copy"><strong>{component.name}</strong><small>{component.code}</small></span>
                <StatusDot status={component.status} />
              </button>
            ))}
          </div>
          <div className="tree-legend">
            <span><StatusDot status="verified" /> Verified</span>
            <span><StatusDot status="review" /> Review</span>
            <span><StatusDot status="draft" /> Draft</span>
          </div>
        </aside>

        <section className="model-panel panel">
          <div className="model-toolbar">
            <div className="view-tabs">
              <button className={`view-tab ${viewMode === "components" ? "view-tab-active" : ""}`} type="button" onClick={() => setViewMode("components")}>COMPONENTS</button>
              <button className={`view-tab ${viewMode === "3d" ? "view-tab-active" : ""}`} type="button" onClick={() => setViewMode("3d")}>3D ASSEMBLY</button>
            </div>
            <div className={`roll-control ${viewMode === "components" ? "roll-control-compact" : ""}`} aria-label="Longitudinal roll control">
              <button type="button" aria-label="Roll left 15 degrees" onClick={() => changeRoll(-15)}>↶</button>
              <label>ROLL <input type="range" min="0" max="360" step="1" value={rollDegrees} onChange={(event) => setRollDegrees(Number(event.target.value))} /></label>
              <output>{rollDegrees}°</output>
              <button type="button" aria-label="Roll right 15 degrees" onClick={() => changeRoll(15)}>↷</button>
            </div>
            <div className="model-controls">
              <button type="button" aria-label="Zoom out" onClick={() => activeView()?.zoomOut()}>−</button>
              <span>{viewMode === "components" ? "2D" : "3D"}</span>
              <button type="button" aria-label="Zoom in" onClick={() => activeView()?.zoomIn()}>＋</button>
              <button type="button" aria-label="Fit model" onClick={() => activeView()?.reset()}>⌗</button>
            </div>
          </div>

          <div className="model-stage">
            <div className="rocket-wrap">
              {viewMode === "components" ? (
                <RocketSectionView ref={sectionRef} model={orkModel} selectedId={selectedId} onSelect={setSelectedId} rollDegrees={rollDegrees} onRoll={changeRoll} accent={accent} themeKey={themeMode} />
              ) : (
                <RocketViewer ref={viewerRef} model={orkModel} selectedId={selectedId} onSelect={setSelectedId} accent={accent} themeKey={themeMode} rollDegrees={rollDegrees} />
              )}
              {!orkModel && <div className="model-loading">{saveState === "loading" ? "READING OPENROCKET GEOMETRY…" : "NO .ORK FILE · IMPORT ONE TO INITIALISE THIS PROJECT"}</div>}
            </div>
            {vehicleAnalysis && <section className="vehicle-analysis" data-state={analysisState} aria-label="OpenRocket vehicle analysis">
              <div className="analysis-readout analysis-vehicle">
                <strong>{orkModel?.name ?? "Vehicle"}</strong>
                <span>Length {Math.round((orkModel?.length ?? 0) * 1000)} mm · max diameter {Math.round((orkModel?.maxRadius ?? 0) * 2000)} mm</span>
                <span>Mass without motors {vehicleAnalysis.dryMass === "—" ? "Core calculating…" : `${vehicleAnalysis.dryMass} kg`}</span>
                <span>Mass with motors {vehicleAnalysis.loadedMass === "—" ? "Core calculating…" : `${vehicleAnalysis.loadedMass} kg`}</span>
              </div>
              <div className="analysis-readout analysis-stability">
                <strong>Stability {vehicleAnalysis.stability} cal / {vehicleAnalysis.stabilityPercent}%</strong>
                <span><b className="analysis-marker marker-cg" />CG: {vehicleAnalysis.cg} mm</span>
                <span><b className="analysis-marker marker-cp" />CP: {vehicleAnalysis.cp} mm</span>
                <small>at M={vehicleAnalysis.referenceMach}</small>
              </div>
              <div className="analysis-readout analysis-flight">
                <strong>Flight configuration: {vehicleAnalysis.configuration}</strong>
                <span>Apogee: {vehicleAnalysis.apogee} m</span>
                <span>Max. velocity: {vehicleAnalysis.maxVelocity} m/s (Mach {vehicleAnalysis.maxMach})</span>
                <span>Max. acceleration: {vehicleAnalysis.maxAcceleration} m/s²</span>
              </div>
              <div className="analysis-state"><i />{analysisStateLabel[analysisState]}<small>{analysisState === "current" ? ` · V${workspaceVersion ?? "—"} · CORE ${analysisEngineVersion || "—"}` : analysisState === "calculating" ? " · last result shown" : analysisState === "stale" ? " · saves before calculation" : analysisState === "failed" ? " · saved result shown" : analysisCalculatedAt ? ` · ${new Date(analysisCalculatedAt).toLocaleTimeString()}` : ""}</small></div>
            </section>}
            <div className="model-footer">
              <span>MODEL SOURCE <strong>{orkModel?.sourceName.toUpperCase() ?? "WAITING FOR .ORK"}</strong></span>
              <span>LAST SAVED BY <strong>{lastSavedBy || "CONNECTING"}</strong></span>
              <span className="model-valid"><b>✓</b> {orkModel ? "ORK PARSED" : "LOADING"}</span>
            </div>
          </div>
        </section>

        <aside className={`inspector-panel panel ${selectedId ? "" : "inspector-empty"}`}>
          {!selectedId ? (
            <div className="empty-selection">
              <span>NO COMPONENT SELECTED</span>
              <p>Select geometry or a component-tree item to inspect its OpenRocket parameters.</p>
            </div>
          ) : (<>
          <div className="inspector-identity">
            <div className="inspector-code">ENGINEERING RECORD · {selected.code}</div>
            <StatusDot status={selected.status} />
            <h2>{selected.name}</h2>
            <p>{selected.type} · controlled against ORK V{workspaceVersion ?? "—"}</p>
          </div>
          <div className="inspector-tabs inspector-tabs-four">
            <button type="button" className={activePanel === "properties" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("properties")}>DESIGN</button>
            <button type="button" className={activePanel === "records" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("records")}>RECORDS <span>{componentRecord.artifacts.length}</span></button>
            <button type="button" className={activePanel === "tests" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("tests")}>TESTS <span>{componentRecord.tests.filter((test) => test.status === "required").length}</span></button>
            <button type="button" className={activePanel === "comments" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("comments")}>TEAM <span>{componentRecord.comments.length}</span></button>
          </div>

          {activePanel === "properties" && (
            <div className="inspector-body">
              <div className="section-label"><span>OPENROCKET PARAMETERS</span><button type="button">⌃</button></div>
              <label className="field-label">Component name<input value={selected.name} disabled={!can("editOrk")} onChange={(event) => updateSelected("name", event.target.value)} /></label>
              <div className="field-grid">
                <label className="field-label">Length<div className="unit-field"><input type="number" value={selected.length} disabled={!can("editOrk")} onChange={(event) => updateSelected("length", Number(event.target.value))} /><span>mm</span></div></label>
                <label className="field-label">Diameter<div className="unit-field"><input type="number" value={selected.diameter} disabled={!can("editOrk")} onChange={(event) => updateSelected("diameter", Number(event.target.value))} /><span>mm</span></div></label>
              </div>
              {selected.wallThickness !== undefined && <div className="field-grid">
                <label className="field-label">Wall thickness<div className="unit-field"><input type="number" min="0" step="0.1" value={selected.wallThickness} disabled={!can("editOrk")} onChange={(event) => updateSelected("wallThickness", Number(event.target.value))} /><span>mm</span></div></label>
                <label className="field-label">Inner diameter<div className="unit-field unit-readonly"><input readOnly value={Math.max(0, selected.diameter - 2 * selected.wallThickness).toFixed(1)} /><span>mm</span></div></label>
              </div>}
              <div className="field-grid">
                <label className="field-label">As-built mass<div className="unit-field"><input type="number" step="0.01" value={selected.mass} disabled={!can("editOrk")} onChange={(event) => updateSelected("mass", Number(event.target.value))} /><span>kg</span></div></label>
                <label className="field-label">Material<input value={selected.material} disabled={!can("editOrk")} onChange={(event) => updateSelected("material", event.target.value)} /></label>
              </div>

              <div className="section-label section-spaced"><span>CONFIGURATION STATUS</span><button type="button">⌃</button></div>
              <div className="status-card">
                <div><span className="status-icon">!</span><p><strong>{selected.status === "verified" ? "Released component" : selected.status === "draft" ? "Draft changes" : "Review in progress"}</strong><small>{selected.status === "verified" ? "Evidence and properties verified" : "1 approval required before release"}</small></p></div>
                <button type="button" onClick={() => setActivePanel("comments")}>Open team record →</button>
              </div>

              <div className="section-label section-spaced"><span>RECORD COVERAGE</span><button type="button" onClick={() => setActivePanel("records")}>Open records</button></div>
              <div className="record-coverage">
                <button type="button" onClick={() => setActivePanel("records")}><strong>{componentRecord.artifacts.filter((item) => item.category === "drawing" && item.status === "current").length}</strong><span>current drawings</span></button>
                <button type="button" onClick={() => setActivePanel("tests")}><strong>{componentRecord.tests.filter((item) => item.status === "required").length}</strong><span>tests required</span></button>
                <button type="button" onClick={() => setActivePanel("records")}><strong>{componentRecord.artifacts.filter((item) => item.category === "photo" || item.category === "video").length}</strong><span>photos / videos</span></button>
              </div>
            </div>
          )}

          {activePanel === "records" && (
            <div className="inspector-body record-panel-body">
              <div className="record-heading">
                <div><span className="eyebrow">CONTROLLED EVIDENCE</span><h3>Part records</h3></div>
                <span className="version-lock">ORK V{workspaceVersion ?? "—"}</span>
              </div>
              <div className="record-metrics">
                <div><strong>{componentRecord.artifacts.filter((item) => item.category === "drawing" && item.status === "current").length}</strong><span>drawings</span></div>
                <div><strong>{componentRecord.artifacts.filter((item) => item.category === "test-evidence").length}</strong><span>test files</span></div>
                <div><strong>{componentRecord.artifacts.filter((item) => item.category === "photo" || item.category === "video").length}</strong><span>media</span></div>
              </div>
              <section className="record-uploader" aria-label="Add engineering record">
                <div className="record-form-grid">
                  <label>Record type<select value={uploadCategory} disabled={!can("uploadEvidence")} onChange={(event) => setUploadCategory(event.target.value as EngineeringArtifact["category"])}><option value="drawing">Engineering drawing</option><option value="document">Document / analysis</option><option value="test-evidence">Test evidence</option><option value="photo">Photo</option><option value="video">Video</option></select></label>
                  <label>Revision<input value={uploadRevision} disabled={!can("uploadEvidence")} onChange={(event) => setUploadRevision(event.target.value.toUpperCase())} maxLength={24} /></label>
                </div>
                <label>Controlled title<input value={recordTitle} disabled={!can("uploadEvidence")} onChange={(event) => setRecordTitle(event.target.value)} placeholder="Defaults to the file name" /></label>
                <input ref={documentInput} className="visually-hidden" type="file" accept={uploadCategory === "photo" ? "image/*" : uploadCategory === "video" ? "video/*" : undefined} onChange={attachDocument} />
                <button className="record-upload-button" type="button" disabled={!can("uploadEvidence")} onClick={() => documentInput.current?.click()}><span>＋</span><div><strong>{can("uploadEvidence") ? "Select file to add" : "Viewer access"}</strong><small>{can("uploadEvidence") ? "Revision, author, time and ORK version are captured automatically" : "Ask a lead or engineer to add controlled evidence"}</small></div></button>
              </section>

              <div className="record-section-title"><span>DRAWINGS &amp; REVISION HISTORY</span><small>{componentRecord.artifacts.filter((item) => item.category === "drawing").length}</small></div>
              <div className="engineering-record-list">
                {componentRecord.artifacts.filter((item) => item.category === "drawing").map((artifact) => (
                  <a key={artifact.id} href={`/api/component-records?projectId=${encodeURIComponent(workspace.project.id)}&componentId=${encodeURIComponent(selected.id)}&artifactId=${artifact.id}&download=1`} target="_blank" rel="noreferrer" className={artifact.status === "superseded" ? "record-superseded" : ""}>
                    <span className="record-file-kind">DWG</span><div><strong>{artifact.title}</strong><small>REV {artifact.revision} · {artifact.status.toUpperCase()} · {recordSize(artifact.sizeBytes)}</small><em>{artifact.uploadedByName} · ORK V{artifact.orkVersion ?? "—"} · {recordDate(artifact.createdAt)}</em></div><b>↗</b>
                  </a>
                ))}
                {!recordLoading && !componentRecord.artifacts.some((item) => item.category === "drawing") && <div className="record-empty"><strong>No controlled drawing yet</strong><span>Add the released or working drawing above. New revisions retain the earlier file.</span></div>}
              </div>

              <div className="record-section-title"><span>DOCUMENTS, TEST EVIDENCE &amp; MEDIA</span><small>{componentRecord.artifacts.filter((item) => item.category !== "drawing").length}</small></div>
              <div className="engineering-record-list">
                {componentRecord.artifacts.filter((item) => item.category !== "drawing").map((artifact) => (
                  <a key={artifact.id} href={`/api/component-records?projectId=${encodeURIComponent(workspace.project.id)}&componentId=${encodeURIComponent(selected.id)}&artifactId=${artifact.id}&download=1`} target="_blank" rel="noreferrer">
                    <span className="record-file-kind">{artifact.category === "test-evidence" ? "TEST" : artifact.category === "photo" ? "IMG" : artifact.category === "video" ? "VID" : "DOC"}</span><div><strong>{artifact.title}</strong><small>{artifact.category.replace("-", " ").toUpperCase()} · REV {artifact.revision} · {recordSize(artifact.sizeBytes)}</small><em>{artifact.uploadedByName} · ORK V{artifact.orkVersion ?? "—"} · {recordDate(artifact.createdAt)}</em></div><b>↗</b>
                  </a>
                ))}
                {!recordLoading && !componentRecord.artifacts.some((item) => item.category !== "drawing") && <div className="record-empty"><strong>No supporting evidence yet</strong><span>Add analysis, test files, inspection photos or video.</span></div>}
              </div>
            </div>
          )}

          {activePanel === "tests" && (
            <div className="inspector-body record-panel-body">
              <div className="record-heading"><div><span className="eyebrow">VERIFICATION</span><h3>Test requirements</h3></div><span className="version-lock">{componentRecord.tests.filter((test) => test.status === "required").length} OPEN</span></div>
              <section className={`test-create-card ${!can("createTest") ? "test-create-locked" : ""}`}>
                {!can("createTest") && <p className="role-guidance">Only a team lead can issue a new test requirement.</p>}
                <label>Test title<input value={testTitle} disabled={!can("createTest")} onChange={(event) => setTestTitle(event.target.value)} placeholder="e.g. Axial compression proof test" /></label>
                <label>Acceptance requirement<textarea value={testRequirement} disabled={!can("createTest")} onChange={(event) => setTestRequirement(event.target.value)} placeholder="State a measurable limit, method and pass criterion." /></label>
                <button type="button" disabled={!can("createTest")} onClick={createRequiredTest}>＋ Add required test</button>
              </section>
              <div className="record-section-title"><span>REQUIRED</span><small>{componentRecord.tests.filter((test) => test.status === "required").length}</small></div>
              <div className="test-list">
                {componentRecord.tests.filter((test) => test.status === "required").map((test) => (
                  <article key={test.id} className="test-card test-required"><div className="test-state">REQ</div><div><h4>{test.title}</h4><p>{test.requirement}</p><small>Owner {test.ownerName} · ORK V{test.orkVersion ?? "—"} · {recordDate(test.createdAt)}</small><button type="button" disabled={!can("completeTest")} onClick={() => completeRequiredTest(test)}>Mark test complete</button></div></article>
                ))}
                {!recordLoading && !componentRecord.tests.some((test) => test.status === "required") && <div className="record-empty"><strong>No open test requirements</strong><span>Add one when this part needs verification before release.</span></div>}
              </div>
              <div className="record-section-title"><span>COMPLETE</span><small>{componentRecord.tests.filter((test) => test.status === "complete").length}</small></div>
              <div className="test-list">
                {componentRecord.tests.filter((test) => test.status === "complete").map((test) => (
                  <article key={test.id} className="test-card test-complete"><div className="test-state">✓</div><div><h4>{test.title}</h4><p>{test.completionNotes}</p><small>{test.completedByName} · ORK V{test.orkVersion ?? "—"} · {recordDate(test.completedAt)}</small></div></article>
                ))}
              </div>
            </div>
          )}

          {activePanel === "comments" && (
            <div className="inspector-body record-panel-body">
              <div className="record-heading"><div><span className="eyebrow">TEAM THREAD</span><h3>Discussion &amp; decisions</h3></div><span className="version-lock">{componentRecord.comments.length} NOTES</span></div>
              <section className="comment-composer">
                <textarea value={commentDraft} disabled={!can("comment")} onChange={(event) => setCommentDraft(event.target.value)} placeholder={can("comment") ? "Record a decision, ask a question, or type @ to tag a teammate…" : "Viewer access; comments are read-only."} />
                <div className="mention-row"><span>MENTION</span>{workspace.team.members.map((member) => member.displayName).filter((name) => name !== user.name).map((name) => <button key={name} type="button" disabled={!can("comment")} onClick={() => insertMention(name)}>@{personInitials(name)}</button>)}</div>
                <button className="comment-submit" type="button" disabled={!commentDraft.trim() || !can("comment")} onClick={postComment}>Post to part record</button>
              </section>
              <div className="comment-thread">
                {componentRecord.comments.map((comment) => (
                  <article key={comment.id}><span className="comment-avatar">{personInitials(comment.authorName)}</span><div><header><strong>{comment.authorName}</strong><time>{recordDate(comment.createdAt)}</time></header><p>{comment.body}</p><footer><span>ORK V{comment.orkVersion ?? "—"}</span>{comment.mentions.map((mention) => <em key={mention}>@{mention}</em>)}</footer></div></article>
                ))}
                {!recordLoading && !componentRecord.comments.length && <div className="record-empty"><strong>No discussion yet</strong><span>Use this thread for engineering decisions and review questions—not transient chat.</span></div>}
              </div>
              <div className="record-section-title"><span>TRACE LOG</span><small>{componentRecord.events.length}</small></div>
              <div className="record-event-list">
                {componentRecord.events.slice(0, 12).map((event) => <article key={event.id}><span>{event.action.toUpperCase()}</span><div><strong>{event.summary}</strong><small>{event.authorName} · ORK V{event.orkVersion ?? "—"} · {recordDate(event.createdAt)}</small></div></article>)}
              </div>
            </div>
          )}
          </>)}
        </aside>
      </div>}

      {workspaceModule === "simulation" && <SimulationWorkspace key={`${workspace.project.id}:${workspaceVersion ?? "none"}`} model={orkModel} mode={mode} workspaceVersion={workspaceVersion} headers={collaborationHeaders} canRun={can("editOrk") && (mode === "demo" || saveState === "saved")} runBlockedReason={!can("editOrk") ? "Your team role cannot edit or calculate this configuration." : saveState === "offline" ? "The simulation setup has not reached the shared file. Co-Roc will retry automatically when the connection recovers." : saveState === "conflict" ? "A teammate saved another version first. Resolve the shared-file conflict before calculating." : saveState !== "saved" ? "The simulation setup is still being written to the shared ORK." : undefined} onNotice={setNotice} onModelChange={updateSimulationModel} />}
      {workspaceModule === "history" && <RevisionWorkspace changes={auditChanges} onOpenComponent={(componentId) => openComponentWorkspace(componentId)} />}
      {(workspaceModule === "tests" || workspaceModule === "documents") && <ProjectRecordWorkspace kind={workspaceModule} components={components} headers={collaborationHeaders} projectId={workspace.project.id} onSelectComponent={(componentId, panel) => openComponentWorkspace(componentId, panel)} onNotice={setNotice} />}

      {saveState === "conflict" && <div className="conflict-banner"><span><strong>Live save paused.</strong> {conflictMessage || "A teammate saved a newer working copy."}</span><button type="button" onClick={reloadSharedOrk}>Reload shared file</button></div>}

      <footer className="statusbar">
        <div className="status-message"><span className="pulse-dot" />{notice}</div>
        <div className="statusbar-right">
          {user.preview && <span className="preview-pill">{mode === "demo" ? "DEMO · NOT SAVED" : `LOCAL ${workspace.team.role.toUpperCase()}`}</span>}
          <span>{mode === "demo" ? "LOCAL ORK" : `LIVE ORK · V${workspaceVersion ?? "—"}`}</span><span>FORMAT 1.12</span><span>SI UNITS</span>
        </div>
      </footer>

      {revisionOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRevisionOpen(false)}>
          <section className="revision-modal" role="dialog" aria-modal="true" aria-labelledby="revision-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-mark">R29</div>
            <span className="eyebrow">CONTROLLED CHANGE</span>
            <h2 id="revision-title">Create a new revision</h2>
            <p>Capture the current draft as an immutable engineering record.</p>
            <label className="field-label">Revision message<input autoFocus value={revisionName} onChange={(event) => setRevisionName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createRevision()} /></label>
            <div className="change-preview">
              <span>1</span><p><strong>{selected.code}</strong><small>{selected.name} · Properties and linked evidence</small></p><em>MODIFIED</em>
            </div>
            <div className="modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setRevisionOpen(false)}>Cancel</button>
              <button className="button button-primary" type="button" onClick={createRevision}>Create revision</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

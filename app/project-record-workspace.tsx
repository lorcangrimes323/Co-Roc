"use client";

import { useEffect, useMemo, useState } from "react";

type ComponentNode = { id: string; name: string; code: string; depth: number };
type Artifact = { id: number; componentId: string; componentCode: string; category: string; title: string; revision: string; status: string; fileName: string; sizeBytes: number; uploadedByName: string; createdAt: string };
type Test = { id: number; componentId: string; componentCode: string; title: string; requirement: string; status: string; ownerName: string; completedByName: string | null; createdAt: string; updatedAt: string };

function demoComponent(components: ComponentNode[], code: string, fallback = 1) {
  return components.find((component) => component.code === code) ?? components[Math.min(fallback, Math.max(0, components.length - 1))] ?? { id: "vehicle", name: "Vehicle", code: "ORK", depth: 0 };
}

function demoRecords(components: ComponentNode[]) {
  const aftBody = demoComponent(components, "BT-003");
  const fins = demoComponent(components, "FIN-001", 2);
  const coupler = demoComponent(components, "TC-001", 3);
  const recovery = demoComponent(components, "PAR-001", 4);
  const avionics = demoComponent(components, "BT-002", 5);
  const artifact = (id: number, component: ComponentNode, values: Omit<Artifact, "id" | "componentId" | "componentCode">): Artifact => ({ id, componentId: component.id, componentCode: component.code, ...values });
  const test = (id: number, component: ComponentNode, values: Omit<Test, "id" | "componentId" | "componentCode">): Test => ({ id, componentId: component.id, componentCode: component.code, ...values });
  return {
    artifacts: [
      artifact(101, aftBody, { category: "drawing", title: "Aft airframe manufacturing drawing", revision: "C", status: "current", fileName: "L4C-STR-214_Aft-Airframe_Rev-C.pdf", sizeBytes: 1843200, uploadedByName: "Maya Chen", createdAt: "2026-07-24T14:20:00Z" }),
      artifact(102, fins, { category: "drawing", title: "Fin root and bonding detail", revision: "B", status: "current", fileName: "L4C-STR-226_Fin-Bond_Rev-B.pdf", sizeBytes: 1264000, uploadedByName: "Lorcan Grimes", createdAt: "2026-07-22T09:45:00Z" }),
      artifact(103, fins, { category: "drawing", title: "Fin root and bonding detail", revision: "A", status: "superseded", fileName: "L4C-STR-226_Fin-Bond_Rev-A.pdf", sizeBytes: 1189000, uploadedByName: "Lorcan Grimes", createdAt: "2026-07-08T16:10:00Z" }),
      artifact(104, coupler, { category: "document", title: "Avionics bay interface control document", revision: "B", status: "current", fileName: "L4C-ICD-031_Avionics-Bay.pdf", sizeBytes: 842000, uploadedByName: "Oscar Reid", createdAt: "2026-07-25T11:30:00Z" }),
      artifact(105, aftBody, { category: "document", title: "Composite laminate substantiation", revision: "2", status: "current", fileName: "L4C-AN-018_Laminate-Analysis.pdf", sizeBytes: 3640000, uploadedByName: "Maya Chen", createdAt: "2026-07-20T13:05:00Z" }),
      artifact(106, fins, { category: "test-evidence", title: "Fin proof-load test report", revision: "1", status: "current", fileName: "L4C-TR-044_Fin-Proof-Load.pdf", sizeBytes: 2180000, uploadedByName: "Oscar Reid", createdAt: "2026-07-27T15:42:00Z" }),
      artifact(107, recovery, { category: "photo", title: "Main parachute packing inspection", revision: "1", status: "current", fileName: "PAR-001_pack-inspection.jpg", sizeBytes: 2980000, uploadedByName: "Maya Chen", createdAt: "2026-07-28T10:18:00Z" }),
      artifact(108, avionics, { category: "video", title: "Avionics bay functional test", revision: "1", status: "current", fileName: "AV-FT-006_functional-test.mp4", sizeBytes: 24600000, uploadedByName: "Oscar Reid", createdAt: "2026-07-28T17:36:00Z" }),
    ],
    tests: [
      test(201, fins, { title: "Fin assembly proof load", requirement: "Demonstrate 1.5 times the predicted maximum aerodynamic root bending load with no permanent deformation, cracking or bond-line separation.", status: "complete", ownerName: "Structures lead", completedByName: "Oscar Reid", createdAt: "2026-07-12T09:00:00Z", updatedAt: "2026-07-27T15:42:00Z" }),
      test(202, aftBody, { title: "Airframe axial compression", requirement: "Verify the cured aft airframe sustains the design compression load with positive margin and no local buckling or laminate damage.", status: "complete", ownerName: "Structures lead", completedByName: "Maya Chen", createdAt: "2026-07-10T10:15:00Z", updatedAt: "2026-07-26T13:20:00Z" }),
      test(203, coupler, { title: "Avionics bay separation test", requirement: "Confirm both separation interfaces operate at the qualified charge level and retain independent continuity indication.", status: "required", ownerName: "Avionics lead", completedByName: null, createdAt: "2026-07-21T08:40:00Z", updatedAt: "2026-07-29T12:05:00Z" }),
      test(204, recovery, { title: "Main recovery deployment", requirement: "Ground-deploy the packed main parachute through the flight airframe using the released harness and retention arrangement.", status: "complete", ownerName: "Recovery lead", completedByName: "Lorcan Grimes", createdAt: "2026-07-18T14:00:00Z", updatedAt: "2026-07-28T10:18:00Z" }),
      test(205, avionics, { title: "Radio range and telemetry continuity", requirement: "Maintain command and telemetry margin at the maximum expected ground range with the vehicle in launch configuration.", status: "required", ownerName: "Avionics lead", completedByName: null, createdAt: "2026-07-25T11:00:00Z", updatedAt: "2026-07-29T16:25:00Z" }),
      test(206, aftBody, { title: "As-built mass and CG verification", requirement: "Measure flight-ready mass and centre of gravity; confirm both remain within the V2 release limits before launch approval.", status: "required", ownerName: "Systems lead", completedByName: null, createdAt: "2026-07-29T09:10:00Z", updatedAt: "2026-07-30T08:30:00Z" }),
    ],
  };
}

function date(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectRecordWorkspace({ kind, components, headers, projectId, mode, onSelectComponent, onNotice }: {
  kind: "documents" | "tests";
  components: ComponentNode[];
  headers: () => Record<string, string>;
  projectId: string;
  mode: "live" | "demo";
  onSelectComponent: (componentId: string, panel: "records" | "tests") => void;
  onNotice: (message: string) => void;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [selectedId, setSelectedId] = useState("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (mode === "demo") {
      const records = demoRecords(components);
      setArtifacts(records.artifacts);
      setTests(records.tests);
      setLoading(false);
      return;
    }
    let active = true;
    fetch("/api/project-records", { headers: headers(), cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Project records unavailable");
        return response.json() as Promise<{ artifacts?: Artifact[]; tests?: Test[] }>;
      })
      .then((payload) => { if (active) { setArtifacts(payload.artifacts ?? []); setTests(payload.tests ?? []); } })
      .catch(() => active && onNotice("Project records could not be loaded"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
    // `headers` and `onNotice` are supplied by the workspace shell; projectId is the reload boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, mode]);

  const filteredArtifacts = useMemo(() => selectedId === "all" ? artifacts : artifacts.filter((item) => item.componentId === selectedId), [artifacts, selectedId]);
  const filteredTests = useMemo(() => selectedId === "all" ? tests : tests.filter((item) => item.componentId === selectedId), [tests, selectedId]);
  const selectedName = selectedId === "all" ? "Whole vehicle" : components.find((component) => component.id === selectedId)?.name ?? "Component";
  const countFor = (id: string) => kind === "documents" ? artifacts.filter((item) => item.componentId === id).length : tests.filter((item) => item.componentId === id).length;

  return <section className="workspace-module records-module">
    <aside className="module-tree feature-tree">
      <header><span className="eyebrow">FEATURE TREE</span><h2>{kind === "documents" ? "Documentation" : "Verification tests"}</h2></header>
      <div className="module-tree-list">
        <button className={selectedId === "all" ? "active" : ""} type="button" onClick={() => setSelectedId("all")}><span className="tree-index">Σ</span><span><strong>Whole vehicle</strong><small>{kind === "documents" ? artifacts.length : tests.length} records</small></span></button>
        {components.map((component) => <button key={component.id} className={selectedId === component.id ? "active" : ""} type="button" style={{ paddingLeft: `${12 + Math.min(3, component.depth) * 14}px` }} onClick={() => setSelectedId(component.id)}><span className="tree-index">{component.depth ? "└" : "◇"}</span><span><strong>{component.name}</strong><small>{component.code} · {countFor(component.id)}</small></span></button>)}
      </div>
      <footer>Records follow the same assembly hierarchy as the working .ork.</footer>
    </aside>
    <div className="records-content">
      <header className="module-titlebar"><div><span className="eyebrow">{kind === "documents" ? "CONTROLLED ENGINEERING RECORDS" : "VERIFICATION REGISTER"}</span><h2>{selectedName}</h2><p>{kind === "documents" ? "Drawings, analysis, evidence, photos and video by component." : "Required and completed tests across the vehicle."}</p></div></header>
      {kind === "documents" ? <>
        <div className="record-register-metrics"><div><strong>{filteredArtifacts.filter((item) => item.category === "drawing" && item.status === "current").length}</strong><span>current drawings</span></div><div><strong>{filteredArtifacts.filter((item) => item.category === "document").length}</strong><span>documents / analyses</span></div><div><strong>{filteredArtifacts.filter((item) => item.category === "test-evidence").length}</strong><span>test evidence</span></div><div><strong>{filteredArtifacts.filter((item) => item.category === "photo" || item.category === "video").length}</strong><span>photos / videos</span></div></div>
        <div className="register-table"><div className="register-head"><span>COMPONENT</span><span>RECORD</span><span>REVISION</span><span>STATUS</span><span>OWNER / DATE</span></div>{filteredArtifacts.map((artifact) => <a key={artifact.id} href={mode === "demo" ? "#" : `/api/component-records?projectId=${encodeURIComponent(projectId)}&componentId=${encodeURIComponent(artifact.componentId)}&artifactId=${artifact.id}&download=1`} target={mode === "demo" ? undefined : "_blank"} rel={mode === "demo" ? undefined : "noreferrer"} onClick={mode === "demo" ? (event) => { event.preventDefault(); onNotice(`${artifact.title} is a demonstration record`); } : undefined}><span><strong>{artifact.componentCode}</strong></span><span><strong>{artifact.title}</strong><small>{artifact.category.replace("-", " ")} · {artifact.fileName} · {size(artifact.sizeBytes)}</small></span><span>REV {artifact.revision}</span><span className={artifact.status === "current" ? "register-current" : "register-muted"}>{artifact.status}</span><span><strong>{artifact.uploadedByName}</strong><small>{date(artifact.createdAt)}</small></span></a>)}</div>
        {!loading && !filteredArtifacts.length && <div className="module-empty large">No controlled records are linked to this selection.</div>}
      </> : <>
        <div className="record-register-metrics"><div><strong>{filteredTests.filter((item) => item.status === "required").length}</strong><span>required</span></div><div><strong>{filteredTests.filter((item) => item.status === "complete").length}</strong><span>complete</span></div><div><strong>{filteredTests.length}</strong><span>total requirements</span></div><div><strong>{new Set(filteredTests.map((item) => item.componentId)).size}</strong><span>components covered</span></div></div>
        <div className="test-register">{filteredTests.map((test) => <article key={test.id}><span className={`test-register-state ${test.status === "complete" ? "complete" : "required"}`}>{test.status === "complete" ? "PASS" : "REQ"}</span><div><header><strong>{test.title}</strong><button type="button" onClick={() => onSelectComponent(test.componentId, "tests")}>{test.componentCode} ↗</button></header><p>{test.requirement}</p><small>{test.status === "complete" ? `Completed by ${test.completedByName ?? "team"}` : `Owner ${test.ownerName}`} · {date(test.updatedAt || test.createdAt)}</small></div></article>)}</div>
        {!loading && !filteredTests.length && <div className="module-empty large">No test requirements are linked to this selection.</div>}
      </>}
    </div>
  </section>;
}

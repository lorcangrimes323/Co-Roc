"use client";

import { useEffect, useMemo, useState } from "react";

type ComponentNode = { id: string; name: string; code: string; depth: number };
type Artifact = { id: number; componentId: string; componentCode: string; category: string; title: string; revision: string; status: string; fileName: string; sizeBytes: number; uploadedByName: string; createdAt: string };
type Test = { id: number; componentId: string; componentCode: string; title: string; requirement: string; status: string; ownerName: string; completedByName: string | null; createdAt: string; updatedAt: string };

function date(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectRecordWorkspace({ kind, components, headers, projectId, onSelectComponent, onNotice }: {
  kind: "documents" | "tests";
  components: ComponentNode[];
  headers: () => Record<string, string>;
  projectId: string;
  onSelectComponent: (componentId: string, panel: "records" | "tests") => void;
  onNotice: (message: string) => void;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [selectedId, setSelectedId] = useState("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
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
  }, [projectId]);

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
        <div className="register-table"><div className="register-head"><span>COMPONENT</span><span>RECORD</span><span>REVISION</span><span>STATUS</span><span>OWNER / DATE</span></div>{filteredArtifacts.map((artifact) => <a key={artifact.id} href={`/api/component-records?projectId=${encodeURIComponent(projectId)}&componentId=${encodeURIComponent(artifact.componentId)}&artifactId=${artifact.id}&download=1`} target="_blank" rel="noreferrer"><span><strong>{artifact.componentCode}</strong></span><span><strong>{artifact.title}</strong><small>{artifact.category.replace("-", " ")} · {artifact.fileName} · {size(artifact.sizeBytes)}</small></span><span>REV {artifact.revision}</span><span className={artifact.status === "current" ? "register-current" : "register-muted"}>{artifact.status}</span><span><strong>{artifact.uploadedByName}</strong><small>{date(artifact.createdAt)}</small></span></a>)}</div>
        {!loading && !filteredArtifacts.length && <div className="module-empty large">No controlled records are linked to this selection.</div>}
      </> : <>
        <div className="record-register-metrics"><div><strong>{filteredTests.filter((item) => item.status === "required").length}</strong><span>required</span></div><div><strong>{filteredTests.filter((item) => item.status === "complete").length}</strong><span>complete</span></div><div><strong>{filteredTests.length}</strong><span>total requirements</span></div><div><strong>{new Set(filteredTests.map((item) => item.componentId)).size}</strong><span>components covered</span></div></div>
        <div className="test-register">{filteredTests.map((test) => <article key={test.id}><span className={`test-register-state ${test.status === "complete" ? "complete" : "required"}`}>{test.status === "complete" ? "PASS" : "REQ"}</span><div><header><strong>{test.title}</strong><button type="button" onClick={() => onSelectComponent(test.componentId, "tests")}>{test.componentCode} ↗</button></header><p>{test.requirement}</p><small>{test.status === "complete" ? `Completed by ${test.completedByName ?? "team"}` : `Owner ${test.ownerName}`} · {date(test.updatedAt || test.createdAt)}</small></div></article>)}</div>
        {!loading && !filteredTests.length && <div className="module-empty large">No test requirements are linked to this selection.</div>}
      </>}
    </div>
  </section>;
}

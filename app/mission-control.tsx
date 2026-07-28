"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type ComponentStatus = "verified" | "review" | "draft";

type RocketComponent = {
  id: string;
  name: string;
  code: string;
  type: string;
  status: ComponentStatus;
  depth: number;
  length: number;
  diameter: number;
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
    name: "BANSHEE Mk II",
    code: "LV-002",
    type: "Launch vehicle",
    status: "review",
    depth: 0,
    length: 3780,
    diameter: 157,
    mass: 23.84,
    material: "Mixed assembly",
    documents: [
      { name: "System architecture.pdf", meta: "REV C · 2.4 MB", state: "current" },
      { name: "Mass budget.xlsx", meta: "REV 18 · 186 KB", state: "current" },
    ],
  },
  {
    id: "nose",
    name: "Nose assembly",
    code: "NAS-100",
    type: "Nose cone",
    status: "verified",
    depth: 1,
    length: 620,
    diameter: 157,
    mass: 1.28,
    material: "CFRP / Rohacell",
    documents: [
      { name: "NAS-100 drawing.pdf", meta: "REV D · 1.8 MB", state: "current" },
      { name: "Laminate schedule.pdf", meta: "REV B · 642 KB", state: "current" },
    ],
  },
  {
    id: "payload",
    name: "Payload bay",
    code: "PAY-210",
    type: "Body tube",
    status: "verified",
    depth: 1,
    length: 540,
    diameter: 157,
    mass: 2.41,
    material: "T700 / Epoxy",
    documents: [
      { name: "Payload ICD.pdf", meta: "REV C · 980 KB", state: "current" },
      { name: "Tube inspection.csv", meta: "LOT 24-07 · 42 KB", state: "current" },
    ],
  },
  {
    id: "avionics",
    name: "Avionics bay",
    code: "AVN-320",
    type: "Assembly",
    status: "review",
    depth: 1,
    length: 410,
    diameter: 157,
    mass: 3.12,
    material: "CFRP / Aluminium",
    documents: [
      { name: "Avionics bay CAD.step", meta: "REV E · 8.1 MB", state: "current" },
      { name: "CATS Vega integration.pdf", meta: "REV A · 1.2 MB", state: "review" },
    ],
  },
  {
    id: "airframe",
    name: "Main airframe",
    code: "STR-410",
    type: "Composite tube",
    status: "review",
    depth: 1,
    length: 1080,
    diameter: 157,
    mass: 4.86,
    material: "T700 / Epoxy",
    documents: [
      { name: "STR-410 laminate.pdf", meta: "REV F · 724 KB", state: "current" },
      { name: "Compression test.pdf", meta: "TEST 017 · 3.6 MB", state: "current" },
      { name: "Cure record.pdf", meta: "BATCH 08 · 890 KB", state: "review" },
    ],
  },
  {
    id: "motor",
    name: "Motor section",
    code: "MTR-500",
    type: "Motor mount",
    status: "verified",
    depth: 1,
    length: 810,
    diameter: 157,
    mass: 8.93,
    material: "G12 / Aluminium",
    documents: [
      { name: "Motor interface.pdf", meta: "REV C · 2.1 MB", state: "current" },
      { name: "Fastener schedule.csv", meta: "REV B · 28 KB", state: "current" },
    ],
  },
  {
    id: "fins",
    name: "Fin set",
    code: "AER-540",
    type: "Freeform fin set",
    status: "draft",
    depth: 2,
    length: 365,
    diameter: 8,
    mass: 1.74,
    material: "CFRP sandwich",
    documents: [
      { name: "Fin structural model.pdf", meta: "REV B · 4.7 MB", state: "review" },
      { name: "Core material cert.pdf", meta: "LOT 511 · 340 KB", state: "current" },
    ],
  },
  {
    id: "recovery",
    name: "Recovery system",
    code: "REC-600",
    type: "Recovery assembly",
    status: "verified",
    depth: 1,
    length: 320,
    diameter: 144,
    mass: 1.5,
    material: "Nylon / Kevlar",
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

function StatusDot({ status }: { status: ComponentStatus }) {
  return <span className={`status-dot status-${status}`} aria-label={status} />;
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon-box" aria-hidden="true">{children}</span>;
}

export function MissionControl({
  user,
}: {
  user: { name: string; email: string; preview: boolean };
}) {
  const [components, setComponents] = useState(initialComponents);
  const [selectedId, setSelectedId] = useState("airframe");
  const [activePanel, setActivePanel] = useState<"properties" | "documents" | "activity">("properties");
  const [activity, setActivity] = useState(initialActivity);
  const [notice, setNotice] = useState("Workspace synchronised");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionName, setRevisionName] = useState("STR-410 mass update");
  const fileInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => components.find((component) => component.id === selectedId) ?? components[0],
    [components, selectedId],
  );

  useEffect(() => {
    if (user.preview) return;

    let active = true;
    fetch(`/api/documents?componentId=${encodeURIComponent(selected.id)}`)
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
  }, [selected.id, user.preview]);

  function updateSelected<K extends keyof RocketComponent>(key: K, value: RocketComponent[K]) {
    setComponents((items) =>
      items.map((component) =>
        component.id === selected.id ? { ...component, [key]: value, status: "draft" } : component,
      ),
    );
    setNotice(`${selected.code} has unsaved changes`);
  }

  function importOrk(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ork")) {
      setNotice("Choose a valid OpenRocket .ork file");
      return;
    }
    setNotice(`${file.name} staged for component comparison`);
    event.target.value = "";
  }

  async function attachDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const newDocument = {
      name: file.name,
      meta: `NEW · ${Math.max(1, Math.round(file.size / 1024))} KB`,
      state: "review" as const,
    };
    setComponents((items) =>
      items.map((component) =>
        component.id === selected.id
          ? { ...component, documents: [newDocument, ...component.documents], status: "review" }
          : component,
      ),
    );
    setNotice(`${file.name} linked to ${selected.code}`);
    if (!user.preview) {
      const form = new FormData();
      form.set("componentId", selected.id);
      form.set("file", file);
      try {
        const response = await fetch("/api/documents", { method: "POST", body: form });
        if (!response.ok) throw new Error("Upload failed");
        setNotice(`${file.name} securely linked to ${selected.code}`);
      } catch {
        setNotice(`${file.name} is visible locally but could not be uploaded`);
      }
    }
    event.target.value = "";
  }

  async function createRevision() {
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
    if (!user.preview) {
      try {
        const response = await fetch("/api/revisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: label, componentId: selected.id, componentCode: selected.code }),
        });
        if (!response.ok) throw new Error("Revision could not be saved");
        setNotice(`Revision saved · ${label}`);
      } catch {
        setNotice(`Revision is visible locally but could not be synchronised`);
      }
    }
  }

  const totalMass = components
    .filter((component) => component.depth === 1)
    .reduce((sum, component) => sum + component.mass, 0);

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
          <span className="project-kicker">ACTIVE VEHICLE</span>
          <button className="project-name" type="button">
            BANSHEE Mk II <span>⌄</span>
          </button>
        </div>

        <div className="topbar-actions">
          <div className="sync-state"><span className="pulse-dot" />LIVE</div>
          <div className="avatar-stack" aria-label="3 collaborators online">
            {collaborators.map((person) => (
              <span key={person.initials} className={`avatar avatar-${person.colour}`} title={person.name}>
                {person.initials}
              </span>
            ))}
          </div>
          <button className="user-menu" type="button" title={user.email}>
            <span>{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
            <span className="user-name">{user.name}</span>
          </button>
        </div>
      </header>

      <aside className="rail">
        <button className="rail-button rail-active" type="button" aria-label="Vehicle workspace"><Icon>◇</Icon></button>
        <button className="rail-button" type="button" aria-label="Documents"><Icon>▱</Icon></button>
        <button className="rail-button" type="button" aria-label="Revisions"><Icon>↺</Icon></button>
        <button className="rail-button" type="button" aria-label="Flight data"><Icon>⌁</Icon></button>
        <div className="rail-spacer" />
        <button className="rail-button" type="button" aria-label="Settings"><Icon>⚙</Icon></button>
      </aside>

      <section className="workspace-header">
        <div>
          <div className="breadcrumbs">VEHICLES / BANSHEE MK II / <strong>CONFIGURATION</strong></div>
          <div className="workspace-title-row">
            <h1>BANSHEE Mk II</h1>
            <span className="revision-badge"><span /> FLIGHT-02 · DRAFT</span>
          </div>
        </div>
        <div className="workspace-actions">
          <input ref={fileInput} className="visually-hidden" type="file" accept=".ork" onChange={importOrk} />
          <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()}>
            <span>⇧</span> Import .ORK
          </button>
          <button className="button button-primary" type="button" onClick={() => setRevisionOpen(true)}>
            <span>＋</span> Create revision
          </button>
        </div>
      </section>

      <section className="metrics-strip" aria-label="Vehicle summary">
        <div className="metric"><span>VEHICLE LENGTH</span><strong>3,780 <small>mm</small></strong></div>
        <div className="metric"><span>AS-BUILT MASS</span><strong>{totalMass.toFixed(2)} <small>kg</small></strong></div>
        <div className="metric"><span>STATIC MARGIN</span><strong>1.84 <small>cal</small></strong></div>
        <div className="metric"><span>DOCUMENTATION</span><strong>87 <small>%</small></strong><i><b style={{ width: "87%" }} /></i></div>
        <div className="metric metric-alert"><span>OPEN REVIEWS</span><strong>03</strong><em>Action required</em></div>
      </section>

      <div className="main-grid">
        <aside className="component-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">STRUCTURE</span><h2>Component tree</h2></div>
            <button className="quiet-button" type="button" aria-label="Component options">•••</button>
          </div>
          <div className="tree-toolbar">
            <button className="tree-filter tree-filter-active" type="button">ALL <span>8</span></button>
            <button className="tree-filter" type="button">REVIEW <span>3</span></button>
          </div>
          <div className="component-tree">
            {components.map((component) => (
              <button
                key={component.id}
                type="button"
                className={`component-row ${component.id === selected.id ? "component-selected" : ""}`}
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
              <button className="view-tab view-tab-active" type="button">ASSEMBLY</button>
              <button className="view-tab" type="button">EXPLODED</button>
              <button className="view-tab" type="button">SECTION</button>
            </div>
            <div className="model-controls">
              <button type="button" aria-label="Zoom out">−</button>
              <span>84%</span>
              <button type="button" aria-label="Zoom in">＋</button>
              <button type="button" aria-label="Fit model">⌗</button>
            </div>
          </div>

          <div className="model-stage">
            <div className="axis-label axis-top">+Z / FLIGHT</div>
            <div className="dimension dimension-top"><span>3,780 mm OVERALL</span></div>
            <div className="rocket-wrap">
              <div className="rocket-model" aria-label="BANSHEE Mk II vehicle model">
                <button className={`rocket-part nose ${selected.id === "nose" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("nose")} aria-label="Select nose assembly" />
                <button className={`rocket-part payload ${selected.id === "payload" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("payload")} aria-label="Select payload bay"><span>PAY-210</span></button>
                <button className={`rocket-part avionics ${selected.id === "avionics" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("avionics")} aria-label="Select avionics bay"><span>AVN-320</span></button>
                <button className={`rocket-part airframe ${selected.id === "airframe" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("airframe")} aria-label="Select main airframe"><span>STR-410</span></button>
                <button className={`rocket-part motor ${selected.id === "motor" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("motor")} aria-label="Select motor section"><span>MTR-500</span></button>
                <button className={`rocket-fin fin-left ${selected.id === "fins" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("fins")} aria-label="Select fin set" />
                <button className={`rocket-fin fin-right ${selected.id === "fins" ? "rocket-selected" : ""}`} onClick={() => setSelectedId("fins")} aria-label="Select fin set" />
                <div className="rocket-nozzle" />
              </div>
              <div className="model-callout callout-one"><i /><span><small>SELECTED COMPONENT</small><strong>{selected.code}</strong><em>{selected.name}</em></span></div>
              <div className="model-callout callout-two"><i /><span><small>REFERENCE DATUM</small><strong>STA 0.000</strong><em>Nose tip</em></span></div>
            </div>
            <div className="model-footer">
              <span>MODEL SOURCE <strong>BANSHEE_MK2_R28.ORK</strong></span>
              <span>LAST SYNC <strong>28 JUL 2026 · 11:42</strong></span>
              <span className="model-valid"><b>✓</b> ORK VALID</span>
            </div>
          </div>
        </section>

        <aside className="inspector-panel panel">
          <div className="inspector-identity">
            <div className="inspector-code">{selected.code}</div>
            <StatusDot status={selected.status} />
            <h2>{selected.name}</h2>
            <p>{selected.type}</p>
          </div>
          <div className="inspector-tabs">
            <button type="button" className={activePanel === "properties" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("properties")}>PROPERTIES</button>
            <button type="button" className={activePanel === "documents" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("documents")}>DOCS <span>{selected.documents.length}</span></button>
            <button type="button" className={activePanel === "activity" ? "inspector-tab-active" : ""} onClick={() => setActivePanel("activity")}>ACTIVITY</button>
          </div>

          {activePanel === "properties" && (
            <div className="inspector-body">
              <div className="section-label"><span>OPENROCKET PARAMETERS</span><button type="button">⌃</button></div>
              <label className="field-label">Component name<input value={selected.name} onChange={(event) => updateSelected("name", event.target.value)} /></label>
              <div className="field-grid">
                <label className="field-label">Length<div className="unit-field"><input type="number" value={selected.length} onChange={(event) => updateSelected("length", Number(event.target.value))} /><span>mm</span></div></label>
                <label className="field-label">Diameter<div className="unit-field"><input type="number" value={selected.diameter} onChange={(event) => updateSelected("diameter", Number(event.target.value))} /><span>mm</span></div></label>
              </div>
              <div className="field-grid">
                <label className="field-label">As-built mass<div className="unit-field"><input type="number" step="0.01" value={selected.mass} onChange={(event) => updateSelected("mass", Number(event.target.value))} /><span>kg</span></div></label>
                <label className="field-label">Material<input value={selected.material} onChange={(event) => updateSelected("material", event.target.value)} /></label>
              </div>

              <div className="section-label section-spaced"><span>CONFIGURATION STATUS</span><button type="button">⌃</button></div>
              <div className="status-card">
                <div><span className="status-icon">!</span><p><strong>{selected.status === "verified" ? "Released component" : selected.status === "draft" ? "Draft changes" : "Review in progress"}</strong><small>{selected.status === "verified" ? "Evidence and properties verified" : "1 approval required before release"}</small></p></div>
                <button type="button" onClick={() => setActivePanel("activity")}>View activity →</button>
              </div>

              <div className="section-label section-spaced"><span>LINKED EVIDENCE</span><button type="button" onClick={() => setActivePanel("documents")}>View all</button></div>
              <div className="evidence-mini">
                {selected.documents.slice(0, 2).map((document) => (
                  <button type="button" key={document.name} onClick={() => setActivePanel("documents")}>
                    <span className="file-icon">{document.name.endsWith(".pdf") ? "PDF" : "DOC"}</span>
                    <span><strong>{document.name}</strong><small>{document.meta}</small></span>
                    <em>›</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activePanel === "documents" && (
            <div className="inspector-body">
              <div className="document-summary"><strong>{selected.documents.length}</strong><span>linked records<br /><small>2 verified · {Math.max(0, selected.documents.length - 2)} in review</small></span></div>
              <input ref={documentInput} className="visually-hidden" type="file" onChange={attachDocument} />
              <button className="upload-zone" type="button" onClick={() => documentInput.current?.click()}>
                <span>＋</span><strong>Link documentation</strong><small>Drawing, analysis, certificate or test record</small>
              </button>
              <div className="document-list">
                {selected.documents.map((document) => (
                  <button type="button" key={document.name}>
                    <span className="file-icon">{document.name.endsWith(".pdf") ? "PDF" : document.name.split(".").pop()?.toUpperCase()}</span>
                    <span><strong>{document.name}</strong><small>{document.meta}</small></span>
                    <StatusDot status={document.state === "current" ? "verified" : "review"} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {activePanel === "activity" && (
            <div className="inspector-body activity-list">
              {activity.map((item) => (
                <article key={item.id}>
                  <span className={`activity-avatar activity-${item.tone}`}>{item.initials}</span>
                  <div><p><strong>{item.person}</strong> {item.action}</p><h3>{item.target}</h3><small>{item.detail}</small><time>{item.time}</time></div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <div className="status-message"><span className="pulse-dot" />{notice}</div>
        <div className="statusbar-right">
          {user.preview && <span className="preview-pill">LOCAL PREVIEW</span>}
          <span>REV 28</span><span>FORMAT 1.12</span><span>SI UNITS</span>
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

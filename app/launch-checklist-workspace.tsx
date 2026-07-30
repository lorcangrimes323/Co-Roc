"use client";

import { useEffect, useMemo, useState } from "react";

type PartRef = { source: "ork" | "custom"; id: string; code: string; name: string };
type ChecklistStep = { id: string; type: "action" | "verification" | "hold" | "warning" | "arming"; title: string; instruction: string; responsibility: string; signoff: "none" | "initials" | "initials-time" | "dual"; critical: boolean; expectedResult: string; tools: string; part: PartRef | null };
type ChecklistSection = { id: string; title: string; description: string; steps: ChecklistStep[] };
type ChecklistDefinition = { sections: ChecklistSection[] };
type Checklist = { id: string; title: string; mission: string; launchSite: string; scheduledFor: string | null; status: "draft" | "released"; revision: number; baselineReleaseNumber: number | null; definition: ChecklistDefinition; createdByName: string; updatedByName: string; createdAt: string; updatedAt: string; releasedByName: string | null; releasedAt: string | null };
type CustomPart = { id: string; code: string; name: string; category: string; description: string; createdByName: string; createdAt: string };
type VehiclePart = { id: string; code: string; name: string; type: string };
type Release = { releaseNumber: number; title: string };

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const revisionLabel = (revision: number) => String.fromCharCode(64 + Math.max(1, Math.min(26, revision)));
const blankStep = (part: PartRef | null = null): ChecklistStep => ({ id: crypto.randomUUID(), type: "action", title: part ? `Install / verify ${part.name}` : "New procedure step", instruction: part ? `Confirm ${part.code} · ${part.name} is installed in accordance with the controlled configuration.` : "State one unambiguous action, followed by a measurable result.", responsibility: "Assembly lead", signoff: "initials", critical: false, expectedResult: "", tools: "", part });

function demoChecklist(parts: VehiclePart[]): Checklist {
  const part = (pattern: RegExp) => parts.find((item) => pattern.test(`${item.name} ${item.type}`));
  const ref = (item?: VehiclePart): PartRef | null => item ? { source: "ork", id: item.id, code: item.code, name: item.name } : null;
  const step = (title: string, instruction: string, type: ChecklistStep["type"], responsibility: string, signoff: ChecklistStep["signoff"], linked: PartRef | null, expectedResult = ""): ChecklistStep => ({ ...blankStep(linked), title, instruction, type, responsibility, signoff, critical: type === "hold" || type === "warning" || type === "arming", expectedResult, tools: "" });
  const now = new Date().toISOString();
  return { id: "demo-launch-checklist", title: "L4C launch readiness checklist", mission: "Banshee Mk II demonstration flight", launchSite: "Approved launch range", scheduledFor: null, status: "draft", revision: 1, baselineReleaseNumber: null, createdByName: "Demo user", updatedByName: "Demo user", createdAt: now, updatedAt: now, releasedByName: null, releasedAt: null, definition: { sections: [
    { id: "assembly", title: "Vehicle assembly", description: "Complete mechanical assembly from the controlled build configuration.", steps: [
      step("Inspect primary structure", "Inspect all airframe interfaces, bonded joints and fasteners. Record any damage or departure before proceeding.", "verification", "Assembly lead", "initials-time", ref(part(/body tube|airframe/i)), "No visible damage; interfaces clean and serviceable."),
      step("Install avionics section", "Install the avionics assembly, confirm coupler engagement and torque all retained interfaces to the approved build instruction.", "action", "Avionics lead", "initials", ref(part(/coupler|avionics/i))),
      step("Complete fin and aft-body inspection", "Verify fin roots, external surfaces and motor-retention interfaces are undamaged and unobstructed.", "verification", "Structures", "initials", ref(part(/fin/i)), "All surfaces secure; no cracks, delamination or interference."),
    ] },
    { id: "recovery", title: "Recovery systems", description: "Pack, connect and verify every recovery train before closure.", steps: [
      step("Inspect recovery hardware", "Inspect harnesses, attachment points, swivels and soft goods. Confirm routing cannot foul separation interfaces.", "verification", "Recovery lead", "initials", ref(part(/parachute|recovery/i))),
      step("Pack and retain recovery devices", "Pack recovery devices using the controlled packing method. Install protection and retention exactly as specified.", "action", "Recovery lead", "initials-time", ref(part(/parachute|recovery/i))),
      step("Recovery continuity hold point", "STOP. A second competent person shall independently verify attachment, packing orientation and deployment-channel continuity.", "hold", "Flight director", "dual", ref(part(/parachute|recovery/i)), "Primary and independent verifier agree the recovery system is flight-ready."),
    ] },
    { id: "avionics", title: "Avionics & power", description: "Load the flight configuration and establish known-safe electrical states.", steps: [
      step("Load approved flight configuration", "Confirm firmware, configuration checksum, deployment thresholds and sensor orientation against the mission data pack.", "verification", "Avionics lead", "initials-time", ref(part(/avionics|battery|mass component/i)), "Configuration matches the released mission baseline."),
      step("Install flight batteries", "Measure battery voltage under the approved load check, record result and connect with flight switches remaining SAFE.", "action", "Avionics lead", "initials", ref(part(/battery/i)), "Voltage within approved operating range."),
    ] },
    { id: "pad", title: "Pad integration", description: "Integrate the vehicle with launch infrastructure while maintaining a safe state.", steps: [
      step("Inspect launch rail and ground equipment", "Confirm rail alignment, restraint, exclusion zone, launcher earth and ground-system power are serviceable.", "verification", "Pad lead", "initials-time", { source: "custom", id: "demo-rail", code: "GSE-RAIL", name: "Launch rail assembly" }),
      step("Install vehicle on rail", "Transfer the vehicle using the approved handling points. Engage every rail guide and verify free travel before restraint.", "action", "Pad crew", "initials", ref(part(/rail button/i))),
    ] },
    { id: "arming", title: "Arming procedure", description: "Safety-critical sequence. Preserve the specified order and hold points.", steps: [
      step("Establish sterile pad", "STOP. Confirm all non-essential personnel are outside the exclusion zone and the flight director controls the net.", "hold", "Flight director", "dual", null, "Pad declared sterile; communications check complete."),
      step("Arm recovery electronics", "Announce ARMING RECOVERY. Remove recovery inhibit devices in the controlled order, set flight switches to ARM and confirm the expected audible/telemetry state.", "arming", "Avionics lead", "initials-time", ref(part(/avionics|battery/i)), "All channels report flight-ready with no fault indications."),
      step("Connect and arm ignition circuit", "Treat the motor as live. Verify launch inhibit remains active, connect the initiator circuit, retire to the safe position and enable the launch controller only on flight-director command.", "warning", "Launch control", "dual", { source: "custom", id: "demo-ignition", code: "GSE-IGN", name: "Ignition control system" }, "Continuity indication nominal; physical and software inhibits controlled."),
    ] },
    { id: "approval", title: "Launch approval", description: "Formal status poll and authority to enter the countdown.", steps: [
      step("Conduct GO / NO-GO poll", "Poll structures, recovery, avionics, pad, range and launch control. Record each station response and resolve every NO-GO before proceeding.", "hold", "Flight director", "dual", null, "All required stations GO; weather and range constraints satisfied."),
      step("Authorize countdown", "Flight director signs the checklist and authorizes transfer to the countdown procedure.", "arming", "Flight director", "initials-time", null, "Countdown authority explicitly granted."),
    ] },
  ] } };
}

async function payload<T>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  try { return JSON.parse(text) as T & { error?: string }; } catch { return { error: text || `Request failed (${response.status})` } as T & { error?: string }; }
}

export function LaunchChecklistWorkspace({ parts, releases, mode, headers, canEdit, canRelease, onNotice }: {
  parts: VehiclePart[]; releases: Release[]; mode: "live" | "demo"; headers: () => Record<string, string>; canEdit: boolean; canRelease: boolean; onNotice: (notice: string) => void;
}) {
  const [checklists, setChecklists] = useState<Checklist[]>(() => mode === "demo" ? [demoChecklist(parts)] : []);
  const [customParts, setCustomParts] = useState<CustomPart[]>(() => mode === "demo" ? [
    { id: "demo-rail", code: "GSE-RAIL", name: "Launch rail assembly", category: "Ground support equipment", description: "Rail, base and restraint system", createdByName: "Demo", createdAt: new Date().toISOString() },
    { id: "demo-ignition", code: "GSE-IGN", name: "Ignition control system", category: "Ground support equipment", description: "Inhibited launch controller and firing circuit", createdByName: "Demo", createdAt: new Date().toISOString() },
  ] : []);
  const [selectedId, setSelectedId] = useState(mode === "demo" ? "demo-launch-checklist" : "");
  const [draft, setDraft] = useState<Checklist | null>(() => mode === "demo" ? clone(demoChecklist(parts)) : null);
  const [activeSectionId, setActiveSectionId] = useState("assembly");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(mode === "live");
  const [saving, setSaving] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"ork" | "custom">("ork");
  const [search, setSearch] = useState("");
  const [runMode, setRunMode] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [customForm, setCustomForm] = useState({ code: "", name: "", category: "Ground support equipment", description: "" });

  const activeSection = draft?.definition.sections.find((section) => section.id === activeSectionId) ?? draft?.definition.sections[0] ?? null;
  const selectedStep = activeSection?.steps.find((step) => step.id === selectedStepId) ?? null;
  const allSteps = draft?.definition.sections.flatMap((section) => section.steps) ?? [];
  const criticalCount = allSteps.filter((step) => step.critical).length;
  const signoffCount = allSteps.filter((step) => step.signoff !== "none").length;
  const completion = allSteps.length ? Math.round(Object.values(checked).filter(Boolean).length / allSteps.length * 100) : 0;

  function selectChecklist(id: string, source = checklists) {
    const item = source.find((checklist) => checklist.id === id);
    if (!item) return;
    setSelectedId(id); setDraft(clone(item)); setDirty(false); setRunMode(false); setChecked({});
    setActiveSectionId(item.definition.sections[0]?.id ?? ""); setSelectedStepId(null);
  }

  async function refresh(preferredId?: string) {
    if (mode === "demo") return;
    setLoading(true);
    try {
      const response = await fetch("/api/checklists", { headers: headers(), cache: "no-store" });
      const data = await payload<{ checklists?: Checklist[]; customParts?: CustomPart[] }>(response);
      if (!response.ok) throw new Error(data.error || "Checklists could not be loaded");
      const list = data.checklists ?? [];
      setChecklists(list); setCustomParts(data.customParts ?? []);
      selectChecklist(preferredId || selectedId || list[0]?.id || "", list);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Checklists could not be loaded"); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (mode === "live") void refresh(); }, [mode]);

  function changeDraft(update: (value: Checklist) => void) {
    if (!draft || draft.status === "released" || !canEdit) return;
    const next = clone(draft); update(next); setDraft(next); setDirty(true);
  }

  function updateStep(stepId: string, patch: Partial<ChecklistStep>) {
    changeDraft((next) => { for (const section of next.definition.sections) { const step = section.steps.find((item) => item.id === stepId); if (step) Object.assign(step, patch); } });
  }

  function addStep(part: PartRef | null = null) {
    if (!activeSection) return;
    const nextStep = blankStep(part);
    changeDraft((next) => next.definition.sections.find((section) => section.id === activeSection.id)?.steps.push(nextStep));
    setSelectedStepId(nextStep.id); onNotice(part ? `${part.code} linked to a new checklist step` : "Procedure step added");
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    changeDraft((next) => { const section = next.definition.sections.find((item) => item.id === activeSectionId); if (!section) return; const index = section.steps.findIndex((item) => item.id === stepId); const target = index + direction; if (index < 0 || target < 0 || target >= section.steps.length) return; [section.steps[index], section.steps[target]] = [section.steps[target], section.steps[index]]; });
  }

  function addSection() {
    if (!draft || draft.status === "released" || !canEdit) return;
    const section: ChecklistSection = { id: crypto.randomUUID(), title: "New procedure phase", description: "Define the purpose and exit condition for this phase.", steps: [] };
    changeDraft((next) => next.definition.sections.push(section));
    setActiveSectionId(section.id);
    setSelectedStepId(null);
    onNotice("Procedure phase added");
  }

  function removeActiveSection() {
    if (!activeSection || !draft || draft.definition.sections.length <= 1) return;
    const nextId = draft.definition.sections.find((section) => section.id !== activeSection.id)?.id ?? "";
    changeDraft((next) => { next.definition.sections = next.definition.sections.filter((section) => section.id !== activeSection.id); });
    setActiveSectionId(nextId);
    setSelectedStepId(null);
    onNotice("Procedure phase removed");
  }

  function moveActiveSection(direction: -1 | 1) {
    if (!activeSection) return;
    changeDraft((next) => {
      const index = next.definition.sections.findIndex((section) => section.id === activeSection.id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.definition.sections.length) return;
      [next.definition.sections[index], next.definition.sections[target]] = [next.definition.sections[target], next.definition.sections[index]];
    });
    onNotice(direction < 0 ? "Procedure phase moved earlier" : "Procedure phase moved later");
  }

  async function action(body: Record<string, unknown>, success: string) {
    if (mode === "demo") { onNotice(`${success} · demo changes stay in this browser`); return null; }
    setSaving(true);
    try {
      const response = await fetch("/api/checklists", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify(body) });
      const data = await payload<{ checklists?: Checklist[]; customParts?: CustomPart[]; selectedId?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Checklist action failed");
      if (data.checklists) { setChecklists(data.checklists); setCustomParts(data.customParts ?? customParts); selectChecklist(data.selectedId || body.checklistId as string || selectedId, data.checklists); }
      onNotice(success); return data;
    } catch (error) { onNotice(error instanceof Error ? error.message : "Checklist action failed"); return null; }
    finally { setSaving(false); }
  }

  async function createChecklist() {
    if (!canEdit) return;
    if (mode === "demo") { const item = demoChecklist(parts); item.id = crypto.randomUUID(); item.title = "New launch checklist"; item.definition.sections.forEach((section) => section.steps = []); const list = [item, ...checklists]; setChecklists(list); selectChecklist(item.id, list); onNotice("New demo checklist created"); return; }
    await action({ action: "create", title: "New launch checklist" }, "Launch checklist created");
  }

  async function saveChecklist() {
    if (!draft) return;
    if (mode === "demo") { const list = checklists.map((item) => item.id === draft.id ? clone({ ...draft, updatedAt: new Date().toISOString() }) : item); setChecklists(list); setDirty(false); onNotice("Checklist saved in the demo session"); return; }
    await action({ action: "save", checklistId: draft.id, title: draft.title, mission: draft.mission, launchSite: draft.launchSite, scheduledFor: draft.scheduledFor, baselineReleaseNumber: draft.baselineReleaseNumber, definition: draft.definition, baseUpdatedAt: draft.updatedAt }, "Checklist saved to the team workspace");
  }

  async function addCustomPart() {
    if (!customForm.code.trim() || !customForm.name.trim()) { onNotice("Enter an equipment code and name"); return; }
    if (mode === "demo") { const part = { id: crypto.randomUUID(), ...customForm, code: customForm.code.toUpperCase(), createdByName: "Demo user", createdAt: new Date().toISOString() }; setCustomParts((items) => [...items, part]); setCustomForm({ code: "", name: "", category: "Ground support equipment", description: "" }); onNotice(`${part.code} added to the demo equipment library`); return; }
    const result = await action({ action: "custom-part", ...customForm }, `${customForm.code.toUpperCase()} added to the equipment library`);
    if (result) setCustomForm({ code: "", name: "", category: "Ground support equipment", description: "" });
  }

  const filteredParts = useMemo(() => {
    const needle = search.toLowerCase();
    const source = libraryTab === "ork" ? parts.map((part) => ({ ...part, source: "ork" as const, category: part.type, description: "OpenRocket configuration component" })) : customParts.map((part) => ({ ...part, source: "custom" as const }));
    return source.filter((part) => !needle || `${part.code} ${part.name} ${part.category}`.toLowerCase().includes(needle));
  }, [customParts, libraryTab, parts, search]);

  return <section className="workspace-module checklist-module">
    <aside className="checklist-index module-tree">
      <header><span className="eyebrow">LAUNCH OPERATIONS</span><h2>Checklists</h2><button className="tree-new-simulation" type="button" disabled={!canEdit} onClick={createChecklist}>+ New checklist</button></header>
      <div className="checklist-list">{checklists.map((item) => <button key={item.id} type="button" className={item.id === selectedId ? "active" : ""} onClick={() => selectChecklist(item.id)}><span className={`checklist-status status-${item.status}`}>{item.status === "released" ? "REL" : "DRAFT"}</span><div><strong>{item.title}</strong><small>REV {revisionLabel(item.revision)} · {item.definition.sections.reduce((sum, section) => sum + section.steps.length, 0)} steps</small></div></button>)}{!loading && !checklists.length && <div className="module-empty">Create the first controlled launch procedure for this project.</div>}</div>
      <footer>Released checklist revisions remain immutable. Printouts include revision, vehicle baseline and sign-off fields.</footer>
    </aside>

    <div className="checklist-content">
      {!draft ? <div className="module-empty large">{loading ? "Loading launch procedures…" : "Select or create a launch checklist."}</div> : <>
        <header className="checklist-titlebar module-titlebar"><div><span className="eyebrow">CONTROLLED LAUNCH PROCEDURE</span><h2>{draft.title}</h2><p>Revision {revisionLabel(draft.revision)} · {draft.status === "released" ? `Released by ${draft.releasedByName}` : dirty ? "Unsaved working changes" : `Last saved by ${draft.updatedByName}`}</p></div><div className="checklist-actions"><button className="button button-secondary" type="button" onClick={() => window.print()}>Print / Save PDF</button>{draft.status === "released" ? <button className="button button-primary" type="button" disabled={!canEdit || saving} onClick={() => action({ action: "new-revision", checklistId: draft.id }, "New editable checklist revision created")}>Create next revision</button> : <><button className="button button-secondary" type="button" onClick={() => setRunMode((value) => !value)}>{runMode ? "Return to builder" : "Execution preview"}</button><button className="button button-secondary" type="button" disabled={!dirty || !canEdit || saving} onClick={saveChecklist}>{saving ? "Saving…" : "Save draft"}</button>{canRelease && <button className="button button-primary" type="button" disabled={dirty || saving} title={dirty ? "Save the draft before release" : undefined} onClick={() => action({ action: "release", checklistId: draft.id }, `Revision ${revisionLabel(draft.revision)} released for launch use`)}>Release checklist</button>}</>}</div></header>

        <div className="checklist-summary"><div><span>PROCEDURE STEPS</span><strong>{allSteps.length}</strong><small>across {draft.definition.sections.length} phases</small></div><div><span>CRITICAL / HOLD</span><strong>{criticalCount}</strong><small>safety-controlled steps</small></div><div><span>SIGN-OFFS</span><strong>{signoffCount}</strong><small>attributable records</small></div><div><span>{runMode ? "EXECUTION" : "CONTROL STATE"}</span><strong>{runMode ? `${completion}%` : draft.status.toUpperCase()}</strong><small>{draft.baselineReleaseNumber ? `vehicle V${draft.baselineReleaseNumber}` : "working configuration"}</small></div></div>

        <section className="checklist-metadata"><label>Checklist title<input value={draft.title} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => next.title = event.target.value)} /></label><label>Mission / flight<input value={draft.mission} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => next.mission = event.target.value)} placeholder="Mission identifier or flight objective" /></label><label>Launch site<input value={draft.launchSite} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => next.launchSite = event.target.value)} placeholder="Range and pad" /></label><label>Scheduled date<input type="date" value={draft.scheduledFor?.slice(0, 10) ?? ""} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => next.scheduledFor = event.target.value || null)} /></label><label>Vehicle release<select value={draft.baselineReleaseNumber ?? ""} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => next.baselineReleaseNumber = event.target.value ? Number(event.target.value) : null)}><option value="">Working configuration</option>{releases.map((release) => <option key={release.releaseNumber} value={release.releaseNumber}>V{release.releaseNumber} · {release.title}</option>)}</select></label></section>

        <nav className="checklist-phase-tabs" aria-label="Checklist phases">{draft.definition.sections.map((section, index) => <button key={section.id} type="button" className={section.id === activeSection?.id ? "active" : ""} onClick={() => { setActiveSectionId(section.id); setSelectedStepId(null); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title}</strong><small>{section.steps.length}</small></button>)}{draft.status === "draft" && canEdit && <button className="add-phase" type="button" onClick={addSection}><span>＋</span><strong>Add phase</strong></button>}</nav>

        {activeSection && <section className="checklist-phase"><header><div><span className="eyebrow">PHASE {String(draft.definition.sections.indexOf(activeSection) + 1).padStart(2, "0")}</span><input className="phase-title-input" value={activeSection.title} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => { const section = next.definition.sections.find((item) => item.id === activeSection.id); if (section) section.title = event.target.value; })} /><textarea value={activeSection.description} disabled={draft.status === "released" || !canEdit} onChange={(event) => changeDraft((next) => { const section = next.definition.sections.find((item) => item.id === activeSection.id); if (section) section.description = event.target.value; })} /></div>{draft.status === "draft" && <div className="phase-actions"><button type="button" aria-label="Move phase earlier" title="Move phase earlier" disabled={!canEdit || draft.definition.sections.indexOf(activeSection) === 0} onClick={() => moveActiveSection(-1)}>← Earlier</button><button type="button" aria-label="Move phase later" title="Move phase later" disabled={!canEdit || draft.definition.sections.indexOf(activeSection) === draft.definition.sections.length - 1} onClick={() => moveActiveSection(1)}>Later →</button><button type="button" disabled={!canEdit || draft.definition.sections.length <= 1} onClick={removeActiveSection}>Remove phase</button><button type="button" disabled={!canEdit} onClick={() => addStep()}>+ Add step</button></div>}</header>
          <div className={`checklist-steps ${runMode ? "checklist-run-mode" : ""}`}>{activeSection.steps.map((step, index) => <article key={step.id} className={`checklist-step step-${step.type} ${step.id === selectedStepId ? "selected" : ""}`} onClick={() => !runMode && setSelectedStepId(step.id)}><button className="step-check" type="button" disabled={!runMode} aria-label={`Complete ${step.title}`} onClick={(event) => { event.stopPropagation(); setChecked((items) => ({ ...items, [step.id]: !items[step.id] })); }}>{checked[step.id] ? "✓" : ""}</button><span className="step-number">{String(index + 1).padStart(2, "0")}</span><div className="step-copy"><header><span>{step.type.toUpperCase()}</span>{step.critical && <b>CRITICAL</b>}<strong>{step.title}</strong></header><p>{step.instruction}</p>{step.expectedResult && <small><b>ACCEPT:</b> {step.expectedResult}</small>}<footer>{step.part && <span>{step.part.code} · {step.part.name}</span>}<span>{step.responsibility || "Unassigned"}</span><span>{step.signoff === "none" ? "No sign-off" : step.signoff.replace("-", " + ")}</span></footer></div>{!runMode && draft.status === "draft" && <div className="step-order"><button type="button" aria-label="Move step up" onClick={(event) => { event.stopPropagation(); moveStep(step.id, -1); }}>↑</button><button type="button" aria-label="Move step down" onClick={(event) => { event.stopPropagation(); moveStep(step.id, 1); }}>↓</button><button type="button" aria-label="Delete step" onClick={(event) => { event.stopPropagation(); changeDraft((next) => { const section = next.definition.sections.find((item) => item.id === activeSection.id); if (section) section.steps = section.steps.filter((item) => item.id !== step.id); }); }}>×</button></div>}</article>)}{!activeSection.steps.length && <div className="checklist-empty-phase"><strong>No procedure steps in this phase.</strong><span>Add a blank step or choose a vehicle / ground-support part from the library.</span></div>}</div>
        </section>}

        {selectedStep && !runMode && draft.status === "draft" && <aside className="step-editor" aria-label="Edit procedure step"><header><div><span className="eyebrow">STEP DEFINITION</span><h3>{selectedStep.title}</h3></div><button type="button" onClick={() => setSelectedStepId(null)}>×</button></header><div className="step-editor-grid"><label>Step type<select value={selectedStep.type} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { type: event.target.value as ChecklistStep["type"], critical: ["hold", "warning", "arming"].includes(event.target.value) })}><option value="action">Action</option><option value="verification">Verification</option><option value="hold">Hold point</option><option value="warning">Safety warning</option><option value="arming">Arming action</option></select></label><label>Responsible role<input value={selectedStep.responsibility} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { responsibility: event.target.value })} /></label><label className="span-2">Step title<input value={selectedStep.title} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { title: event.target.value })} /></label><label className="span-2">Instruction<textarea value={selectedStep.instruction} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { instruction: event.target.value })} /></label><label className="span-2">Expected result / acceptance criterion<textarea value={selectedStep.expectedResult} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { expectedResult: event.target.value })} /></label><label>Tools / consumables<input value={selectedStep.tools} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { tools: event.target.value })} /></label><label>Sign-off<select value={selectedStep.signoff} disabled={!canEdit} onChange={(event) => updateStep(selectedStep.id, { signoff: event.target.value as ChecklistStep["signoff"] })}><option value="none">None</option><option value="initials">Initials</option><option value="initials-time">Initials + time</option><option value="dual">Independent dual sign-off</option></select></label></div></aside>}
      </>}
    </div>

    <aside className="checklist-library"><header><span className="eyebrow">PART REFERENCE LIBRARY</span><h2>Hardware</h2><p>Link each instruction to configured vehicle hardware or reusable launch equipment.</p></header><div className="library-tabs"><button type="button" className={libraryTab === "ork" ? "active" : ""} onClick={() => setLibraryTab("ork")}>ORK parts <span>{parts.length}</span></button><button type="button" className={libraryTab === "custom" ? "active" : ""} onClick={() => setLibraryTab("custom")}>Other equipment <span>{customParts.length}</span></button></div><input className="library-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, part or category" /><div className="library-list">{filteredParts.map((part) => <button key={`${part.source}-${part.id}`} type="button" disabled={!draft || draft.status === "released" || !canEdit} onClick={() => addStep({ source: part.source, id: part.id, code: part.code, name: part.name })}><span>{part.source === "ork" ? "ORK" : "GSE"}</span><div><strong>{part.name}</strong><small>{part.code} · {part.category}</small>{part.description && <p>{part.description}</p>}</div><b>＋</b></button>)}</div>{libraryTab === "custom" && <section className="custom-part-form"><span className="eyebrow">ADD NON-ORK HARDWARE</span><div><input value={customForm.code} disabled={!canEdit} onChange={(event) => setCustomForm((value) => ({ ...value, code: event.target.value }))} placeholder="Code e.g. GSE-001" /><input value={customForm.name} disabled={!canEdit} onChange={(event) => setCustomForm((value) => ({ ...value, name: event.target.value }))} placeholder="Equipment name" /></div><select value={customForm.category} disabled={!canEdit} onChange={(event) => setCustomForm((value) => ({ ...value, category: event.target.value }))}><option>Ground support equipment</option><option>Tooling</option><option>Consumable</option><option>Range equipment</option><option>PPE / safety equipment</option></select><textarea value={customForm.description} disabled={!canEdit} onChange={(event) => setCustomForm((value) => ({ ...value, description: event.target.value }))} placeholder="Function, controlled identifier or handling note" /><button type="button" disabled={!canEdit} onClick={addCustomPart}>Add to project library</button></section>}</aside>

    {draft && <article className="checklist-print-sheet"><header><div><span>CO-ROC CONTROLLED LAUNCH CHECKLIST</span><h1>{draft.title}</h1><p>{draft.mission || "Mission not specified"}</p></div><dl><div><dt>REVISION</dt><dd>{revisionLabel(draft.revision)}</dd></div><div><dt>STATUS</dt><dd>{draft.status.toUpperCase()}</dd></div><div><dt>VEHICLE</dt><dd>{draft.baselineReleaseNumber ? `V${draft.baselineReleaseNumber}` : "WORKING"}</dd></div></dl></header><section className="print-metadata"><span><b>Launch site</b>{draft.launchSite || "________________________"}</span><span><b>Scheduled date</b>{draft.scheduledFor?.slice(0, 10) || "________________"}</span><span><b>Checklist ID</b>{draft.id}</span></section>{draft.definition.sections.map((section, sectionIndex) => <section className="print-phase" key={section.id}><header><span>{String(sectionIndex + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2><p>{section.description}</p></div></header>{section.steps.map((step, index) => <div className={`print-step print-step-${step.type}`} key={step.id}><span className="print-checkbox">□</span><span className="print-number">{sectionIndex + 1}.{index + 1}</span><div><header><b>{step.type.toUpperCase()}</b>{step.critical && <em>CRITICAL</em>}<strong>{step.title}</strong></header><p>{step.instruction}</p>{step.part && <small>REFERENCE: {step.part.code} · {step.part.name}</small>}{step.expectedResult && <small>ACCEPTANCE: {step.expectedResult}</small>}</div><aside><span>{step.responsibility || "ROLE"}</span>{step.signoff === "dual" ? <><i>Initials 1: ______</i><i>Initials 2: ______</i><i>Time: ______</i></> : step.signoff === "initials-time" ? <><i>Initials: ______</i><i>Time: ______</i></> : step.signoff === "initials" ? <i>Initials: ______</i> : <i>—</i>}</aside></div>)}</section>)}<footer><div><b>Flight director release</b><span>Name / initials: ________________________</span><span>Time: ______________</span></div><div><b>Deviations / redlines</b><span>________________________________________________________________________________</span><span>________________________________________________________________________________</span></div><small>Controlled when generated from Co-Roc. Verify revision and vehicle baseline before use.</small></footer></article>}
  </section>;
}

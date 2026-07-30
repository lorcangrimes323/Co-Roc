"use client";

import { FormEvent, Fragment, useMemo, useRef, useState } from "react";
import type { OrkModelComparison } from "../lib/ork-change-diff";

export function OrkChangeProposalModal({ fileName, baseVersion, comparison, submitting, submissionError, onCancel, onSubmit }: {
  fileName: string;
  baseVersion: number;
  comparison: OrkModelComparison;
  submitting: boolean;
  submissionError?: string;
  onCancel: () => void;
  onSubmit: (summary: string, rationales: Record<string, string>) => void;
}) {
  const [summary, setSummary] = useState("");
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [validationMessage, setValidationMessage] = useState("");
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const rationaleRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const substantiveComponents = useMemo(() => comparison.components.filter((component) => !component.positionOnly), [comparison.components]);
  const completedRationales = substantiveComponents.filter((component) => (rationales[component.componentId] ?? "").trim().length >= 5).length;
  const summaryComplete = summary.trim().length >= 8;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!summaryComplete) {
      setValidationMessage("Add a short change summary of at least 8 characters before submitting.");
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      summaryRef.current?.focus({ preventScroll: true });
      return;
    }
    const missing = substantiveComponents.find((component) => (rationales[component.componentId] ?? "").trim().length < 5);
    if (missing) {
      setValidationMessage(`Add an engineering rationale for ${missing.componentName} before submitting.`);
      const field = rationaleRefs.current.get(missing.componentId);
      const details = field?.closest("details");
      if (details) details.open = true;
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
      return;
    }
    setValidationMessage("");
    onSubmit(summary.trim(), rationales);
  }

  return <div className="modal-backdrop proposal-backdrop" role="presentation" onMouseDown={() => !submitting && onCancel()}>
    <section className="ork-proposal-modal" role="dialog" aria-modal="true" aria-labelledby="ork-proposal-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="proposal-modal-header">
        <div><span className="eyebrow">CONTROLLED ORK UPLOAD</span><h2 id="ork-proposal-title">Propose changes to the working file</h2><p><strong>{fileName}</strong> was compared with authoritative working copy W{baseVersion}.</p></div>
        <button type="button" aria-label="Close ORK change proposal" onClick={onCancel} disabled={submitting}>×</button>
      </header>
      <div className="proposal-safety-note"><strong>The live ORK has not changed.</strong><span>This upload becomes a review proposal. A lead must approve the complete file before it can replace W{baseVersion}.</span></div>
      <div className="proposal-comparison-summary">
        <div><strong>{comparison.changedComponents}</strong><span>changed records</span></div>
        <div><strong>{comparison.fieldChanges}</strong><span>field differences</span></div>
        <div><strong>{comparison.geometryChanges}</strong><span>geometry impacts</span></div>
        <div><strong>{comparison.addedComponents} / {comparison.removedComponents}</strong><span>added / removed</span></div>
      </div>
      {comparison.simulationChanges > 0 && <div className="proposal-simulation-note"><strong>{comparison.simulationChanges} simulation definition difference{comparison.simulationChanges === 1 ? "" : "s"} excluded from engineering rationale</strong><span>Simulation definitions and completed runs are analysis records. Existing results remain pinned to W{baseVersion}; uploading this ORK does not move or rewrite them.</span></div>}
      <form onSubmit={submit} noValidate>
        <label className="proposal-summary-field">CHANGE SUMMARY · REQUIRED<textarea ref={summaryRef} value={summary} aria-invalid={!summaryComplete} onChange={(event) => { setSummary(event.target.value); setValidationMessage(""); }} rows={3} maxLength={4000} placeholder="Describe the purpose, source and expected engineering effect of this OpenRocket update…" /><span className={summaryComplete ? "complete" : ""}>{summaryComplete ? "Summary complete" : "Minimum 8 characters"}</span></label>
        <div className="proposal-components" aria-label="Detected ORK changes">
          {comparison.components.map((component, index) => <Fragment key={component.componentId}>
            {component.positionOnly && (index === 0 || !comparison.components[index - 1].positionOnly) && <div className="proposal-position-group"><strong>DEPENDENT POSITION SHIFTS</strong><span>Listed after the intentional changes. These records moved axially or radially because upstream geometry changed; they do not need separate rationales.</span></div>}
            <details className={`proposal-component${component.positionOnly ? " proposal-component-position-only" : ""}`} open={!component.positionOnly && index === 0}>
              <summary>
                <span className="proposal-component-index">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{component.componentName}</strong><small>{component.componentCode} · {component.componentKind}</small></span>
                <em className={`proposal-change-type change-${component.changeType}`}>{component.changeType}</em>
                {component.positionOnly ? <b className="position-shift-badge">POSITION SHIFT</b> : component.geometryChanged && <b>GEOMETRY</b>}
                <i>{component.changes.length} change{component.changes.length === 1 ? "" : "s"}</i>
              </summary>
              <div className="proposal-component-body">
                <div className="proposal-field-table">
                  <div className="proposal-field-head"><span>Parameter</span><span>Working W{baseVersion}</span><span>Proposed</span></div>
                  {component.changes.map((change) => <div key={change.field} className={`proposal-field-row category-${change.category}`}>
                    <span><strong>{change.label}</strong><small>{change.category}</small></span>
                    <code>{change.previousValue}</code><code>{change.nextValue}</code>
                  </div>)}
                </div>
                {component.positionOnly
                  ? <div className="proposal-position-rationale"><strong>No separate rationale required.</strong><span>This position follows from an upstream geometry change and remains visible for traceability.</span></div>
                  : <label>ENGINEERING RATIONALE · REQUIRED<textarea ref={(field) => { if (field) rationaleRefs.current.set(component.componentId, field); else rationaleRefs.current.delete(component.componentId); }} value={rationales[component.componentId] ?? ""} onChange={(event) => { setRationales((current) => ({ ...current, [component.componentId]: event.target.value })); setValidationMessage(""); }} rows={3} maxLength={2000} placeholder={`Why is the ${component.componentName} change required, and what evidence or requirement supports it?`} /></label>}
              </div>
            </details>
          </Fragment>)}
        </div>
        {(validationMessage || submissionError) && <div className="proposal-submit-error" role="alert"><strong>Proposal not submitted</strong><span>{validationMessage || submissionError}</span></div>}
        <footer className="proposal-modal-footer">
          <div><strong>{summaryComplete ? "Summary complete" : "Change summary required"}</strong><span>{completedRationales} / {substantiveComponents.length} required engineering rationales complete</span></div>
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Uploading proposal…" : "Submit for lead review"}</button>
        </footer>
      </form>
    </section>
  </div>;
}

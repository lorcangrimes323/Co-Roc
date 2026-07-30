"use client";

import { FormEvent, useMemo, useState } from "react";
import type { OrkModelComparison } from "../lib/ork-change-diff";

export function OrkChangeProposalModal({ fileName, baseVersion, comparison, submitting, onCancel, onSubmit }: {
  fileName: string;
  baseVersion: number;
  comparison: OrkModelComparison;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (summary: string, rationales: Record<string, string>) => void;
}) {
  const [summary, setSummary] = useState("");
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const complete = useMemo(() => summary.trim().length >= 8 && comparison.components.every((component) => (rationales[component.componentId] ?? "").trim().length >= 5), [comparison.components, rationales, summary]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (complete && !submitting) onSubmit(summary.trim(), rationales);
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
      <form onSubmit={submit}>
        <label className="proposal-summary-field">CHANGE SUMMARY<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} maxLength={4000} placeholder="Describe the purpose, source and expected engineering effect of this OpenRocket update…" required /></label>
        <div className="proposal-components" aria-label="Detected ORK changes">
          {comparison.components.map((component, index) => <details key={component.componentId} className="proposal-component" open={index === 0}>
            <summary>
              <span className="proposal-component-index">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{component.componentName}</strong><small>{component.componentCode} · {component.componentKind}</small></span>
              <em className={`proposal-change-type change-${component.changeType}`}>{component.changeType}</em>
              {component.geometryChanged && <b>GEOMETRY</b>}
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
              <label>ENGINEERING RATIONALE · REQUIRED<textarea value={rationales[component.componentId] ?? ""} onChange={(event) => setRationales((current) => ({ ...current, [component.componentId]: event.target.value }))} rows={3} maxLength={2000} placeholder={`Why is the ${component.componentName} change required, and what evidence or requirement supports it?`} required /></label>
            </div>
          </details>)}
        </div>
        <footer className="proposal-modal-footer">
          <div><strong>{comparison.components.filter((component) => (rationales[component.componentId] ?? "").trim().length >= 5).length} / {comparison.components.length}</strong><span>component rationales complete</span></div>
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={!complete || submitting}>{submitting ? "Uploading proposal…" : "Submit for lead review"}</button>
        </footer>
      </form>
    </section>
  </div>;
}

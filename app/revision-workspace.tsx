"use client";

import { useState } from "react";

export type WorkingChange = { id: number; version: number; componentId: string; componentCode: string; field: string; previousValue: string; nextValue: string; authorName: string; authorEmail: string; createdAt: string };
export type ControlledRelease = { id: number; releaseNumber: number; workingVersion: number; title: string; notes: string; sha256: string; createdByName: string; createdByEmail: string; createdAt: string };
export type ReleaseRequest = { id: string; workingVersion: number; title: string; notes: string; status: "pending" | "approved" | "rejected"; requestedByName: string; requestedByEmail: string; requestedAt: string; reviewedByName: string | null; reviewedAt: string | null; releaseNumber: number | null };
export type OrkChangeProposalItem = { id: number; componentId: string; componentCode: string; componentName: string; componentKind: string; changeType: "added" | "removed" | "modified"; geometryChanged: boolean; changes: Array<{ field: string; label: string; previousValue: string; nextValue: string; category: string }>; rationale: string };
export type OrkChangeProposal = { id: string; baseVersion: number; sourceName: string; sha256: string; sizeBytes: number; summary: string; status: "pending" | "approved" | "rejected" | "conflict"; changedComponents: number; geometryChanges: number; submittedByName: string; submittedByEmail: string; submittedAt: string; reviewedByName: string | null; reviewedAt: string | null; reviewNotes: string | null; appliedVersion: number | null; items: OrkChangeProposalItem[] };

function displayDate(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function RevisionWorkspace({ changes, releases, requests, proposals, canApprove, canReviewOrk, onOpenComponent, onReleaseAction, onProposalAction, onDownloadProposal }: {
  changes: WorkingChange[];
  releases: ControlledRelease[];
  requests: ReleaseRequest[];
  proposals: OrkChangeProposal[];
  canApprove: boolean;
  canReviewOrk: boolean;
  onOpenComponent: (componentId: string) => void;
  onReleaseAction: (action: "approve" | "reject" | "restore", value: string | number) => void;
  onProposalAction: (action: "approve" | "reject", proposalId: string, reviewNotes: string) => void;
  onDownloadProposal: (proposal: OrkChangeProposal) => void;
}) {
  const [proposalNotes, setProposalNotes] = useState<Record<string, string>>({});
  const workingUpdates = Array.from(new Set(changes.map((change) => change.version))).sort((a, b) => b - a);
  const pending = requests.filter((request) => request.status === "pending");
  const openProposals = proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "conflict");
  return <section className="workspace-module revision-module">
    <aside className="module-tree">
      <header><span className="eyebrow">CONFIGURATION CONTROL</span><h2>Version index</h2></header>
      <div className="revision-index">
        {openProposals.map((proposal) => <a key={proposal.id} href={`#proposal-${proposal.id}`}><strong>ORK Δ</strong><span>W{proposal.baseVersion} · {proposal.status}</span></a>)}
        {pending.map((request) => <a key={request.id} href={`#request-${request.id}`}><strong>REQUEST</strong><span>W{request.workingVersion} · pending</span></a>)}
        {releases.map((release) => <a key={release.id} href={`#release-${release.releaseNumber}`}><strong>V{release.releaseNumber}</strong><span>from W{release.workingVersion}</span></a>)}
        {workingUpdates.map((version) => <a key={`working-${version}`} href={`#working-${version}`}><strong>W{version}</strong><span>{changes.filter((change) => change.version === version).length} changes</span></a>)}
      </div>
      <footer>W numbers are automatic working updates. V numbers are controlled release baselines.</footer>
    </aside>
    <div className="revision-content">
      <header className="module-titlebar"><div><span className="eyebrow">TRACEABILITY</span><h2>Versions, ORK proposals &amp; working history</h2><p>External ORK uploads are reviewed like controlled pushes. Approved files become working updates; only formal release approval creates a V baseline.</p></div><span className="revision-total">{openProposals.length} ORK REVIEW · V{releases[0]?.releaseNumber ?? "—"} LATEST</span></header>
      <div className="revision-timeline">
        {proposals.map((proposal) => <section id={`proposal-${proposal.id}`} key={proposal.id} className={`ork-review-card proposal-${proposal.status}`}>
          <header><span>Δ</span><div><h3>{proposal.sourceName}</h3><p>{proposal.submittedByName} · {displayDate(proposal.submittedAt)}</p></div></header>
          <div className="ork-review-summary">
            <div className="ork-review-heading"><div><span className={`proposal-status status-${proposal.status}`}>{proposal.status}</span><h4>{proposal.summary}</h4></div><button type="button" className="button button-secondary" onClick={() => onDownloadProposal(proposal)}>Download proposed .ORK</button></div>
            <dl className="ork-review-metrics"><div><dt>Compared against</dt><dd>W{proposal.baseVersion}</dd></div><div><dt>Changed records</dt><dd>{proposal.changedComponents}</dd></div><div><dt>Geometry impacts</dt><dd>{proposal.geometryChanges}</dd></div><div><dt>Integrity</dt><dd>{proposal.sha256.slice(0, 12)}…</dd></div></dl>
            <div className="ork-review-items">
              {proposal.items.map((item) => <details key={item.id}>
                <summary><span><strong>{item.componentName}</strong><small>{item.componentCode} · {item.componentKind}</small></span><em>{item.changeType}</em>{item.geometryChanged && <b>GEOMETRY</b>}<i>{item.changes.length}</i></summary>
                <div><p><strong>Uploader rationale</strong>{item.rationale}</p><div className="ork-review-diff">{item.changes.map((change) => <div key={change.field}><span><strong>{change.label}</strong><small>{change.category}</small></span><code>{change.previousValue}</code><b>→</b><code>{change.nextValue}</code></div>)}</div></div>
              </details>)}
            </div>
            {proposal.status === "conflict" && <div className="proposal-conflict"><strong>Cannot apply automatically.</strong><span>The working ORK advanced after this upload. The author must download the current file, repeat the change and submit a new comparison.</span></div>}
            {proposal.status !== "pending" && proposal.reviewedByName && <div className="proposal-decision"><strong>{proposal.status === "approved" ? `Applied as W${proposal.appliedVersion}` : proposal.status === "rejected" ? "Rejected" : "Marked as conflict"}</strong><span>{proposal.reviewedByName} · {displayDate(proposal.reviewedAt ?? "")} · {proposal.reviewNotes || "No additional review note."}</span></div>}
            {proposal.status === "pending" && canReviewOrk && <footer className="ork-review-actions"><label>LEAD REVIEW NOTE<textarea value={proposalNotes[proposal.id] ?? ""} onChange={(event) => setProposalNotes((current) => ({ ...current, [proposal.id]: event.target.value }))} rows={2} placeholder="Decision basis, required follow-up or approval note…" /></label><div><button type="button" className="button button-secondary" disabled={(proposalNotes[proposal.id] ?? "").trim().length < 5} onClick={() => onProposalAction("reject", proposal.id, proposalNotes[proposal.id] ?? "")}>Reject proposal</button><button type="button" className="button button-primary" onClick={() => onProposalAction("approve", proposal.id, proposalNotes[proposal.id] ?? "")}>Approve into working ORK</button></div></footer>}
            {proposal.status === "pending" && !canReviewOrk && <div className="proposal-awaiting"><strong>Awaiting lead review</strong><span>The authoritative working ORK remains unchanged until approval.</span></div>}
          </div>
        </section>)}
        {pending.map((request) => <section id={`request-${request.id}`} key={request.id} className="release-request-card"><header><span>REQ</span><div><h3>{request.title}</h3><p>{request.requestedByName} · {displayDate(request.requestedAt)}</p></div></header><div className="release-summary"><p>{request.notes || "No additional release notes."}</p><dl><div><dt>Pinned working state</dt><dd>W{request.workingVersion}</dd></div><div><dt>Status</dt><dd>Awaiting lead approval</dd></div></dl>{canApprove && <footer><button type="button" className="button button-secondary" onClick={() => onReleaseAction("reject", request.id)}>Reject</button><button type="button" className="button button-primary" onClick={() => onReleaseAction("approve", request.id)}>Approve as V{(releases[0]?.releaseNumber ?? 0) + 1}</button></footer>}</div></section>)}
        {releases.map((release) => <section id={`release-${release.releaseNumber}`} key={release.id} className="controlled-release-card"><header><span>V{release.releaseNumber}</span><div><h3>{release.title}</h3><p>{release.createdByName} · {displayDate(release.createdAt)}</p></div></header><div className="release-summary"><p>{release.notes || "Controlled configuration baseline."}</p><dl><div><dt>Source working update</dt><dd>W{release.workingVersion}</dd></div><div><dt>Integrity</dt><dd>{release.sha256.slice(0, 12)}…</dd></div></dl>{canApprove && <footer><span>Restoring creates a new working update; V{release.releaseNumber} remains unchanged.</span><button type="button" className="button button-secondary" onClick={() => onReleaseAction("restore", release.releaseNumber)}>Restore to working copy</button></footer>}</div></section>)}
        {workingUpdates.map((version) => { const versionChanges = changes.filter((change) => change.version === version); const lead = versionChanges[0]; return <section id={`working-${version}`} key={version}><header><span>W{version}</span><div><h3>Working update {version}</h3><p>{lead.authorName} · {displayDate(lead.createdAt)}</p></div></header><div>{versionChanges.map((change) => <button key={change.id} type="button" onClick={() => onOpenComponent(change.componentId)}><span><strong>{change.componentCode}</strong><small>{change.field}</small></span><code>{change.previousValue || "—"}</code><b>→</b><code>{change.nextValue || "—"}</code></button>)}</div></section>; })}
        {!changes.length && !releases.length && !pending.length && !proposals.length && <div className="module-empty large">No ORK proposals, working changes or controlled versions have been recorded for this project.</div>}
      </div>
    </div>
  </section>;
}

"use client";

export type WorkingChange = { id: number; version: number; componentId: string; componentCode: string; field: string; previousValue: string; nextValue: string; authorName: string; authorEmail: string; createdAt: string };
export type ControlledRelease = { id: number; releaseNumber: number; workingVersion: number; title: string; notes: string; sha256: string; createdByName: string; createdByEmail: string; createdAt: string };
export type ReleaseRequest = { id: string; workingVersion: number; title: string; notes: string; status: "pending" | "approved" | "rejected"; requestedByName: string; requestedByEmail: string; requestedAt: string; reviewedByName: string | null; reviewedAt: string | null; releaseNumber: number | null };

function displayDate(value: string) {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function RevisionWorkspace({ changes, releases, requests, canApprove, onOpenComponent, onReleaseAction }: {
  changes: WorkingChange[];
  releases: ControlledRelease[];
  requests: ReleaseRequest[];
  canApprove: boolean;
  onOpenComponent: (componentId: string) => void;
  onReleaseAction: (action: "approve" | "reject" | "restore", value: string | number) => void;
}) {
  const workingUpdates = Array.from(new Set(changes.map((change) => change.version))).sort((a, b) => b - a);
  const pending = requests.filter((request) => request.status === "pending");
  return <section className="workspace-module revision-module">
    <aside className="module-tree">
      <header><span className="eyebrow">CONFIGURATION CONTROL</span><h2>Version index</h2></header>
      <div className="revision-index">
        {pending.map((request) => <a key={request.id} href={`#request-${request.id}`}><strong>REQUEST</strong><span>W{request.workingVersion} · pending</span></a>)}
        {releases.map((release) => <a key={release.id} href={`#release-${release.releaseNumber}`}><strong>V{release.releaseNumber}</strong><span>from W{release.workingVersion}</span></a>)}
        {workingUpdates.map((version) => <a key={`working-${version}`} href={`#working-${version}`}><strong>W{version}</strong><span>{changes.filter((change) => change.version === version).length} changes</span></a>)}
      </div>
      <footer>W numbers are automatic working updates. V numbers are controlled release baselines.</footer>
    </aside>
    <div className="revision-content">
      <header className="module-titlebar"><div><span className="eyebrow">TRACEABILITY</span><h2>Versions &amp; working history</h2><p>Live edits remain attributable without consuming release numbers. A lead approves immutable V baselines.</p></div><span className="revision-total">V{releases[0]?.releaseNumber ?? "—"} LATEST</span></header>
      <div className="revision-timeline">
        {pending.map((request) => <section id={`request-${request.id}`} key={request.id} className="release-request-card"><header><span>REQ</span><div><h3>{request.title}</h3><p>{request.requestedByName} · {displayDate(request.requestedAt)}</p></div></header><div className="release-summary"><p>{request.notes || "No additional release notes."}</p><dl><div><dt>Pinned working state</dt><dd>W{request.workingVersion}</dd></div><div><dt>Status</dt><dd>Awaiting lead approval</dd></div></dl>{canApprove && <footer><button type="button" className="button button-secondary" onClick={() => onReleaseAction("reject", request.id)}>Reject</button><button type="button" className="button button-primary" onClick={() => onReleaseAction("approve", request.id)}>Approve as V{(releases[0]?.releaseNumber ?? 0) + 1}</button></footer>}</div></section>)}
        {releases.map((release) => <section id={`release-${release.releaseNumber}`} key={release.id} className="controlled-release-card"><header><span>V{release.releaseNumber}</span><div><h3>{release.title}</h3><p>{release.createdByName} · {displayDate(release.createdAt)}</p></div></header><div className="release-summary"><p>{release.notes || "Controlled configuration baseline."}</p><dl><div><dt>Source working update</dt><dd>W{release.workingVersion}</dd></div><div><dt>Integrity</dt><dd>{release.sha256.slice(0, 12)}…</dd></div></dl>{canApprove && <footer><span>Restoring creates a new working update; V{release.releaseNumber} remains unchanged.</span><button type="button" className="button button-secondary" onClick={() => onReleaseAction("restore", release.releaseNumber)}>Restore to working copy</button></footer>}</div></section>)}
        {workingUpdates.map((version) => { const versionChanges = changes.filter((change) => change.version === version); const lead = versionChanges[0]; return <section id={`working-${version}`} key={version}><header><span>W{version}</span><div><h3>Working update {version}</h3><p>{lead.authorName} · {displayDate(lead.createdAt)}</p></div></header><div>{versionChanges.map((change) => <button key={change.id} type="button" onClick={() => onOpenComponent(change.componentId)}><span><strong>{change.componentCode}</strong><small>{change.field}</small></span><code>{change.previousValue || "—"}</code><b>→</b><code>{change.nextValue || "—"}</code></button>)}</div></section>; })}
        {!changes.length && !releases.length && !pending.length && <div className="module-empty large">No working changes or controlled versions have been recorded for this project.</div>}
      </div>
    </div>
  </section>;
}

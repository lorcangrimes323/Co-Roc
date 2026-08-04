"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MissionControl } from "./mission-control";
import type { ActiveWorkspace, TeamRole, WorkspaceIdentity, WorkspaceTeam } from "./workspace-types";

type SessionPayload = {
  authenticated: boolean;
  teams: WorkspaceTeam[];
  error?: string;
};

function previewHeaders(user: WorkspaceIdentity): Record<string, string> {
  return user.preview ? {
    "x-local-preview-name": user.name,
    "x-local-preview-email": user.email,
    "x-local-preview-role": user.previewRole ?? "lead",
  } : {};
}

export function WorkspaceApp({ user }: { user: WorkspaceIdentity }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");

  const loadSession = useCallback(async (preferredProjectId?: string) => {
    const response = await fetch("/api/session", { headers: previewHeaders(user), cache: "no-store" });
    const payload = await response.json() as SessionPayload;
    setSession(payload);
    const allProjects = payload.teams?.flatMap((team) => team.projects) ?? [];
    setActiveProjectId((current) => preferredProjectId && allProjects.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : allProjects.some((project) => project.id === current) ? current : allProjects[0]?.id ?? "");
  }, [user]);

  useEffect(() => { void loadSession(); }, [loadSession]);

  const workspace = useMemo<ActiveWorkspace | null>(() => {
    for (const team of session?.teams ?? []) {
      const project = team.projects.find((item) => item.id === activeProjectId);
      if (project) return { team, project };
    }
    return null;
  }, [activeProjectId, session]);

  async function submitAction(body: Record<string, unknown>, preferredProjectId?: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-id": activeProjectId, ...previewHeaders(user) },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; projectId?: string; code?: string };
      if (!response.ok) throw new Error(payload.error || "The team change could not be saved.");
      await loadSession(preferredProjectId ?? payload.projectId);
      setMessage("Team workspace updated.");
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The team change could not be saved.");
    } finally { setBusy(false); }
    return null;
  }

  async function createFirstWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitAction({ action: "create-team", teamName: form.get("teamName"), projectName: form.get("projectName") });
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.assign("/");
  }

  async function createTeamCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = await submitAction({
      action: "create-team-code",
      role: form.get("role"),
      maxUses: form.get("maxUses"),
      expiryDays: form.get("expiryDays"),
      projectIds: form.getAll("projectIds"),
    });
    if (payload?.code) setGeneratedCode(payload.code);
  }

  if (!session) return <main className="workspace-gate"><div className="gate-loader"><span />Connecting to the engineering workspace…</div></main>;
  if (!session.authenticated) return <main className="workspace-gate"><div className="gate-card"><h1>Session expired</h1><a className="primary-button" href="/">Sign in again</a></div></main>;
  if (!workspace) {
    return (
      <main className="workspace-gate">
        <form className="gate-card onboarding-card" onSubmit={createFirstWorkspace}>
          <span className="access-eyebrow">NEW ENGINEERING WORKSPACE</span>
          <h1>Create your team</h1>
          <p>You will be the team lead. Add the first vehicle project now; members and further projects can be added afterwards.</p>
          <label>Team name<input name="teamName" placeholder="QPL" required maxLength={80} /></label>
          <label>First project<input name="projectName" placeholder="Launch vehicle" required maxLength={100} /></label>
          {message && <p className="form-message">{message}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button>
        </form>
      </main>
    );
  }

  return (
    <>
      <MissionControl
        key={workspace.project.id}
        user={user}
        mode="live"
        workspace={workspace}
        teams={session.teams}
        onProjectChange={setActiveProjectId}
        onManageTeam={() => setTeamOpen(true)}
      />
      {teamOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTeamOpen(false)}>
          <section className="team-modal" aria-modal="true" role="dialog" aria-label="Team administration">
            <header><div><span className="access-eyebrow">{workspace.team.name}</span><h2>Team & projects</h2></div><button type="button" onClick={() => setTeamOpen(false)} aria-label="Close">×</button></header>
            <div className="team-role-summary"><strong>{workspace.team.role}</strong><span>{workspace.team.permissions.includes("manageTeam") ? "You can manage team access." : "Your access is managed by a team lead."}</span></div>
            {workspace.team.permissions.includes("manageTeam") && <section className="team-section invite-code-section">
              <div className="team-section-heading"><div><h3>Team join codes</h3><p>Create a controlled code for a role and selected rockets. The full code is shown once.</p></div></div>
              <form className="invite-code-form" onSubmit={createTeamCode}>
                <label>Role<select name="role" defaultValue="engineer"><option value="engineer">Engineer</option><option value="viewer">Viewer</option></select></label>
                <label>Member limit<input name="maxUses" type="number" min="1" max="100" defaultValue="5" /></label>
                <label>Expires after<input name="expiryDays" type="number" min="1" max="90" defaultValue="14" /><span>days</span></label>
                <fieldset><legend>Rocket access</legend><div className="project-check-grid">{workspace.team.projects.map((project) => <label key={project.id}><input name="projectIds" type="checkbox" value={project.id} defaultChecked={project.id === activeProjectId} /><span>{project.name}</span></label>)}</div></fieldset>
                <button className="primary-button" disabled={busy}>Generate team code</button>
              </form>
              {generatedCode && <div className="generated-code" role="status"><div><span>NEW TEAM CODE</span><strong>{generatedCode}</strong></div><button type="button" onClick={() => void navigator.clipboard.writeText(generatedCode)}>Copy code</button></div>}
              {!!workspace.team.inviteCodes?.length && <div className="invite-code-list">{workspace.team.inviteCodes.map((invite) => {
                const assigned = workspace.team.projects.filter((project) => invite.projectIds.includes(project.id)).map((project) => project.name).join(", ");
                const expired = new Date(invite.expiresAt).getTime() <= Date.now();
                return <div key={invite.id} className={!invite.active || expired || invite.useCount >= invite.maxUses ? "inactive" : ""}><strong>{invite.codeHint}</strong><span>{invite.role} · {invite.useCount}/{invite.maxUses} used · {assigned || "No rockets"}</span><small>Expires {new Date(invite.expiresAt).toLocaleDateString()}</small>{invite.active && !expired && invite.useCount < invite.maxUses && <button type="button" disabled={busy} onClick={() => void submitAction({ action: "revoke-team-code", codeId: invite.id })}>Revoke</button>}</div>;
              })}</div>}
            </section>}
            <section className="team-section">
              <h3>Members</h3>
              <div className="member-list">{workspace.team.members.map((member) => (
                <div className="member-entry" key={member.id}>
                  <div className="member-row">
                    <span className="member-avatar">{member.displayName.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{member.displayName}</strong><small>{member.email} · {member.status} · {member.role === "lead" || member.projectScope === "all" ? "all rockets" : `${member.projectIds.length} assigned`}</small></div>
                    {workspace.team.permissions.includes("manageTeam") ? <div className="member-controls"><select aria-label={`Role for ${member.displayName}`} value={member.role} disabled={busy} onChange={(event) => void submitAction({ action: "change-role", memberId: member.id, role: event.target.value })}><option value="lead">Lead</option><option value="engineer">Engineer</option><option value="viewer">Vendor / observer</option></select>{member.email.toLowerCase() !== user.email.toLowerCase() && <button className="member-remove" type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove ${member.displayName} from ${workspace.team.name}? Their project access will be revoked immediately.`)) void submitAction({ action: "remove-member", memberId: member.id }); }}>Remove</button>}</div> : <span className="role-badge">{member.role === "viewer" ? "vendor / observer" : member.role}</span>}
                  </div>
                  {workspace.team.permissions.includes("manageTeam") && member.role !== "lead" && <details className="member-access"><summary>Rocket access</summary><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitAction({ action: "update-member-projects", memberId: member.id, projectIds: form.getAll("projectIds") }); }}><div className="project-check-grid">{workspace.team.projects.map((project) => <label key={project.id}><input name="projectIds" type="checkbox" value={project.id} defaultChecked={member.projectScope === "all" || member.projectIds.includes(project.id)} /><span>{project.name}</span></label>)}</div><button disabled={busy}>Save access</button></form></details>}
                </div>
              ))}</div>
              {workspace.team.permissions.includes("manageTeam") && <form className="inline-team-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitAction({ action: "invite-member", displayName: form.get("displayName"), email: form.get("email"), role: form.get("role") }); event.currentTarget.reset(); }}><input name="displayName" placeholder="Member name" required /><input name="email" type="email" placeholder="name@team.org" required /><select name="role" defaultValue="engineer"><option value="engineer">Engineer</option><option value="viewer">Vendor / observer</option><option value="lead">Lead</option></select><button disabled={busy}>Add member</button></form>}
            </section>
            <section className="team-section">
              <h3>Projects</h3>
              <div className="project-admin-list">{workspace.team.projects.map((project) => <button key={project.id} type="button" className={project.id === activeProjectId ? "active" : ""} onClick={() => { setActiveProjectId(project.id); setTeamOpen(false); }}><span>{project.name}</span><small>{project.fileCount} stored versions · {(project.storageBytes / 1048576).toFixed(1)} MB</small></button>)}</div>
              {workspace.team.permissions.includes("manageProjects") && <form className="inline-team-form project-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitAction({ action: "create-project", name: form.get("name"), description: form.get("description") }); event.currentTarget.reset(); }}><input name="name" placeholder="New vehicle project" required /><input name="description" placeholder="Short description" /><button disabled={busy}>Create project</button></form>}
            </section>
            {!!workspace.team.events?.length && <section className="team-section"><h3>Access audit</h3><div className="team-event-list">{workspace.team.events.slice(0, 6).map((event) => <div key={event.id}><span>{event.summary}</span><small>{event.actorName} · {new Date(event.createdAt.replace(" ", "T") + (event.createdAt.includes("Z") ? "" : "Z")).toLocaleString()}</small></div>)}</div></section>}
            {message && <p className="form-message">{message}</p>}
            <footer className="team-modal-footer"><span>Signed in as {user.email}</span>{user.preview ? <a href="/">Exit local role</a> : <button type="button" onClick={() => void signOut()}>Sign out</button>}</footer>
          </section>
        </div>
      )}
    </>
  );
}

export const localIdentityByRole: Record<TeamRole, WorkspaceIdentity> = {
  lead: { name: "Lorcan Grimes", email: "local.lead@qpl.test", preview: true, previewRole: "lead" },
  engineer: { name: "QPL Engineer", email: "local.engineer@qpl.test", preview: true, previewRole: "engineer" },
  viewer: { name: "QPL Viewer", email: "local.viewer@qpl.test", preview: true, previewRole: "viewer" },
};

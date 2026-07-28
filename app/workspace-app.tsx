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
      const payload = await response.json() as { error?: string; projectId?: string };
      if (!response.ok) throw new Error(payload.error || "The team change could not be saved.");
      await loadSession(preferredProjectId ?? payload.projectId);
      setMessage("Team workspace updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The team change could not be saved.");
    } finally { setBusy(false); }
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
            <section className="team-section">
              <h3>Members</h3>
              <div className="member-list">{workspace.team.members.map((member) => (
                <div className="member-row" key={member.id}>
                  <span className="member-avatar">{member.displayName.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{member.displayName}</strong><small>{member.email} · {member.status}</small></div>
                  {workspace.team.permissions.includes("manageTeam") ? <select value={member.role} disabled={busy} onChange={(event) => void submitAction({ action: "change-role", memberId: member.id, role: event.target.value })}><option value="lead">Lead</option><option value="engineer">Engineer</option><option value="viewer">Viewer</option></select> : <span className="role-badge">{member.role}</span>}
                </div>
              ))}</div>
              {workspace.team.permissions.includes("manageTeam") && <form className="inline-team-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submitAction({ action: "invite-member", displayName: form.get("displayName"), email: form.get("email"), role: form.get("role") }); event.currentTarget.reset(); }}><input name="displayName" placeholder="Member name" required /><input name="email" type="email" placeholder="name@team.org" required /><select name="role" defaultValue="engineer"><option value="engineer">Engineer</option><option value="viewer">Viewer</option><option value="lead">Lead</option></select><button disabled={busy}>Add member</button></form>}
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

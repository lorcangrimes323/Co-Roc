"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function AccessPortal() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function chooseMode(nextMode: "signin" | "signup") {
    setMode(nextMode);
    setMessage("");
    window.requestAnimationFrame(() => document.getElementById("account-access")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (mode === "signup" && password !== String(form.get("confirmPassword") ?? "")) {
      setMessage("The passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mode, displayName: form.get("displayName"), email: form.get("email"), password, teamCode: form.get("teamCode") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Your account could not be opened.");
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your account could not be opened.");
      setBusy(false);
    }
  }

  return (
    <main className="access-page">
      <header className="account-header">
        <div className="account-wordmark"><span>CO</span><div><strong>Co-Roc</strong><small>Configuration control</small></div></div>
        <nav className="account-header-actions" aria-label="Account actions">
          <Link href="/demo?tour=1">Guided demo</Link>
          <button type="button" onClick={() => chooseMode("signin")}>Sign in</button>
        </nav>
      </header>

      <section className="account-main">
        <div className="account-context">
          <section className="account-hero">
            <span className="account-section-label">CO-ROC / ENGINEERING WORKSPACE</span>
            <h1>One working rocket.<br />Every change accounted for.</h1>
            <p>Keep the OpenRocket model, component evidence, simulation results and launch procedures in one controlled team workspace.</p>
            <div className="account-hero-actions">
              <Link className="account-primary-link" href="/demo?tour=1">Explore the guided demo <span aria-hidden="true">→</span></Link>
              <a href="#capabilities">See the workflow</a>
            </div>
            <ul className="account-standards" aria-label="Product principles">
              <li><span>01</span>OpenRocket compatible</li>
              <li><span>02</span>Role-controlled</li>
              <li><span>03</span>Release traceable</li>
            </ul>
          </section>
        </div>

        <section className="account-capabilities" id="capabilities">
            <header><span>WORKFLOW</span><h2>From geometry to launch day</h2></header>
            <ol>
              <li><span>01</span><div><strong>Work from the real ORK</strong><p>Upload, inspect and download the working OpenRocket file. Review the assembly in 2D or 3D and keep edits live.</p></div></li>
              <li><span>02</span><div><strong>Review changes before they land</strong><p>Compare a re-upload against the working copy, isolate intentional geometry changes and send them to a lead with engineering rationale.</p></div></li>
              <li><span>03</span><div><strong>Run traceable simulations</strong><p>Create OpenRocket cases, retain results against the configuration that produced them, and surface stability and performance data.</p></div></li>
              <li><span>04</span><div><strong>Keep the record with the part</strong><p>Attach drawings, test evidence, documents, photos and videos to components. Discuss decisions and tag the teammate who needs to act.</p></div></li>
              <li><span>05</span><div><strong>Control teams and releases</strong><p>Invite by team code, assign project access and separate working changes from approved release baselines that can always be recovered.</p></div></li>
              <li><span>06</span><div><strong>Prepare the launch</strong><p>Build phased assembly, arming and launch checklists with part references, hold points, approvals, sign-offs and a printable field copy.</p></div></li>
            </ol>
        </section>

        <div className="account-panel" id="account-access">
          <form className="account-form" onSubmit={submit}>
            <div className="account-tabs"><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => chooseMode("signup")}>Create account</button><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => chooseMode("signin")}>Sign in</button></div>
            <span className="account-form-kicker">{mode === "signup" ? "NEW WORKSPACE OR TEAM MEMBER" : "RETURNING USER"}</span>
            <h2>{mode === "signup" ? "Start using Co-Roc" : "Sign in to Co-Roc"}</h2>
            <p>{mode === "signup" ? "Create a workspace as a team lead, or enter a team code to join an existing project." : "Open your team workspace and continue from the latest working configuration."}</p>
            {mode === "signup" && <label>Full name<input name="displayName" autoComplete="name" minLength={2} maxLength={100} required placeholder="Your name" /></label>}
            {mode === "signup" && <label>Team code <span className="optional-label">OPTIONAL</span><input name="teamCode" autoComplete="off" maxLength={40} placeholder="RC-7K3M-9P2Q" /></label>}
            <label>Email address<input name="email" type="email" autoComplete="email" maxLength={180} required placeholder="name@team.org" /></label>
            <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={10} maxLength={200} required placeholder="At least 10 characters" /></label>
            {mode === "signup" && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>}
            {message && <div className="account-message" role="alert">{message}</div>}
            <button className="account-submit" disabled={busy}>{busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in")}</button>
            <small>Every action is attributed to an account. Team leads control roles, project access, approvals and releases.</small>
          </form>
        </div>
      </section>

      <footer className="account-page-footer"><span>Co-Roc · OpenRocket-compatible configuration control</span><span>Geometry · evidence · approvals · launch procedures</span></footer>
    </main>
  );
}

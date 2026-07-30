"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CoRocLogo } from "./co-roc-logo";
import { useThemePreference } from "./theme-preference";

export function AccessPortal() {
  const { resolved: resolvedTheme, setMode: setThemeMode } = useThemePreference();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
        <nav className="account-header-actions" aria-label="Account actions">
          <div className="account-theme-toggle" role="group" aria-label="Colour mode">
            <button type="button" aria-pressed={resolvedTheme === "light"} onClick={() => setThemeMode("light")}>Light</button>
            <button type="button" aria-pressed={resolvedTheme === "dark"} onClick={() => setThemeMode("dark")}>Dark</button>
          </div>
          <Link href="/demo?tour=1">Guided demo</Link>
          <button type="button" onClick={() => chooseMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Create account" : "Sign in"}</button>
        </nav>
      </header>

      <section className="account-main">
        <div className="account-context">
          <section className="account-hero">
            <CoRocLogo className="account-hero-logo" />
            <span className="account-section-label">CO-ROC / CONFIGURATION CONTROL</span>
            <h1>The working OpenRocket file, with its engineering record attached.</h1>
            <p>One controlled workspace for geometry, evidence, simulation, approvals and launch readiness. Every decision stays attributable to the vehicle configuration it affected.</p>
            <div className="account-hero-actions">
              <Link className="account-primary-link" href="/demo?tour=1">Open guided demo <span aria-hidden="true">→</span></Link>
              <a href="#controlled-workflow">Review the controls</a>
            </div>
            <section className="account-control-list" id="controlled-workflow" aria-label="Co-Roc engineering controls">
              <header><span>CONTROLLED WORKFLOW</span><span>WORKING → REVIEW → RELEASE</span></header>
              <div>
                <article><b>01</b><span><strong>Authoritative ORK</strong><small>Upload, inspect and download the current vehicle file.</small></span></article>
                <article><b>02</b><span><strong>Review changes before they land</strong><small>Compare geometry and route intentional changes to a lead.</small></span></article>
                <article><b>03</b><span><strong>Part records</strong><small>Keep drawings, tests, media, comments and tags with the component.</small></span></article>
                <article><b>04</b><span><strong>Run traceable simulations</strong><small>Retain stability and performance results against their working revision.</small></span></article>
                <article><b>05</b><span><strong>Control teams and releases</strong><small>Assign access, approve work and recover release baselines.</small></span></article>
                <article><b>06</b><span><strong>Prepare the launch</strong><small>Build approved assembly, arming and launch checklists.</small></span></article>
              </div>
            </section>
          </section>
        </div>

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

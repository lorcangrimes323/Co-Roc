"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { CoRocLogo } from "./co-roc-logo";
import { useThemePreference } from "./theme-preference";

export function AccessPortal() {
  const { resolved: resolvedTheme, setMode: setThemeMode } = useThemePreference();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    document.body.classList.add("landing-page-active");
    return () => document.body.classList.remove("landing-page-active");
  }, []);

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
        <div className="account-header-brand" aria-label="Co-Roc configuration control">
          <span>SYSTEM 01 / CONFIGURATION CONTROL</span>
          <span>OPENROCKET TEAM WORKSPACE</span>
        </div>
        <nav className="account-header-actions" aria-label="Account actions">
          <div className="account-theme-toggle" role="group" aria-label="Colour mode">
            <button type="button" aria-pressed={resolvedTheme === "light"} onClick={() => setThemeMode("light")}>Light</button>
            <button type="button" aria-pressed={resolvedTheme === "dark"} onClick={() => setThemeMode("dark")}>Dark</button>
          </div>
          <Link className="account-tour-link" href="/demo?tour=1"><span>Start guided demo</span><b aria-hidden="true">→</b></Link>
          <button type="button" onClick={() => chooseMode(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? "Create account" : "Sign in"}</button>
        </nav>
      </header>

      <Link className="account-mobile-demo" href="/demo?tour=1">
        <span>GUIDED PRODUCT TOUR</span>
        <strong>Start the guided demo</strong>
        <small>A three-minute walkthrough of the complete workflow</small>
        <i>START TOUR →</i>
      </Link>

      <section className="account-main">
          <section className="account-hero">
            <header className="account-hero-chrome">
              <span>WORKING FILE / CONTROLLED RECORD</span>
              <span>OPENROCKET COMPATIBLE</span>
              <span>REV 01 / CO—ROC</span>
            </header>
            <CoRocLogo className="account-hero-logo" />
            <div className="account-hero-datum" aria-hidden="true">
              <span>DATUM 000</span>
              <i />
              <span>LIVE VEHICLE RECORD</span>
            </div>
            <div className="account-hero-copy">
              <span className="account-section-label">CONFIGURATION CONTROL FOR LAUNCH VEHICLES</span>
              <h1><span>BUILD THE ROCKET.</span><span>KEEP THE RECORD.</span></h1>
              <p><strong>The working OpenRocket file, with its engineering record attached.</strong> Geometry, evidence, simulations, approvals and launch readiness stay tied to the configuration they affected.</p>
            </div>
            <div className="account-hero-console">
              <dl>
                <div><dt>MODEL</dt><dd>AUTHORITATIVE .ORK</dd></div>
                <div><dt>CHANGE STATE</dt><dd>WORKING → REVIEW → RELEASE</dd></div>
                <div><dt>EVIDENCE</dt><dd>PART-LEVEL / ATTRIBUTED</dd></div>
                <div><dt>LAUNCH</dt><dd>CHECKLIST / SIGN-OFF</dd></div>
              </dl>
              <div className="account-hero-actions">
                <Link className="account-primary-link" href="/demo?tour=1">
                  <span className="account-demo-copy"><small>RECOMMENDED START</small><strong>Start guided demo</strong></span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
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

      <footer className="account-page-footer">
        <span className="account-footer-product">Co-Roc · OpenRocket-compatible configuration control</span>
        <nav className="account-social-links" aria-label="Co-Roc on LinkedIn">
          <a href="https://www.linkedin.com/company/co-roc" target="_blank" rel="noreferrer" aria-label="Follow Co-Roc on LinkedIn">
            <span className="account-linkedin-mark" aria-hidden="true">in</span>
            <strong>Co-Roc LinkedIn</strong>
            <i aria-hidden="true">↗</i>
          </a>
          <a href="https://lnkd.in/p/eCFZj_yu" target="_blank" rel="noreferrer" aria-label="Read the Co-Roc launch post on LinkedIn">
            <span className="account-linkedin-mark" aria-hidden="true">in</span>
            <strong>Launch post</strong>
            <i aria-hidden="true">↗</i>
          </a>
        </nav>
        <span className="account-footer-scope">Geometry · evidence · approvals · launch procedures</span>
      </footer>
    </main>
  );
}

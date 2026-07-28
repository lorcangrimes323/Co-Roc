"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function AccessPortal() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
        <div className="account-wordmark"><span>RC</span><strong>Rocket Configuration</strong></div>
        <Link href="/demo">View demo</Link>
      </header>
      <section className="account-main">
        <aside className="account-context">
          <span className="account-section-label">ENGINEERING WORKSPACE</span>
          <h1>Configuration control for amateur launch vehicles.</h1>
          <p>OpenRocket geometry, part documentation, verification evidence and team decisions in one controlled record.</p>
          <dl>
            <div><dt>01</dt><dd><strong>Live configuration</strong><span>Review and edit the working ORK.</span></dd></div>
            <div><dt>02</dt><dd><strong>Part records</strong><span>Drawings, tests and evidence by component.</span></dd></div>
            <div><dt>03</dt><dd><strong>Change history</strong><span>Every saved version remains attributable.</span></dd></div>
          </dl>
        </aside>
        <div className="account-panel">
          <form className="account-form" onSubmit={submit}>
            <div className="account-tabs"><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(""); }}>Create account</button><button type="button" className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setMessage(""); }}>Sign in</button></div>
            <h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2>
            <p>{mode === "signup" ? "Create a new workspace, or enter a team code to join assigned rockets." : "Sign in to your engineering workspace."}</p>
            {mode === "signup" && <label>Full name<input name="displayName" autoComplete="name" minLength={2} maxLength={100} required placeholder="Lorcan Grimes" /></label>}
            {mode === "signup" && <label>Team code <span className="optional-label">OPTIONAL</span><input name="teamCode" autoComplete="off" maxLength={40} placeholder="RC-7K3M-9P2Q" /></label>}
            <label>Email address<input name="email" type="email" autoComplete="email" maxLength={180} required placeholder="name@team.org" /></label>
            <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={10} maxLength={200} required placeholder="At least 10 characters" /></label>
            {mode === "signup" && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label>}
            {message && <div className="account-message" role="alert">{message}</div>}
            <button className="account-submit" disabled={busy}>{busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in")}</button>
            <small>Your account identifies your work. Permissions are assigned separately by your team lead.</small>
          </form>
        </div>
      </section>
      <footer className="account-page-footer"><span>OpenRocket-compatible engineering records</span><span>SI units · Controlled revisions</span></footer>
    </main>
  );
}

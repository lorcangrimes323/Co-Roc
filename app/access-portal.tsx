import Link from "next/link";
import { chatGPTSignInPath } from "./chatgpt-auth";

export function AccessPortal({ local }: { local: boolean }) {
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-brand">ROCKET CONFIGURATION</div>
        <p className="access-eyebrow">CONTROLLED ENGINEERING WORKSPACE</p>
        <h1>One live configuration.<br />A traceable record for every part.</h1>
        <p className="access-summary">Review OpenRocket geometry, make controlled edits, attach drawings and evidence, issue test requirements, and keep every decision tied to the exact vehicle version.</p>
        <div className="access-actions">
          <a className="primary-button" href={chatGPTSignInPath("/")}>Sign in with ChatGPT</a>
          <Link className="secondary-button" href="/demo">Open interactive demo</Link>
        </div>
        <div className="access-assurance">
          <span><strong>Project isolated</strong> Team data stays within its workspace.</span>
          <span><strong>Role controlled</strong> Leads issue tests and manage access.</span>
          <span><strong>Versioned</strong> Every ORK save creates an immutable working version.</span>
        </div>
        {local && (
          <div className="local-role-panel">
            <span>LOCAL ROLE CHECK</span>
            <p>Open the live QPL workspace as a test identity.</p>
            <div>
              <Link href="/?local_role=lead">Team lead</Link>
              <Link href="/?local_role=engineer">Engineer</Link>
              <Link href="/?local_role=viewer">Viewer</Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

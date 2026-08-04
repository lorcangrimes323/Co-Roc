"use client";

import Link from "next/link";
import { CSSProperties, useEffect, useRef, useState } from "react";

export type GuidedDemoModule = "configuration" | "simulation" | "postflight" | "history" | "tests" | "documents" | "checklists";

type TourStep = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  detail: string;
  target?: string;
  module?: GuidedDemoModule;
};

type TourRect = { left: number; top: number; width: number; height: number };

const steps: TourStep[] = [
  {
    id: "welcome",
    eyebrow: "GUIDED DEMO",
    title: "Welcome to Co-Roc",
    description: "This is a controlled engineering workspace built around a live OpenRocket configuration—not a collection of disconnected files.",
    detail: "In the next few minutes, you will see how geometry, evidence, calculations, releases and launch operations stay linked to the same vehicle.",
  },
  {
    id: "project",
    eyebrow: "01 · PROJECT CONTEXT",
    title: "Know exactly what you are working on",
    description: "The workspace header identifies the team, active vehicle and current module. The state badge distinguishes demo data, live working updates and released baselines.",
    detail: "This context follows every engineering action, so evidence and decisions cannot quietly drift onto the wrong rocket or version.",
    target: "[data-tour='project-context']",
    module: "configuration",
  },
  {
    id: "summary",
    eyebrow: "02 · VEHICLE SUMMARY",
    title: "Critical configuration data stays visible",
    description: "Length, diameter, parsed component count, simulation coverage and the current release baseline are presented before you enter the detail.",
    detail: "These values update from the working ORK and provide a fast check that the file, configuration and release state are the ones you expect.",
    target: "[data-tour='vehicle-summary']",
    module: "configuration",
  },
  {
    id: "tree",
    eyebrow: "03 · COMPONENT STRUCTURE",
    title: "Every OpenRocket part becomes traceable",
    description: "The feature tree rebuilds the ORK hierarchy and gives every component a stable engineering record—from nose cone and airframe to internal hardware and rail buttons.",
    detail: "Select a part here or directly in the geometry. Review markers make incomplete engineering work visible without hiding the rest of the assembly.",
    target: "[data-tour='component-tree']",
    module: "configuration",
  },
  {
    id: "geometry",
    eyebrow: "04 · LIVE GEOMETRY",
    title: "Inspect the rocket, not a generic illustration",
    description: "The central viewport is rebuilt from the imported ORK. Zoom at the cursor, pan, roll around the longitudinal axis, or switch to the 3D assembly.",
    detail: "Selecting geometry links straight back to the component record. Stability, CG, CP, mass and the latest flight calculation remain attached to the same working configuration.",
    target: "[data-tour='rocket-viewport']",
    module: "configuration",
  },
  {
    id: "ork-push-pull",
    eyebrow: "05 · CONTROLLED ORK PUSH / PULL",
    title: "Download, edit and upload—without overwriting the team",
    description: "Download the current working ORK, make detailed changes in OpenRocket, then use Upload .ORK to submit it as a proposal. Co-Roc compares components, geometry, mass and materials against the exact W version you downloaded.",
    detail: "Every intentional part change requires an engineering rationale. Dependent axial or radial position shifts are grouped underneath and retain an automatic trace note instead of demanding repetitive justification. Simulation definitions are analysis records, so they are excluded from rationale requests and completed runs remain pinned to the W revision that was calculated. The proposed file remains separate until an authorised lead reviews and approves or rejects it. Approval creates a new working update; it does not create a V release. If the working copy advanced in the meantime, Co-Roc blocks the push as a conflict and requires a fresh pull, rebase and proposal.",
    target: "[data-tour='ork-sync-actions']",
    module: "configuration",
  },
  {
    id: "record",
    eyebrow: "06 · ENGINEERING RECORD",
    title: "Design data and evidence sit beside the part",
    description: "Each component has design parameters, controlled drawings, test requirements and a team decision thread with author and working-version attribution.",
    detail: "Earlier drawing revisions are retained. Test evidence, inspection media and comments stay with the relevant part instead of disappearing into chat or shared-drive folders.",
    target: "[data-tour='engineering-record']",
    module: "configuration",
  },
  {
    id: "simulation",
    eyebrow: "07 · OPENROCKET CORE",
    title: "Run and compare traceable flight cases",
    description: "Simulation cases use the working ORK and expose the OpenRocket launch inputs, warnings, flight profile and key outputs such as apogee, speed and acceleration.",
    detail: "A saved result records who ran it and the exact working W revision and ORK checksum used. Running a case never creates a new working revision. Current and prior results can be reopened from the traceable run history without moving them onto a newer configuration.",
    target: ".simulation-module",
    module: "simulation",
  },
  {
    id: "postflight",
    eyebrow: "08 · POST-FLIGHT DATA",
    title: "Put the measured flight back over the prediction",
    description: "Import the native binary .CFL log from a CATS Vega. Co-Roc decodes its flight estimates, GNSS, barometer, battery and event records automatically, then places the measured path on keyless 3D terrain beside the OpenRocket prediction from the same configuration.",
    detail: "GNSS tracks are retained as measured. Logs without continuous coordinates are clearly marked as reconstructed and use logger offsets or velocity plus the selected launch heading. Playback, apogee, range, velocity, acceleration and provenance stay attached to the working W revision used for comparison.",
    target: ".postflight-module",
    module: "postflight",
  },
  {
    id: "versions",
    eyebrow: "09 · CONFIGURATION CONTROL",
    title: "Live work is not the same as a release",
    description: "Every incremental ORK save remains attributable, while formal V1, V2 and V3 baselines are created only through the release workflow.",
    detail: "Engineers can request a version from their current work. A lead reviews and approves it, and any released baseline can later be restored without erasing what happened after it.",
    target: ".revision-module",
    module: "history",
  },
  {
    id: "tests",
    eyebrow: "10 · VERIFICATION",
    title: "See required and completed tests across the rocket",
    description: "The verification module gathers component-level test requirements into one feature tree, so open work can be reviewed by part and against the correct configuration.",
    detail: "Team leads issue measurable requirements; authorised engineers attach completion evidence. The record keeps the owner, outcome, time and working version together.",
    target: ".records-module",
    module: "tests",
  },
  {
    id: "documents",
    eyebrow: "11 · CONTROLLED DOCUMENTATION",
    title: "Find evidence through the vehicle structure",
    description: "Drawings, analyses, photographs and videos are arranged by component rather than presented as one undifferentiated file list.",
    detail: "That makes design reviews faster: select a vehicle feature, see its current controlled record, then inspect superseded revisions when the history matters.",
    target: ".records-module",
    module: "documents",
  },
  {
    id: "checklists",
    eyebrow: "12 · LAUNCH OPERATIONS",
    title: "Build and release a launch checklist",
    description: "Authorised engineers draft phased assembly, arming and launch procedures using ORK parts or operational hardware that does not belong in the aerodynamic model. Drafts remain editable until they are submitted for release.",
    detail: "Role permissions control the workflow: engineers can prepare and revise steps, while only an authorised lead can approve and release the checklist against a vehicle baseline. Released procedures preserve warnings, hold points, witness sign-off and part references for read-only use or field printing.",
    target: ".checklist-module",
    module: "checklists",
  },
  {
    id: "finish",
    eyebrow: "13 · YOUR WORKSPACE",
    title: "You are ready to explore",
    description: "Use Settings to choose light, dark or system appearance and to replay this tour whenever you need it.",
    detail: "Start by selecting a component, opening a simulation case, or reviewing the launch checklist. Nothing you change in this demo is written to a team project.",
    target: "[data-tour='workspace-settings-button'], .rail-mobile-more",
    module: "configuration",
  },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function visibleTarget(selector?: string) {
  if (!selector) return null;
  return Array.from(document.querySelectorAll(selector)).find((element) => {
    const bounds = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }) ?? null;
}

function expandedRect(element: Element): TourRect {
  const bounds = element.getBoundingClientRect();
  const padding = 9;
  if (window.innerWidth <= 1024) {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const exposedBottom = Math.max(150, viewportHeight * .42);
    const top = clamp(bounds.top - padding, 8, exposedBottom - 42);
    const right = clamp(bounds.right + padding, 16, window.innerWidth - 8);
    const bottom = clamp(bounds.bottom + padding, top + 36, exposedBottom);
    return {
      left: clamp(bounds.left - padding, 8, window.innerWidth - 24),
      top,
      width: Math.max(16, right - clamp(bounds.left - padding, 8, window.innerWidth - 24)),
      height: Math.max(36, bottom - top),
    };
  }
  return {
    left: clamp(bounds.left - padding, 8, window.innerWidth - 24),
    top: clamp(bounds.top - padding, 8, window.innerHeight - 24),
    width: Math.min(bounds.width + padding * 2, window.innerWidth - 16),
    height: Math.min(bounds.height + padding * 2, window.innerHeight - 16),
  };
}

function cardPosition(rect: TourRect | null): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(rect ? 390 : 510, viewportWidth - 32);
  const height = Math.min(rect ? 390 : 410, viewportHeight - 32);
  if (viewportWidth <= 1024) {
    const compactWidth = Math.min(620, viewportWidth - 16);
    return { left: (viewportWidth - compactWidth) / 2, top: "auto", bottom: "calc(8px + env(safe-area-inset-bottom))" };
  }
  if (!rect) return { left: (viewportWidth - width) / 2, top: (viewportHeight - height) / 2 };

  const gap = 22;
  let left = rect.left + rect.width + gap;
  let top = clamp(rect.top, 16, viewportHeight - height - 16);
  if (left + width > viewportWidth - 16) left = rect.left - width - gap;
  if (left < 16) {
    left = clamp(rect.left, 16, viewportWidth - width - 16);
    top = rect.top + rect.height + gap;
    if (top + height > viewportHeight - 16) top = rect.top - height - gap;
  }
  return { left: clamp(left, 16, viewportWidth - width - 16), top: clamp(top, 16, viewportHeight - height - 16) };
}

export function GuidedDemoTour({ currentModule, onModuleChange, onStepChange, onClose }: {
  currentModule: GuidedDemoModule;
  onModuleChange: (module: GuidedDemoModule) => void;
  onStepChange?: (stepId: string) => void;
  onClose: (completed: boolean) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<TourRect | null>(null);
  const [settled, setSettled] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const moduleChangeRef = useRef(onModuleChange);
  const stepChangeRef = useRef(onStepChange);
  const step = steps[stepIndex];
  const progress = ((stepIndex + 1) / steps.length) * 100;
  const position = typeof window === "undefined" ? {} : cardPosition(spotlight);

  useEffect(() => { moduleChangeRef.current = onModuleChange; }, [onModuleChange]);
  useEffect(() => { stepChangeRef.current = onStepChange; }, [onStepChange]);

  useEffect(() => { stepChangeRef.current?.(step.id); }, [step.id]);

  useEffect(() => {
    if (step.module && step.module !== currentModule) moduleChangeRef.current(step.module);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function locate() {
      const target = visibleTarget(step.target);
      if (!target) {
        setSpotlight(null);
        setSettled(true);
        return;
      }
      const mobile = window.innerWidth <= 1024;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: mobile ? "start" : "center", inline: "center" });
      window.setTimeout(() => {
        setSpotlight(expandedRect(target));
        setSettled(true);
      }, reducedMotion ? 0 : 360);
    }

    const timer = window.setTimeout(locate, step.module && step.module !== currentModule ? 480 : 120);
    function refresh() {
      const target = visibleTarget(step.target);
      if (target) setSpotlight(expandedRect(target));
    }
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [currentModule, step]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") onClose(false);
      if (event.key === "ArrowLeft" && stepIndex > 0) {
        setSettled(false);
        setStepIndex((value) => value - 1);
      }
      if ((event.key === "ArrowRight" || event.key === "Enter") && stepIndex < steps.length - 1) {
        setSettled(false);
        setStepIndex((value) => value + 1);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [onClose, stepIndex]);

  const finalStep = stepIndex === steps.length - 1;
  function moveTo(next: number) {
    setSettled(false);
    setStepIndex(next);
  }

  return <div className={`guided-tour ${settled ? "tour-settled" : "tour-moving"}`} role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
    <div className="guided-tour-scrim" />
    {spotlight && <div className="guided-tour-spotlight" style={{ left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height }} aria-hidden="true"><span /></div>}
    <article ref={cardRef} tabIndex={-1} className={`guided-tour-card ${spotlight ? "tour-card-targeted" : "tour-card-welcome"}`} style={position}>
      <header className="guided-tour-header">
        <div><span>{step.eyebrow}</span><small>{String(stepIndex + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</small></div>
        <button type="button" onClick={() => onClose(false)} aria-label="Skip guided demo">Skip</button>
      </header>
      <div className="guided-tour-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
      <div className="guided-tour-copy">
        <h2 id="guided-tour-title">{step.title}</h2>
        <p>{step.description}</p>
        <aside><span>WHY IT MATTERS</span>{step.detail}</aside>
      </div>
      <footer className="guided-tour-footer">
        <button className="tour-back" type="button" disabled={stepIndex === 0} onClick={() => moveTo(stepIndex - 1)}>Back</button>
        <div className="guided-tour-dots" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>{steps.map((item, index) => <i key={item.id} className={index === stepIndex ? "active" : index < stepIndex ? "complete" : ""} />)}</div>
        <button className="tour-next" type="button" onClick={() => finalStep ? onClose(true) : moveTo(stepIndex + 1)}>{finalStep ? "Finish & explore" : "Next"}<span>→</span></button>
      </footer>
      {finalStep && <Link className="guided-tour-account" href="/">Ready for live work? Create or sign in to an account</Link>}
    </article>
  </div>;
}

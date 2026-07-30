import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("keeps OpenRocket geometry and live edits traceable", async () => {
  const [missionControl, styles, openRocket, orkRoute, simulationRoute, simulationWorkspace, solver, schema] = await Promise.all([
    source("app/mission-control.tsx"),
    source("app/globals.css"),
    source("lib/openrocket.ts"),
    source("app/api/ork/route.ts"),
    source("app/api/simulations/route.ts"),
    source("app/simulation-workspace.tsx"),
    source("openrocket-service/src/main/java/app/rocketconfiguration/simulation/SimulationServer.java"),
    source("db/schema.ts"),
  ]);

  assert.match(missionControl, /WORKING COPY · BASELINE V/);
  assert.match(missionControl, /Create version/);
  assert.match(missionControl, /Request version/);
  assert.match(missionControl, /encodeOpenRocketAsync\(orkModel\)/);
  assert.match(missionControl, /baseVersion/);
  assert.match(missionControl, /Wall thickness/);
  assert.match(missionControl, /rollDegrees/);
  assert.match(missionControl, /onRoll=\{changeRoll\}/);
  assert.match(missionControl, /Longitudinal roll control/);

  const sectionView = await source("app/rocket-section-view.tsx");
  assert.match(sectionView, /event\.ctrlKey/);
  assert.match(sectionView, /CTRL \+ WHEEL TO ROLL/);
  assert.match(sectionView, /fin\.rotation \+ rollRadians/);

  assert.match(openRocket, /archiveEntries/);
  assert.match(openRocket, /export function encodeOpenRocket/);
  assert.match(openRocket, /wallThickness/);
  assert.match(openRocket, /instanceSeparation/);
  assert.match(openRocket, /outerdiameter/);
  assert.match(openRocket, /angleoffset/);
  assert.match(openRocket, /Motor mass/);
  assert.match(openRocket, /referenceStability/);
  assert.match(openRocket, /saveOpenRocketSimulationResult/);
  assert.match(openRocket, /calculatedComponentMass/);
  assert.match(openRocket, /motorMassSample/);
  assert.match(orkRoute, /status: 409/);
  assert.match(orkRoute, /sha256Hex/);
  assert.match(orkRoute, /application\/vnd\.co-roc\.ork/);
  assert.match(orkRoute, /simulationSetup/);
  assert.match(missionControl, /x-co-roc-file-name/);
  assert.match(missionControl, /responsePayload/);
  assert.match(missionControl, /runBlockedReason/);
  assert.match(missionControl, /OpenRocket vehicle analysis/);
  assert.match(missionControl, /analysis-vehicle/);
  assert.match(missionControl, /analysis-stability/);
  assert.match(missionControl, /analysis-flight/);
  assert.match(missionControl, /Mass without motors/);
  assert.match(missionControl, /configuration-pane-widths/);
  assert.match(missionControl, /pane-resizer-tree/);
  assert.match(missionControl, /pane-resizer-record/);
  assert.match(missionControl, /RELEASE BASELINE/);
  assert.doesNotMatch(missionControl, /WORKING VERSION<\/span>/);
  assert.match(missionControl, /CG:/);
  assert.match(missionControl, /CP:/);
  assert.match(missionControl, /CALCULATING/);
  assert.match(missionControl, /api\/simulations\?preview=1/);
  assert.match(styles, /--analysis-top-zone: 108px/);
  assert.match(styles, /--analysis-bottom-zone: 64px/);
  assert.match(styles, /inset: var\(--analysis-top-zone\) 0 var\(--analysis-bottom-zone\)/);
  assert.match(styles, /\.analysis-flight \{ top: 14px; left: 50%; max-width: 32%; transform: translateX\(-50%\)/);
  assert.match(simulationRoute, /isPreviewRequest/);
  assert.match(simulationRoute, /demoRequest \|\| previewRequest/);
  assert.match(simulationWorkspace, /referenceSample/);
  assert.match(simulationWorkspace, /motorMassSample/);
  assert.match(simulationWorkspace, /saveOpenRocketSimulationResult/);
  assert.match(simulationWorkspace, /launchRodDirectionDegrees: simulation\.launchRodDirection/);
  assert.match(simulationWorkspace, /payload\.failure\?\.detail/);
  assert.match(solver, /launchRodDirectionDegrees/);
  assert.match(openRocket, /coroc-angle-unit/);
  assert.match(openRocket, /legacyCoRocRadians/);
  assert.match(solver, /TYPE_MOTOR_MASS/);
  assert.match(solver, /launchMotorMass/);
  assert.match(solver, /awaitCore/);
  assert.match(solver, /initialising/);
  assert.match(schema, /orkChanges/);
  assert.match(schema, /orkSnapshots/);
  assert.match(schema, /orkReleaseRequests/);
  assert.match(schema, /orkReleases/);
});

test("enforces team roles and keeps projects isolated", async () => {
  const [access, accessStore, session, ork, records, releases, schema, workspace] = await Promise.all([
    source("app/api/access.ts"),
    source("db/access-store.ts"),
    source("app/api/session/route.ts"),
    source("app/api/ork/route.ts"),
    source("app/api/component-records/route.ts"),
    source("app/api/releases/route.ts"),
    source("db/schema.ts"),
    source("app/workspace-app.tsx"),
  ]);

  assert.match(accessStore, /lead: \["view", "editOrk", "uploadEvidence", "createTest"/);
  assert.match(accessStore, /engineer: \["view", "editOrk", "uploadEvidence", "completeTest"/);
  assert.match(accessStore, /viewer: \["view"\]/);
  assert.match(accessStore, /engineer: \[[^\]]+"requestRelease"/);
  assert.match(accessStore, /lead: \[[^\]]+"approveRelease"/);
  assert.match(access, /requireProjectAccess/);
  assert.match(access, /x-project-id/);
  assert.match(ork, /requireProjectAccess\(request, "editOrk"\)/);
  assert.match(records, /action === "create-test" \? "createTest"/);
  assert.match(records, /action === "complete-test" \? "completeTest"/);
  assert.match(releases, /action === "request" \? "requestRelease" : "approveRelease"/);
  assert.match(releases, /working update is already awaiting approval/);
  assert.match(releases, /release\.restored/);
  assert.match(releases, /object_key AS objectKey/);
  assert.match(session, /invite-member/);
  assert.match(session, /create-team-code/);
  assert.match(session, /update-member-projects/);
  assert.match(session, /invite_code_projects/);
  assert.match(session, /member_project_access/);
  assert.match(session, /A team must retain at least one active lead/);
  assert.match(schema, /teamMembers/);
  assert.match(schema, /projects/);
  assert.match(workspace, /Team & projects/);
  assert.match(workspace, /Generate team code/);
  assert.match(workspace, /Rocket access/);
});

test("uses site accounts, separates demo data and recovers local drafts", async () => {
  const [home, demo, missionControl, portal, authRoute, accountAuth] = await Promise.all([
    source("app/page.tsx"),
    source("app/demo/page.tsx"),
    source("app/mission-control.tsx"),
    source("app/access-portal.tsx"),
    source("app/api/auth/route.ts"),
    source("app/account-auth.ts"),
  ]);
  assert.match(home, /AccessPortal/);
  assert.match(portal, /Create account/);
  assert.match(portal, /Team code/);
  assert.match(portal, /\/api\/auth/);
  assert.doesNotMatch(portal, /QPL|LOCAL ROLE CHECK/);
  const styles = await source("app/globals.css");
  assert.match(styles, /\.access-page \{ height: 100vh; height: 100dvh;/);
  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /@media \(max-height: 760px\)/);
  assert.match(styles, /@media \(max-width: 420px\)/);
  assert.match(authRoute, /verifyPassword/);
  assert.match(authRoute, /Too many sign-in attempts/);
  assert.match(accountAuth, /PBKDF2/);
  assert.match(accountAuth, /PASSWORD_ITERATIONS = 100_000/);
  assert.match(authRoute, /password_iterations/);
  assert.match(accountAuth, /HttpOnly; SameSite=Lax/);
  assert.match(authRoute, /code_hash/);
  assert.match(authRoute, /joinedTeam/);
  assert.match(demo, /mode="demo"/);
  assert.match(missionControl, /rocket-draft:/);
  assert.match(missionControl, /Recovered/);
  assert.match(missionControl, /mode !== "live"/);
});

test("provides a complete touch-first mobile engineering workspace", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /\.rail \{[\s\S]*position: fixed;[\s\S]*inset: auto 0 0;/);
  assert.match(styles, /\.rail-button::after \{[\s\S]*position: static;/);
  assert.match(styles, /\.workspace-actions \{ width: 100%; display: grid; grid-template-columns: 1fr 1fr;/);
  assert.match(styles, /\.main-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.simulation-module \.module-tree-list \{[\s\S]*overflow-x: auto;/);
  assert.match(styles, /\.simulation-metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(styles, /\.simulation-detail-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.register-head \{ display: none; \}/);
  assert.match(styles, /\.revision-timeline > section \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.simulation-editor \{ width: 100%; height: 100vh; height: 100dvh;/);
  assert.match(styles, /\.statusbar \{[\s\S]*bottom: 64px;/);
});

test("provides a focused engineering record for every component", async () => {
  const [missionControl, recordRoute, recordStore, css, migration] = await Promise.all([
    source("app/mission-control.tsx"),
    source("app/api/component-records/route.ts"),
    source("db/component-record-store.ts"),
    source("app/globals.css"),
    source("drizzle/0001_outstanding_alex_wilder.sql"),
  ]);

  assert.match(missionControl, /ENGINEERING RECORD/);
  assert.match(missionControl, /DRAWINGS &amp; REVISION HISTORY/);
  assert.match(missionControl, /Acceptance requirement/);
  assert.match(missionControl, /Mark test complete/);
  assert.match(missionControl, /Photo/);
  assert.match(missionControl, /Video/);
  assert.match(missionControl, /type @ to tag a teammate/);
  assert.match(missionControl, /TRACE LOG/);

  assert.match(recordRoute, /component_artifacts/);
  assert.match(recordRoute, /component_tests/);
  assert.match(recordRoute, /component_comments/);
  assert.match(recordRoute, /component_record_events/);
  assert.match(recordRoute, /status = 'superseded'/);
  assert.match(recordRoute, /mentions_json/);
  assert.match(recordStore, /CREATE TABLE IF NOT EXISTS component_record_events/);
  assert.match(migration, /CREATE TABLE `component_artifacts`/);

  assert.match(css, /--ink-2:\s*#ffffff/);
  assert.match(css, /--user-accent:\s*#c92335/);
  assert.match(css, /\.inspector-tabs-four/);
  assert.match(css, /\.engineering-record-list/);
});

test("provides a persistent, accessible dark mode across account and engineering surfaces", async () => {
  const [layout, portal, preference, missionControl, sectionView, viewer, simulation, css] = await Promise.all([
    source("app/layout.tsx"),
    source("app/access-portal.tsx"),
    source("app/theme-preference.tsx"),
    source("app/mission-control.tsx"),
    source("app/rocket-section-view.tsx"),
    source("app/rocket-viewer.tsx"),
    source("app/simulation-workspace.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(layout, /themeInitScript/);
  assert.match(layout, /rocket-theme/);
  assert.match(layout, /prefers-color-scheme: dark/);
  assert.doesNotMatch(portal, /ThemeModeSelector/);
  assert.match(preference, /aria-pressed/);
  assert.match(preference, /useSyncExternalStore/);
  assert.match(preference, /media\.addEventListener\("change", listener\)/);
  assert.match(missionControl, /resolvedTheme/);
  assert.match(missionControl, /Workspace settings/);
  assert.match(missionControl, /ThemeModeSelector/);
  assert.match(missionControl, /--user-accent/);
  assert.match(sectionView, /darkTheme/);
  assert.match(viewer, /themeKey === "dark"/);
  assert.match(simulation, /\[samples, themeKey\]/);
  assert.match(css, /\[data-theme="dark"\] \{/);
  assert.match(css, /--panel-raised:\s*#222228/);
  assert.match(css, /--muted:\s*#b9b5b8/);
  assert.match(css, /\.theme-mode-selector/);
  assert.match(css, /input:-webkit-autofill/);
});

test("provides controlled launch checklists with part references and printable sign-offs", async () => {
  const [missionControl, checklist, route, access, css, migration] = await Promise.all([
    source("app/mission-control.tsx"),
    source("app/launch-checklist-workspace.tsx"),
    source("app/api/checklists/route.ts"),
    source("db/access-store.ts"),
    source("app/globals.css"),
    source("drizzle/0009_sleepy_madame_web.sql"),
  ]);

  assert.match(missionControl, /LaunchChecklistWorkspace/);
  assert.match(missionControl, /LAUNCH CHECKLISTS/);
  assert.match(checklist, /Arming procedure/);
  assert.match(checklist, /Independent dual sign-off/);
  assert.match(checklist, /Move phase earlier/);
  assert.match(checklist, /Move phase later/);
  assert.match(checklist, /ORK parts/);
  assert.match(checklist, /Other equipment/);
  assert.match(checklist, /Print \/ Save PDF/);
  assert.match(checklist, /window\.print\(\)/);
  assert.match(route, /at least one controlled arming action/);
  assert.match(route, /baseUpdatedAt/);
  assert.match(access, /editChecklist/);
  assert.match(access, /releaseChecklist/);
  assert.match(migration, /CREATE TABLE `launch_checklists`/);
  assert.match(migration, /CREATE TABLE `checklist_custom_parts`/);
  assert.match(css, /\.checklist-module \{ grid-template-columns:/);
  assert.match(css, /\.checklist-print-sheet \{ display: block !important;/);
  assert.match(css, /@media print/);
});

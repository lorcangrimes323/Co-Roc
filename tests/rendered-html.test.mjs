import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("keeps OpenRocket geometry and live edits traceable", async () => {
  const [missionControl, openRocket, orkRoute, simulationRoute, simulationWorkspace, solver, schema] = await Promise.all([
    source("app/mission-control.tsx"),
    source("lib/openrocket.ts"),
    source("app/api/ork/route.ts"),
    source("app/api/simulations/route.ts"),
    source("app/simulation-workspace.tsx"),
    source("openrocket-service/src/main/java/app/rocketconfiguration/simulation/SimulationServer.java"),
    source("db/schema.ts"),
  ]);

  assert.match(missionControl, /WORKING · V\$\{workspaceVersion/);
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
  assert.match(missionControl, /CG:/);
  assert.match(missionControl, /CP:/);
  assert.match(missionControl, /CALCULATING/);
  assert.match(missionControl, /api\/simulations\?preview=1/);
  assert.match(simulationRoute, /isPreviewRequest/);
  assert.match(simulationRoute, /demoRequest \|\| previewRequest/);
  assert.match(simulationWorkspace, /referenceSample/);
  assert.match(solver, /TYPE_MOTOR_MASS/);
  assert.match(solver, /launchMotorMass/);
  assert.match(solver, /awaitCore/);
  assert.match(solver, /initialising/);
  assert.match(schema, /orkChanges/);
  assert.match(schema, /orkSnapshots/);
});

test("enforces team roles and keeps projects isolated", async () => {
  const [access, accessStore, session, ork, records, schema, workspace] = await Promise.all([
    source("app/api/access.ts"),
    source("db/access-store.ts"),
    source("app/api/session/route.ts"),
    source("app/api/ork/route.ts"),
    source("app/api/component-records/route.ts"),
    source("db/schema.ts"),
    source("app/workspace-app.tsx"),
  ]);

  assert.match(accessStore, /lead: \["view", "editOrk", "uploadEvidence", "createTest"/);
  assert.match(accessStore, /engineer: \["view", "editOrk", "uploadEvidence", "completeTest"/);
  assert.match(accessStore, /viewer: \["view"\]/);
  assert.match(access, /requireProjectAccess/);
  assert.match(access, /x-project-id/);
  assert.match(ork, /requireProjectAccess\(request, "editOrk"\)/);
  assert.match(records, /action === "create-test" \? "createTest"/);
  assert.match(records, /action === "complete-test" \? "completeTest"/);
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
  assert.match(css, /--accent:\s*#c92335/);
  assert.match(css, /\.inspector-tabs-four/);
  assert.match(css, /\.engineering-record-list/);
});

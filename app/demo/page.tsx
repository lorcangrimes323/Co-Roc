import { MissionControl } from "../mission-control";
import type { ActiveWorkspace, WorkspaceIdentity } from "../workspace-types";

const user: WorkspaceIdentity = { name: "Demo user", email: "demo@local.invalid", preview: true, previewRole: "viewer" };
const workspace: ActiveWorkspace = {
  team: { id: "demo", name: "Demo workspace", slug: "demo", role: "viewer", status: "demo", permissions: ["view"], members: [], projects: [] },
  project: { id: "demo-banshee", name: "Banshee Mk II", slug: "banshee-mk2", description: "Non-authoritative demonstration", storageBytes: 0, fileCount: 0 },
};

export default function DemoPage() {
  return <MissionControl user={user} mode="demo" workspace={workspace} teams={[]} />;
}

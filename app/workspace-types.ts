export type TeamRole = "lead" | "engineer" | "viewer";
export type WorkspacePermission = "view" | "editOrk" | "uploadEvidence" | "createTest" | "completeTest" | "comment" | "createRevision" | "manageTeam" | "manageProjects";

export type WorkspaceMember = {
  id: number;
  email: string;
  displayName: string;
  role: TeamRole;
  status: string;
};

export type WorkspaceProject = {
  id: string;
  name: string;
  slug: string;
  description: string;
  storageBytes: number;
  fileCount: number;
};

export type WorkspaceTeam = {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
  status: string;
  permissions: WorkspacePermission[];
  projects: WorkspaceProject[];
  members: WorkspaceMember[];
  events?: Array<{ id: number; action: string; summary: string; actorName: string; createdAt: string }>;
};

export type WorkspaceIdentity = {
  name: string;
  email: string;
  preview: boolean;
  previewRole?: TeamRole | null;
};

export type ActiveWorkspace = {
  team: WorkspaceTeam;
  project: WorkspaceProject;
};

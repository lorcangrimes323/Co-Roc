import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull().default(210000),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accountSessions = sqliteTable("account_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("account_sessions_account_idx").on(table.accountId, table.expiresAt)]);

export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  lockedUntil: text("locked_until"),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdByEmail: text("created_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: text("team_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("engineer"),
  status: text("status").notNull().default("invited"),
  projectScope: text("project_scope").notNull().default("all"),
  invitedByEmail: text("invited_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("team_members_team_email_unique").on(table.teamId, table.email),
  index("team_members_email_idx").on(table.email, table.teamId),
]);

export const teamInviteCodes = sqliteTable("team_invite_codes", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  codeHint: text("code_hint").notNull(),
  role: text("role").notNull().default("viewer"),
  maxUses: integer("max_uses").notNull().default(1),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdByEmail: text("created_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("team_invite_codes_team_idx").on(table.teamId, table.createdAt),
]);

export const inviteCodeProjects = sqliteTable("invite_code_projects", {
  inviteCodeId: text("invite_code_id").notNull(),
  projectId: text("project_id").notNull(),
}, (table) => [
  uniqueIndex("invite_code_projects_unique").on(table.inviteCodeId, table.projectId),
  index("invite_code_projects_project_idx").on(table.projectId, table.inviteCodeId),
]);

export const memberProjectAccess = sqliteTable("member_project_access", {
  teamId: text("team_id").notNull(),
  memberEmail: text("member_email").notNull(),
  projectId: text("project_id").notNull(),
  grantedByEmail: text("granted_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("member_project_access_unique").on(table.teamId, table.memberEmail, table.projectId),
  index("member_project_access_project_idx").on(table.projectId, table.memberEmail),
]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  storageBytes: integer("storage_bytes").notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
  createdByEmail: text("created_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("projects_team_slug_unique").on(table.teamId, table.slug),
  index("projects_team_idx").on(table.teamId, table.id),
]);

export const teamEvents = sqliteTable("team_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: text("team_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  summary: text("summary").notNull(),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("team_events_team_id_idx").on(table.teamId, table.id)]);

export const revisions = sqliteTable("revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  state: text("state").notNull().default("review"),
  uploadedByName: text("uploaded_by_name").notNull(),
  uploadedByEmail: text("uploaded_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orkWorkspaces = sqliteTable("ork_workspaces", {
  projectId: text("project_id").primaryKey(),
  sourceName: text("source_name").notNull(),
  originalObjectKey: text("original_object_key").notNull(),
  currentObjectKey: text("current_object_key").notNull(),
  version: integer("version").notNull().default(1),
  sha256: text("sha256").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedByEmail: text("updated_by_email").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const orkChanges = sqliteTable("ork_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  version: integer("version").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  field: text("field").notNull(),
  previousValue: text("previous_value").notNull(),
  nextValue: text("next_value").notNull(),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("ork_changes_project_version_field_unique").on(table.projectId, table.version, table.componentId, table.field),
  index("ork_changes_project_id_idx").on(table.projectId, table.id),
]);

export const orkChangeProposals = sqliteTable("ork_change_proposals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  baseVersion: integer("base_version").notNull(),
  sourceName: text("source_name").notNull(),
  objectKey: text("object_key").notNull().unique(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("pending"),
  changedComponents: integer("changed_components").notNull(),
  geometryChanges: integer("geometry_changes").notNull().default(0),
  submittedByName: text("submitted_by_name").notNull(),
  submittedByEmail: text("submitted_by_email").notNull(),
  submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedByName: text("reviewed_by_name"),
  reviewedByEmail: text("reviewed_by_email"),
  reviewedAt: text("reviewed_at"),
  reviewNotes: text("review_notes"),
  appliedVersion: integer("applied_version"),
}, (table) => [
  index("ork_change_proposals_project_idx").on(table.projectId, table.submittedAt),
  index("ork_change_proposals_status_idx").on(table.projectId, table.status),
]);

export const orkChangeProposalItems = sqliteTable("ork_change_proposal_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proposalId: text("proposal_id").notNull(),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  componentName: text("component_name").notNull(),
  componentKind: text("component_kind").notNull(),
  changeType: text("change_type").notNull(),
  geometryChanged: integer("geometry_changed", { mode: "boolean" }).notNull().default(false),
  changesJson: text("changes_json").notNull(),
  rationale: text("rationale").notNull(),
}, (table) => [
  index("ork_change_proposal_items_proposal_idx").on(table.proposalId, table.id),
  index("ork_change_proposal_items_component_idx").on(table.projectId, table.componentId),
]);

export const orkSnapshots = sqliteTable("ork_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("ork_snapshots_project_version_unique").on(table.projectId, table.version),
]);

export const orkReleaseRequests = sqliteTable("ork_release_requests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  workingVersion: integer("working_version").notNull(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("pending"),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  requestedByEmail: text("requested_by_email").notNull(),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedByName: text("reviewed_by_name"),
  reviewedByEmail: text("reviewed_by_email"),
  reviewedAt: text("reviewed_at"),
  releaseNumber: integer("release_number"),
}, (table) => [
  index("ork_release_requests_project_idx").on(table.projectId, table.requestedAt),
]);

export const orkReleases = sqliteTable("ork_releases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  releaseNumber: integer("release_number").notNull(),
  workingVersion: integer("working_version").notNull(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdByEmail: text("created_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("ork_releases_project_number_unique").on(table.projectId, table.releaseNumber),
  index("ork_releases_project_idx").on(table.projectId, table.createdAt),
]);

export const simulationRuns = sqliteTable("simulation_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  orkVersion: integer("ork_version").notNull(),
  orkSha256: text("ork_sha256").notNull(),
  simulationIndex: integer("simulation_index").notNull(),
  simulationName: text("simulation_name").notNull(),
  engine: text("engine").notNull(),
  engineVersion: text("engine_version").notNull(),
  resultObjectKey: text("result_object_key").notNull().unique(),
  maxAltitude: real("max_altitude"),
  maxVelocity: real("max_velocity"),
  maxAcceleration: real("max_acceleration"),
  maxMach: real("max_mach"),
  warningCount: integer("warning_count").notNull().default(0),
  runByName: text("run_by_name").notNull(),
  runByEmail: text("run_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("simulation_runs_project_idx").on(table.projectId, table.createdAt),
]);

export const launchChecklists = sqliteTable("launch_checklists", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  mission: text("mission").notNull().default(""),
  launchSite: text("launch_site").notNull().default(""),
  scheduledFor: text("scheduled_for"),
  status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  baselineReleaseNumber: integer("baseline_release_number"),
  definitionJson: text("definition_json").notNull().default("{\"sections\":[]}"),
  createdByName: text("created_by_name").notNull(),
  createdByEmail: text("created_by_email").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedByEmail: text("updated_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  releasedByName: text("released_by_name"),
  releasedByEmail: text("released_by_email"),
  releasedAt: text("released_at"),
}, (table) => [
  index("launch_checklists_project_idx").on(table.projectId, table.updatedAt),
]);

export const checklistCustomParts = sqliteTable("checklist_custom_parts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Ground support equipment"),
  description: text("description").notNull().default(""),
  createdByName: text("created_by_name").notNull(),
  createdByEmail: text("created_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("checklist_custom_parts_project_code_unique").on(table.projectId, table.code),
  index("checklist_custom_parts_project_idx").on(table.projectId, table.name),
]);

export const componentArtifacts = sqliteTable("component_artifacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  revision: text("revision").notNull().default("A"),
  status: text("status").notNull().default("current"),
  fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  orkVersion: integer("ork_version"),
  supersedesId: integer("supersedes_id"),
  uploadedByName: text("uploaded_by_name").notNull(),
  uploadedByEmail: text("uploaded_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("component_artifacts_component_idx").on(table.projectId, table.componentId, table.id),
]);

export const componentTests = sqliteTable("component_tests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  title: text("title").notNull(),
  requirement: text("requirement").notNull(),
  status: text("status").notNull().default("required"),
  ownerName: text("owner_name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  completionNotes: text("completion_notes"),
  completedByName: text("completed_by_name"),
  completedByEmail: text("completed_by_email"),
  completedAt: text("completed_at"),
  evidenceArtifactId: integer("evidence_artifact_id"),
  orkVersion: integer("ork_version"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("component_tests_component_idx").on(table.projectId, table.componentId, table.id),
]);

export const componentComments = sqliteTable("component_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  body: text("body").notNull(),
  mentionsJson: text("mentions_json").notNull().default("[]"),
  orkVersion: integer("ork_version"),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("component_comments_component_idx").on(table.projectId, table.componentId, table.id),
]);

export const componentMentions = sqliteTable("component_mentions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  commentId: integer("comment_id").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  bodyExcerpt: text("body_excerpt").notNull(),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("component_mentions_comment_recipient_unique").on(table.commentId, table.recipientEmail),
  index("component_mentions_recipient_idx").on(table.projectId, table.recipientEmail, table.readAt, table.id),
]);

export const componentRecordEvents = sqliteTable("component_record_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  componentId: text("component_id").notNull(),
  componentCode: text("component_code").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  summary: text("summary").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  orkVersion: integer("ork_version"),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("component_record_events_component_idx").on(table.projectId, table.componentId, table.id),
]);

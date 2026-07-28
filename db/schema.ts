import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  invitedByEmail: text("invited_by_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("team_members_team_email_unique").on(table.teamId, table.email),
  index("team_members_email_idx").on(table.email, table.teamId),
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

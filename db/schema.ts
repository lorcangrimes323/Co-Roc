import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

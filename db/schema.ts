import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("organizations_owner_idx").on(table.ownerId)]);

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  relationshipType: text("relationship_type", { enum: ["recurring", "one_off"] }).notNull().default("one_off"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["production", "review", "changes", "approved", "archived"] }).notNull().default("production"),
  dueDate: text("due_date"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const deliverables = sqliteTable("deliverables", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  format: text("format").notNull().default("video"),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assetVersions = sqliteTable("asset_versions", {
  id: text("id").primaryKey(),
  deliverableId: text("deliverable_id").notNull().references(() => deliverables.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  decision: text("decision", { enum: ["pending", "changes", "approved"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reviewComments = sqliteTable("review_comments", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => assetVersions.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  timecodeMs: integer("timecode_ms").notNull().default(0),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  type: text("type").notNull(),
  subjectId: text("subject_id").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const financeEntries = sqliteTable("finance_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status", { enum: ["received", "pending"] }).notNull().default("pending"),
  competenceMonth: text("competence_month").notNull(),
  dueDate: text("due_date"),
  receivedAt: text("received_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// A revision prevents two browser sessions from silently overwriting each other.
export const studioWorkspaces = sqliteTable("studio_workspaces", {
  ownerId: text("owner_id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export const studioShares = sqliteTable("studio_shares", {
  token: text("token").primaryKey(),
  ownerId: text("owner_id").notNull(),
  assetId: integer("asset_id").notNull(),
  title: text("title").notNull(),
  fileKey: text("file_key").notNull(),
  mimeType: text("mime_type").notNull(),
  feedback: text("feedback").notNull().default('[]'),
  decision: text("decision").notNull().default('pending'),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

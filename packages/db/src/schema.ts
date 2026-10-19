import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AcceptanceCriterion, TaskPriority, TaskStatus } from "@ai-pixel/contracts";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(), name: text("name").notNull(), status: text("status").notNull().default("ACTIVE"), createdAt: createdAt(),
}, (t) => [check("organizations_status_check", sql`${t.status} in ('ACTIVE', 'SUSPENDED')`)]);
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), externalSubject: text("external_subject").notNull().unique(), displayName: text("display_name").notNull(), createdAt: createdAt(),
});
export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id), role: text("role").notNull(), status: text("status").notNull().default("ACTIVE"), createdAt: createdAt(),
}, (t) => [unique("memberships_org_user_unique").on(t.organizationId, t.userId), unique("memberships_org_id_unique").on(t.organizationId, t.id),
  check("memberships_role_check", sql`${t.role} in ('OWNER', 'VIEWER')`), check("memberships_status_check", sql`${t.status} in ('ACTIVE', 'REVOKED')`)]);
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(), organizationId: uuid("organization_id").notNull(), userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(), csrfHash: text("csrf_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [foreignKey({ name: "sessions_membership_fk", columns: [t.organizationId, t.userId], foreignColumns: [memberships.organizationId, memberships.userId] }),
  unique("sessions_org_id_unique").on(t.organizationId, t.id), index("sessions_expiry_idx").on(t.expiresAt),
  check("sessions_hash_check", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$' and ${t.csrfHash} ~ '^[a-f0-9]{64}$'`),
  check("sessions_expiry_check", sql`${t.expiresAt} > ${t.createdAt}`)]);
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id), name: text("name").notNull(),
  repositoryUrl: text("repository_url").notNull(), defaultBranch: text("default_branch").notNull().default("main"), status: text("status").notNull().default("ACTIVE"),
  version: integer("version").notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("projects_org_id_unique").on(t.organizationId, t.id), index("projects_org_status_idx").on(t.organizationId, t.status),
  check("projects_status_check", sql`${t.status} in ('ACTIVE', 'ARCHIVED')`), check("projects_version_check", sql`${t.version} > 0`),
  check("projects_name_check", sql`char_length(btrim(${t.name})) between 1 and 120`)]);
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(), organizationId: uuid("organization_id").notNull(), projectId: uuid("project_id").notNull(), title: text("title").notNull(),
  commandOriginalKo: text("command_original_ko").notNull(), commandHash: text("command_hash").notNull(), source: text("source").notNull().default("TEXT"),
  specEn: text("spec_en"), specVersion: integer("spec_version").notNull().default(1),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<AcceptanceCriterion[]>().notNull(), priority: text("priority").$type<TaskPriority>().notNull().default("MEDIUM"),
  status: text("status").$type<TaskStatus>().notNull().default("TODO"), blockedReason: text("blocked_reason"), version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [unique("tasks_org_id_unique").on(t.organizationId, t.id), unique("tasks_org_project_id_unique").on(t.organizationId, t.projectId, t.id),
  foreignKey({ name: "tasks_project_fk", columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  foreignKey({ name: "tasks_creator_fk", columns: [t.organizationId, t.createdBy], foreignColumns: [memberships.organizationId, memberships.userId] }),
  index("tasks_org_project_status_created_idx").on(t.organizationId, t.projectId, t.status, t.createdAt, t.id),
  check("tasks_status_check", sql`${t.status} in ('TODO','PLANNING','IN_PROGRESS','REVIEW','APPROVAL_REQUIRED','COMPLETED','FAILED','CANCELLED')`),
  check("tasks_priority_check", sql`${t.priority} in ('LOW','MEDIUM','HIGH','URGENT')`), check("tasks_source_check", sql`${t.source} in ('TEXT','VOICE','SLACK')`),
  check("tasks_version_check", sql`${t.version} > 0 and ${t.specVersion} > 0`), check("tasks_command_hash_check", sql`${t.commandHash} ~ '^[a-f0-9]{64}$'`),
  check("tasks_criteria_check", sql`jsonb_typeof(${t.acceptanceCriteria}) = 'array' and jsonb_array_length(${t.acceptanceCriteria}) between 1 and 100`),
  check("tasks_title_check", sql`char_length(btrim(${t.title})) between 1 and 200`),
  check("tasks_original_command_check", sql`char_length(btrim(${t.commandOriginalKo})) between 1 and 20000`)]);
export const organizationEventCounters = pgTable("organization_event_counters", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id), lastSequence: bigint("last_sequence", { mode: "bigint" }).notNull().default(0n),
}, (t) => [check("event_counter_nonnegative_check", sql`${t.lastSequence} >= 0`)]);
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id), projectId: uuid("project_id"),
  workflowRunId: uuid("workflow_run_id"), taskId: uuid("task_id"), agentId: uuid("agent_id"), sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  schemaVersion: integer("schema_version").notNull().default(1), type: text("type").notNull(), aggregateVersion: integer("aggregate_version").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), sourceEventId: text("source_event_id"),
}, (t) => [unique("events_org_id_unique").on(t.organizationId, t.id), unique("events_org_sequence_unique").on(t.organizationId, t.sequence),
  unique("events_org_source_unique").on(t.organizationId, t.sourceEventId),
  foreignKey({ name: "events_project_fk", columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  foreignKey({ name: "events_task_fk", columns: [t.organizationId, t.projectId, t.taskId], foreignColumns: [tasks.organizationId, tasks.projectId, tasks.id] }),
  index("events_org_project_sequence_idx").on(t.organizationId, t.projectId, t.sequence),
  check("events_versions_check", sql`${t.sequence} > 0 and ${t.schemaVersion} = 1 and ${t.aggregateVersion} > 0`),
  check("events_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`), check("events_task_project_check", sql`${t.taskId} is null or ${t.projectId} is not null`)]);
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey(), organizationId: uuid("organization_id").notNull().references(() => organizations.id), projectId: uuid("project_id"),
  actorType: text("actor_type").notNull(), actorId: text("actor_id").notNull(), action: text("action").notNull(), targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(), requestId: text("request_id").notNull(), outcome: text("outcome").notNull(), beforeHash: text("before_hash"), afterHash: text("after_hash"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}), createdAt: createdAt(),
}, (t) => [unique("audit_org_id_unique").on(t.organizationId, t.id),
  foreignKey({ name: "audit_project_fk", columns: [t.organizationId, t.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  index("audit_org_created_idx").on(t.organizationId, t.createdAt), index("audit_org_target_idx").on(t.organizationId, t.targetType, t.targetId),
  check("audit_outcome_check", sql`${t.outcome} in ('SUCCESS', 'DENIED', 'FAILED')`), check("audit_actor_type_check", sql`${t.actorType} in ('USER', 'SYSTEM', 'AGENT')`),
  check("audit_metadata_check", sql`jsonb_typeof(${t.metadata}) = 'object'`)]);
export const idempotencyKeys = pgTable("idempotency_keys", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id), actorId: text("actor_id").notNull(), route: text("route").notNull(), key: text("key").notNull(),
  requestHash: text("request_hash").notNull(), responseRef: jsonb("response_ref").$type<{ status: number; body: unknown }>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.actorId, t.route, t.key] }), index("idempotency_expiry_idx").on(t.expiresAt),
  check("idempotency_hash_check", sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`), check("idempotency_expiry_check", sql`${t.expiresAt} > ${t.createdAt}`),
  check("idempotency_response_check", sql`jsonb_typeof(${t.responseRef}) = 'object'`)]);

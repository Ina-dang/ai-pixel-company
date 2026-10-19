import { z } from "zod";

export const schemaVersion = 1 as const;
export const SCHEMA_VERSION = schemaVersion;
export const taskStatuses = ["TODO", "PLANNING", "IN_PROGRESS", "REVIEW", "APPROVAL_REQUIRED", "COMPLETED", "FAILED", "CANCELLED"] as const;
export const taskLabels: Record<(typeof taskStatuses)[number], string> = {
  TODO: "할 일", PLANNING: "계획 중", IN_PROGRESS: "진행 중", REVIEW: "검토 중",
  APPROVAL_REQUIRED: "승인 대기", COMPLETED: "완료", FAILED: "실패", CANCELLED: "취소",
};
export const taskStatusLabels = taskLabels;
export const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const commandSources = ["TEXT", "VOICE", "SLACK"] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export const taskPrioritySchema = z.enum(taskPriorities);
export const sequenceSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).max(19).refine((value) => BigInt(value) <= 9223372036854775807n, "Sequence exceeds PostgreSQL bigint").meta({ "x-bigint-max": "9223372036854775807" });
export const idSchema = z.uuid();
const versionSchema = z.number().int().min(1).max(2147483647);
const dateSchema = z.iso.datetime({ offset: true });

export const acceptanceCriterionSchema = z.strictObject({
  id: z.string().regex(/^AC-[1-9][0-9]*$/).max(32),
  descriptionKo: z.string().trim().min(1).max(2000),
  method: z.enum(["unit-test", "integration-test", "e2e-test", "manual", "inspection"]),
  required: z.boolean(),
});
export const acceptanceCriteriaSchema = z.array(acceptanceCriterionSchema).min(1).max(100).refine(
  (criteria) => new Set(criteria.map((criterion) => criterion.id)).size === criteria.length,
  "Acceptance criterion IDs must be unique",
);

// URL syntax is checked here. The API permits only its configured repository hosts.
export const repositoryUrlSchema = z.url({ protocol: /^https$/ }).max(2048).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname.split("/").filter(Boolean).length >= 2;
}, "Repository URL must use HTTPS without credentials, query, or fragment");
export const branchSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine(
  (value) => !value.includes("..") && !value.includes("//") && !value.includes("@{") && !value.endsWith("/") && !value.endsWith(".") && !value.split("/").some((part) => part.endsWith(".lock") || part.startsWith(".")),
  "Invalid branch name",
);
export const createProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), repositoryUrl: repositoryUrlSchema, defaultBranch: branchSchema.default("main"),
});
export const patchProjectSchema = z.strictObject({
  name: createProjectSchema.shape.name.optional(), repositoryUrl: repositoryUrlSchema.optional(),
  defaultBranch: branchSchema.optional(), expectedVersion: versionSchema,
}).refine((value) => value.name !== undefined || value.repositoryUrl !== undefined || value.defaultBranch !== undefined, "No update fields supplied");
export const createTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  // Do not trim or normalize the original Korean command.
  commandOriginalKo: z.string().min(1).max(20000).refine((value) => value.trim().length > 0, "Command is required"),
  source: z.enum(commandSources).default("TEXT"), acceptanceCriteria: acceptanceCriteriaSchema,
  priority: taskPrioritySchema.default("MEDIUM"),
});
export const patchTaskSchema = z.strictObject({
  title: createTaskSchema.shape.title.optional(), priority: taskPrioritySchema.optional(), expectedVersion: versionSchema,
}).refine((value) => value.title !== undefined || value.priority !== undefined, "No update fields supplied");
export const loginSchema = z.strictObject({ secret: z.string().min(1).max(1024) });
export const projectSchema = z.strictObject({
  id: idSchema, organizationId: idSchema, name: z.string(), repositoryUrl: repositoryUrlSchema,
  defaultBranch: branchSchema, status: z.enum(["ACTIVE", "ARCHIVED"]), version: versionSchema,
  createdAt: dateSchema, updatedAt: dateSchema,
});
export const taskSchema = z.strictObject({
  id: idSchema, organizationId: idSchema, projectId: idSchema, title: z.string(),
  commandOriginalKo: z.string(), commandHash: z.string().regex(/^[a-f0-9]{64}$/), source: z.enum(commandSources),
  specEn: z.string().nullable(), specVersion: versionSchema, acceptanceCriteria: acceptanceCriteriaSchema,
  priority: taskPrioritySchema, status: taskStatusSchema, statusLabelKo: z.string(), blockedReason: z.string().nullable(),
  version: versionSchema, createdBy: idSchema, createdAt: dateSchema, updatedAt: dateSchema, latestRunId: idSchema.nullable(),
});
export const eventTypes = ["project.created", "project.updated", "task.created", "task.updated", "task.status.changed", "workflow.run.created", "workflow.run.updated", "agent.completed", "approval.requested", "approval.resolved"] as const;
export const eventEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(schemaVersion), eventId: idSchema, organizationId: idSchema, projectId: idSchema.nullable(),
  runId: idSchema.nullable(), taskId: idSchema.nullable(), agentId: idSchema.nullable(), sequence: sequenceSchema,
  timestamp: dateSchema, type: z.enum(eventTypes), aggregateVersion: versionSchema,
  payload: z.record(z.string(), z.unknown()),
});
export const snapshotSchema = z.strictObject({
  projectId: idSchema, cursor: sequenceSchema, tasks: z.array(taskSchema), agents: z.array(z.unknown()), approvals: z.array(z.unknown()),
});
export const errorResponseSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), messageKo: z.string(), retryable: z.boolean(), details: z.unknown().optional() }), requestId: z.string(),
});
export const sessionUserSchema = z.strictObject({
  user: z.strictObject({ id: idSchema, displayName: z.string() }),
  organization: z.strictObject({ id: idSchema, name: z.string() }),
  csrfToken: z.string().min(32),
});
export const sessionResponseSchema = sessionUserSchema;
export const executionContractSchema = z.strictObject({
  schemaVersion: z.literal(schemaVersion), operationId: idSchema, workflowRunId: idSchema, taskId: idSchema,
  leaseToken: sequenceSchema, checkpointThreadId: z.string().min(1), specRef: z.string().min(1),
  profileRefs: z.array(z.string().min(1)).min(1), policyRef: z.string().min(1),
});
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ExecutionContract = z.infer<typeof executionContractSchema>;

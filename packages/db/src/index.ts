import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { eventEnvelopeSchema, schemaVersion, type EventEnvelope } from "@ai-pixel/contracts";
import * as schema from "./schema.js";

export * from "./schema.js";
export { migrateDatabase } from "./migrate.js";
export function createDatabase(url: string, options: { max?: number; ormMax?: number } = {}) {
  const sql = postgres(url, {
    max: options.max ?? 10, connect_timeout: 10, idle_timeout: 20,
    // Do not let notices or SQL debug logs disclose commands, credentials, or user input.
    onnotice: () => undefined,
  });
  // Drizzle changes postgres-js serializers on its client. Keep raw transactions
  // on a separate client so Date and sql.json() retain their native serializers.
  // The raw pool uses max (default 10); the ORM pool defaults to one connection.
  const ormSql = postgres(url, {
    max: options.ormMax ?? 1, connect_timeout: 10, idle_timeout: 20,
    onnotice: () => undefined,
  });
  const db = drizzle(ormSql, { schema });
  return { sql, db, close: async () => { await Promise.all([sql.end({ timeout: 5 }), ormSql.end({ timeout: 5 })]); } };
}
export type Database = ReturnType<typeof createDatabase>;
export type Transaction = postgres.TransactionSql;

/** Acquire the organization's counter before domain mutations and hold it until commit. */
export async function withOrganizationEvent<T>(database: Database, organizationId: string, work: (tx: Transaction, sequence: bigint) => Promise<T>): Promise<T> {
  const result = await database.sql.begin(async (tx) => {
    await tx`INSERT INTO organization_event_counters (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`;
    const rows = await tx<{ last_sequence: string }[]>`UPDATE organization_event_counters SET last_sequence = last_sequence + 1 WHERE organization_id = ${organizationId} RETURNING last_sequence`;
    const counter = rows[0];
    if (!counter) throw new Error("Organization event counter unavailable");
    const value = await work(tx, BigInt(counter.last_sequence));
    return { value };
  });
  return result.value;
}
export type AppendEventInput = {
  organizationId: string; projectId?: string | null; taskId?: string | null; runId?: string | null; agentId?: string | null;
  sequence: bigint; type: EventEnvelope["type"]; aggregateVersion: number; payload: Record<string, unknown>; sourceEventId?: string | null;
};
export async function appendEvent(tx: Transaction, input: AppendEventInput): Promise<EventEnvelope> {
  const event = eventEnvelopeSchema.parse({
    schemaVersion, eventId: randomUUID(), organizationId: input.organizationId, projectId: input.projectId ?? null,
    taskId: input.taskId ?? null, runId: input.runId ?? null, agentId: input.agentId ?? null, sequence: input.sequence.toString(),
    timestamp: new Date().toISOString(), type: input.type, aggregateVersion: input.aggregateVersion, payload: input.payload,
  });
  await tx`INSERT INTO agent_events (id,organization_id,project_id,workflow_run_id,task_id,agent_id,sequence,schema_version,type,aggregate_version,payload,occurred_at,source_event_id)
    VALUES (${event.eventId},${event.organizationId},${event.projectId},${event.runId},${event.taskId},${event.agentId},${event.sequence},${event.schemaVersion},${event.type},${event.aggregateVersion},${tx.json(JSON.parse(JSON.stringify(event.payload)) as postgres.JSONValue)},${event.timestamp},${input.sourceEventId ?? null})`;
  return event;
}
export function toEventEnvelope(row: typeof schema.agentEvents.$inferSelect): EventEnvelope {
  return eventEnvelopeSchema.parse({
    schemaVersion: row.schemaVersion, eventId: row.id, organizationId: row.organizationId, projectId: row.projectId,
    runId: row.workflowRunId, taskId: row.taskId, agentId: row.agentId, sequence: row.sequence.toString(),
    timestamp: row.occurredAt.toISOString(), type: row.type, aggregateVersion: row.aggregateVersion, payload: row.payload,
  });
}

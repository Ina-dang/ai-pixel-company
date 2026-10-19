import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { appendEvent, createDatabase, migrateDatabase, withOrganizationEvent, type Database } from "../src/index.js";

const url = process.env.TEST_DATABASE_URL;
// These tests never run against DATABASE_URL and only accept explicitly named test databases.
const allowed = url !== undefined && new URL(url).pathname.toLowerCase().includes("test");
const rollback = new Error("rollback isolated fixture");
describe.skipIf(!allowed)("PostgreSQL foundation constraints and transaction behavior", () => {
  let database: Database;
  beforeAll(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL is required for database integration tests");
    database = createDatabase(url, { max: 4 });
    await migrateDatabase(database);
  });
  afterAll(async () => { await database?.close(); });
  it("preserves raw Date and JSON serialization alongside the ORM client", async () => {
    const timestamp = new Date("2026-10-19T00:00:00.000Z");
    const payload = { title: "한국어 원문", version: 1 };
    const rows = await database.sql<{ occurred_at: Date; payload: typeof payload }[]>`SELECT ${timestamp}::timestamptz AS occurred_at, ${database.sql.json(payload)}::jsonb AS payload`;
    expect(rows[0]?.occurred_at).toEqual(timestamp);
    expect(rows[0]?.payload).toEqual(payload);
  });
  it("migrations are repeatable and application constraints block cross-tenant references", async () => {
    await migrateDatabase(database);
    try {
      await database.sql.begin(async (tx) => {
        const organization = randomUUID(); const otherOrganization = randomUUID(); const user = randomUUID(); const project = randomUUID();
        await tx`INSERT INTO organizations (id,name) VALUES (${organization},'Tenant A'),(${otherOrganization},'Tenant B')`;
        await tx`INSERT INTO users (id,external_subject,display_name) VALUES (${user},${randomUUID()},'Fixture owner')`;
        await tx`INSERT INTO memberships (id,organization_id,user_id,role) VALUES (${randomUUID()},${organization},${user},'OWNER')`;
        await tx`INSERT INTO projects (id,organization_id,name,repository_url) VALUES (${project},${otherOrganization},'Other project','https://github.com/example/fixture')`;
        await expect(tx.savepoint(async (savepoint) => {
          await savepoint`INSERT INTO tasks (id,organization_id,project_id,title,command_original_ko,command_hash,acceptance_criteria,created_by)
            VALUES (${randomUUID()},${organization},${project},'Fixture','한국어 원문',${createHash('sha256').update('한국어 원문').digest('hex')},'[{"id":"AC-1"}]',${user})`;
        })).rejects.toMatchObject({ code: "23503" });
        await expect(tx.savepoint(async (savepoint) => {
          await savepoint`INSERT INTO projects (id,organization_id,name,repository_url,version) VALUES (${randomUUID()},${organization},'Invalid version','https://github.com/example/fixture',0)`;
        })).rejects.toMatchObject({ code: "23514" });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
  it("counter and event rollback together when a domain mutation fails", async () => {
    const organization = randomUUID();
    await database.sql`INSERT INTO organizations (id,name) VALUES (${organization},'Rollback fixture')`;
    try {
      await expect(withOrganizationEvent(database, organization, async (tx, sequence) => {
        await appendEvent(tx, { organizationId: organization, sequence, type: "project.created", aggregateVersion: 1, payload: { fixture: true } });
        throw new Error("Rejected domain mutation");
      })).rejects.toThrow("Rejected domain mutation");
      const counters = await database.sql`SELECT * FROM organization_event_counters WHERE organization_id = ${organization}`;
      const events = await database.sql`SELECT * FROM agent_events WHERE organization_id = ${organization}`;
      expect(counters).toHaveLength(0); expect(events).toHaveLength(0);
    } finally {
      await database.sql`DELETE FROM organizations WHERE id = ${organization}`;
    }
  });
  it("org counter locks serialize concurrent event commits", async () => {
    const organization = randomUUID();
    await database.sql`INSERT INTO organizations (id,name) VALUES (${organization},'Concurrency fixture')`;
    try {
      await Promise.all(Array.from({ length: 6 }, (_, index) => withOrganizationEvent(database, organization, async (tx, sequence) => {
        await appendEvent(tx, { organizationId: organization, sequence, type: "project.created", aggregateVersion: 1, payload: { index } });
      })));
      const rows = await database.sql<{ sequence: string }[]>`SELECT sequence FROM agent_events WHERE organization_id = ${organization} ORDER BY sequence`;
      expect(rows.map((row) => String(row.sequence))).toEqual(["1", "2", "3", "4", "5", "6"]);
    } finally {
      await database.sql`DELETE FROM agent_events WHERE organization_id = ${organization}`;
      await database.sql`DELETE FROM organization_event_counters WHERE organization_id = ${organization}`;
      await database.sql`DELETE FROM organizations WHERE id = ${organization}`;
    }
  });
});

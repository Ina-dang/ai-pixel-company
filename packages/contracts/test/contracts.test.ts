import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createProjectSchema, createTaskSchema, eventEnvelopeSchema, executionContractSchema, patchTaskSchema, sequenceSchema, sessionResponseSchema, taskStatuses } from "../src/index.js";

const fixtures = JSON.parse(readFileSync(new URL("../fixtures/contracts.json", import.meta.url), "utf8")) as { event: Record<string, unknown>; execution: Record<string, unknown> };
const criterion = { id: "AC-1", descriptionKo: "새로고침 후 원문이 유지된다", method: "integration-test", required: true };
describe("Phase 0 public contracts", () => {
  it("validates the API's nested session user and organization response", () => {
    const session = {
      user: { id: "22222222-2222-4222-8222-222222222222", displayName: "헴" },
      organization: { id: "11111111-1111-4111-8111-111111111111", name: "AI Pixel Company" },
      csrfToken: "a".repeat(64),
    };
    expect(sessionResponseSchema.parse(session)).toEqual(session);
    expect(sessionResponseSchema.safeParse({ ...session, tokenHash: "server-only" }).success).toBe(false);
  });
  it("preserves original Korean bytes and rejects duplicate criterion IDs", () => {
    const commandOriginalKo = "  한국어 원문\n두 번째 줄  ";
    const request = { title: "원문 보존", commandOriginalKo, acceptanceCriteria: [criterion] };
    expect(createTaskSchema.parse(request).commandOriginalKo).toBe(commandOriginalKo);
    expect(createTaskSchema.safeParse({ ...request, acceptanceCriteria: [criterion, criterion] }).success).toBe(false);
  });
  it("rejects arbitrary status writes and non-task state codes", () => {
    expect(patchTaskSchema.safeParse({ status: "COMPLETED", expectedVersion: 1 }).success).toBe(false);
    expect(taskStatuses).not.toContain("PAUSED");
    expect(taskStatuses).not.toContain("BLOCKED");
  });
  it("rejects repository credentials, non-HTTPS transports and unsafe branches", () => {
    const project = { name: "fixture", repositoryUrl: "https://github.com/example/repository.git", defaultBranch: "main" };
    expect(createProjectSchema.safeParse(project).success).toBe(true);
    for (const repositoryUrl of ["http://github.com/example/repo", "https://token@github.com/example/repo", "https://github.com/example/repo?secret=1"]) {
      expect(createProjectSchema.safeParse({ ...project, repositoryUrl }).success).toBe(false);
    }
    for (const defaultBranch of ["../main", "feature//bad", "main.lock", "-flag"]) {
      expect(createProjectSchema.safeParse({ ...project, defaultBranch }).success).toBe(false);
    }
  });
  it("keeps bigint cursors as decimal strings without numeric precision loss", () => {
    expect(sequenceSchema.parse("9007199254740993")).toBe("9007199254740993");
    expect(sequenceSchema.parse("9223372036854775807")).toBe("9223372036854775807");
    for (const value of [42, "01", "-1", "9223372036854775808"]) expect(sequenceSchema.safeParse(value).success).toBe(false);
  });
  it("rejects unknown versions and unexpected fields at the engine and event boundaries", () => {
    for (const [schema, data] of [[eventEnvelopeSchema, fixtures.event], [executionContractSchema, fixtures.execution]] as const) {
      expect(schema.safeParse(data).success).toBe(true);
      expect(schema.safeParse({ ...data, schemaVersion: 2 }).success).toBe(false);
      expect(schema.safeParse({ ...data, organizationOverride: "untrusted" }).success).toBe(false);
    }
  });
});

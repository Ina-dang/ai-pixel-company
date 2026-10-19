import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eventEnvelopeSchema, executionContractSchema } from "../src/index.js";

const fixtures = JSON.parse(readFileSync(new URL("../fixtures/contracts.json", import.meta.url), "utf8")) as Record<"execution" | "event", Record<string, unknown>>;
const schemas = { execution: executionContractSchema, event: eventEnvelopeSchema };
const cases: { name: string; contract: keyof typeof schemas; data: unknown; valid: boolean }[] = [];
for (const contract of ["execution", "event"] as const) {
  const data = fixtures[contract];
  cases.push({ name: `${contract}:valid`, contract, data, valid: true });
  cases.push({ name: `${contract}:unknown-version`, contract, data: { ...data, schemaVersion: 2 }, valid: false });
  cases.push({ name: `${contract}:unknown-field`, contract, data: { ...data, accessToken: "fixture-only" }, valid: false });
  const field = contract === "execution" ? "leaseToken" : "sequence";
  cases.push({ name: `${contract}:numeric-bigint`, contract, data: { ...data, [field]: 42 }, valid: false });
  cases.push({ name: `${contract}:overflow-bigint`, contract, data: { ...data, [field]: "9223372036854775808" }, valid: false });
  cases.push({ name: `${contract}:noncanonical-bigint`, contract, data: { ...data, [field]: "01" }, valid: false });
  cases.push({ name: `${contract}:invalid-id`, contract, data: { ...data, taskId: "not-a-uuid" }, valid: false });
}
cases.push({ name: "execution:empty-profiles", contract: "execution", data: { ...fixtures.execution, profileRefs: [] }, valid: false });
cases.push({ name: "event:unknown-status-event", contract: "event", data: { ...fixtures.event, type: "unsupported.event" }, valid: false });
for (const fixture of cases) {
  if (schemas[fixture.contract].safeParse(fixture.data).success !== fixture.valid) throw new Error(`TypeScript fixture failed: ${fixture.name}`);
}
const generated = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
const canonical = JSON.parse(readFileSync(new URL("../fixtures/execution-v1.schema.json", import.meta.url), "utf8")) as unknown;
const executionCases = cases.filter((fixture) => fixture.contract === "execution").map((fixture) => ({ ...fixture, contract: "canonical" }));
// Exercise the propertyNames validation emitted for Zod records, including a
// constrained-key rejection so silently ignoring this keyword cannot pass.
const propertyNameSchema = { type: "object", propertyNames: { type: "string", pattern: "^AC-[1-9][0-9]*$" }, additionalProperties: true };
const validatorCases = [
  { name: "property-names:valid", contract: "propertyNames", data: { "AC-1": "한국어 원문" }, valid: true },
  { name: "property-names:invalid", contract: "propertyNames", data: { "untrusted-key": "한국어 원문" }, valid: false },
];
const python = spawnSync(process.env.PYTHON ?? "python", [fileURLToPath(new URL("validate_contracts.py", import.meta.url))], {
  input: JSON.stringify({ schemas: { ...generated, canonical, propertyNames: propertyNameSchema }, cases: [...cases, ...executionCases, ...validatorCases] }), encoding: "utf8", windowsHide: true,
});
if (python.error || python.status !== 0) {
  throw new Error(`Python contract verification failed: ${python.error?.message ?? python.stderr.trim()}`);
}
const result = JSON.parse(python.stdout) as { passed: number };
console.log(`TypeScript fixtures: ${cases.length}; Python exported/canonical JSON Schema fixtures: ${result.passed}; original Korean and bigint strings preserved`);

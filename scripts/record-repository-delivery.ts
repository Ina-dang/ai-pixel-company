import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';
import { recordRepositoryDelivery } from '../apps/api/src/repository-delivery.js';

const runId = process.argv[2];
assert(runId && /^[a-f0-9-]{36}$/.test(runId), 'Usage: record-repository-delivery.ts <existing-run-id>');
const database = createDatabase(loadRuntime().databaseUrl);
try { console.log(JSON.stringify(await recordRepositoryDelivery(database, fileURLToPath(new URL('../', import.meta.url)), runId))); }
finally { await database.close(); }

import { spawnSync } from 'node:child_process';
import { loadRuntime } from './runtime.js';

const url = new URL(loadRuntime().databaseUrl);
url.pathname = '/pixel_company_test';
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? url.toString() },
});
process.exit(result.status ?? 1);

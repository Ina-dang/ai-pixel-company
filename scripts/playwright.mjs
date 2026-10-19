import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: fileURLToPath(new URL('../.local/playwright', import.meta.url)) },
});
process.exit(result.status ?? 1);

// Immutable broker checks, baked into the admitted dependency image, outside candidate mounts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ts = require('/opt/deps/node_modules/typescript');
const work = '/tmp/work';
fs.cpSync('/candidate', work, { recursive: true });
fs.symlinkSync('/opt/deps/node_modules', path.join(work, 'node_modules'), 'dir');
process.chdir(work);
for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'DATABASE_URL', 'SLACK_BOT_TOKEN']) assert.equal(process.env[key], undefined);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: work, stdio: 'inherit', timeout: 105000 });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
function load(file) {
  const source = fs.readFileSync(path.join(work, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
  return module.exports;
}
if (process.argv[2] === 'test') {
  const { buildRegions, filterRegions } = load('src/lib/regions.ts');
  const { wasteGuides } = load('src/data/seoul-waste-guides.ts');
  const regions = buildRegions(wasteGuides);
  assert.equal(regions.length, Object.keys(wasteGuides).length);
  assert.equal(regions.length, 25);
  assert.deepEqual(new Set(regions.map(region => region.key)), new Set(Object.keys(wasteGuides)));
  for (const region of regions) assert.equal(region.label, wasteGuides[region.key].region);
  assert.deepEqual(regions.map(region => region.label), regions.map(region => region.label).sort((a, b) => a.localeCompare(b, 'ko')));
  const before = JSON.stringify(regions);
  assert.deepEqual(filterRegions(regions, ''), regions);
  assert.deepEqual(filterRegions(regions, ' \t '), regions);
  assert.deepEqual(filterRegions(regions, '  관악  ').map(region => region.key), ['gwanak']);
  assert.deepEqual(filterRegions(regions, 'GWANAK').map(region => region.key), ['gwanak']);
  assert.deepEqual(filterRegions(regions, '존재하지않는지역'), []);
  assert.equal(JSON.stringify(regions), before);
  const page = fs.readFileSync('src/app/page.tsx', 'utf8');
  assert.match(page, /RegionDirectory/);
  assert.match(page, /buildRegions/);
  assert.match(page, /wasteGuides/);
  assert.doesNotMatch(page, /현재는 관악구/);
  console.log('BROKER_AC_01_04_PASS: exact dataset, count, sorting, trimming, slug, empty, nonmutation, page wiring');
  assert.ok(fs.existsSync('tests/regions.test.mjs'), 'Developer regression tests required');
  run(process.execPath, ['--test', 'tests/regions.test.mjs']);
} else if (process.argv[2] === 'build') {
  run(process.execPath, ['/opt/deps/node_modules/eslint/bin/eslint.js', '.']);
  run(process.execPath, ['/opt/deps/node_modules/next/dist/bin/next', 'build', '--webpack']);
  run(process.execPath, ['/opt/deps/node_modules/typescript/bin/tsc', '--noEmit']);
} else if (process.argv[2] === 'preview') {
  run(process.execPath, ['/opt/deps/node_modules/next/dist/bin/next', 'build', '--webpack']);
  const child = require('node:child_process').spawn(process.execPath,
    ['/opt/deps/node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', '3000'], { cwd: work, stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
} else {
  throw new Error('Unknown broker mode');
}

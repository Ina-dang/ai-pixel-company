import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOW_TO_TRASH_BASE_SHA, HOW_TO_TRASH_URL, loadRepositoryAdmission, RepositorySandbox, type Admission, type RepositorySource } from '../src/repository.js';

let root: string, manifestPath: string, source: RepositorySource, sandbox: RepositorySandbox, id: string;
const originalPackage = JSON.stringify({ name: 'test', scripts: { build: 'next build' }, dependencies: { next: '16.2.4' } });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixel-repository-test-'));
  manifestPath = join(root, '.local/repository-admissions/how-to-trash/manifest.json');
  await mkdir(dirname(manifestPath), { recursive: true });
  const admission: Admission = { version: 1, source: { profile: 'how-to-trash-v1', repositoryUrl: HOW_TO_TRASH_URL,
    baseSha: HOW_TO_TRASH_BASE_SHA, imageId: `sha256:${'a'.repeat(64)}` }, files: [
    { path: 'package.json', content: originalPackage }, { path: 'package-lock.json', content: '{"fixed":true}' },
    { path: 'src/app/page.tsx', content: 'original' }, { path: 'src/data/guide.ts', content: 'immutable policy data' },
  ], assets: [{ path: 'src/app/favicon.ico', base64: Buffer.from([0, 1, 255]).toString('base64') }] };
  await writeFile(manifestPath, JSON.stringify(admission));
  source = (await loadRepositoryAdmission(root)).source;
  sandbox = new RepositorySandbox(root, source); id = randomUUID();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('admitted real repository boundaries', () => {
  it('pins source, snapshots unchanged assets and hashes real file edits', async () => {
    const before = await sandbox.prepare(id);
    const after = await sandbox.apply(id, [{ path: 'src/app/page.tsx', content: 'implemented region directory' }]);
    expect(after.sha).not.toBe(before.sha); expect(after.diff).toContain('implemented region directory');
    expect((await sandbox.snapshot(id)).sha).toBe(after.sha);
    expect(source.admissionSha).toBe(createHash('sha256').update(await readFile(manifestPath)).digest('hex'));
  });
  it('blocks traversal, unexpected executable/config and immutable data changes before writing', async () => {
    await sandbox.prepare(id);
    for (const path of ['../escape', 'src/data/guide.ts', 'next.config.ts', '.env', 'src/app/api/route.ts']) {
      await expect(sandbox.apply(id, [{ path, content: 'bad' }])).rejects.toThrow('PATH_DENIED');
    }
    expect(await readFile(join(root, '.local/repository-workspaces', id, 'src/data/guide.ts'), 'utf8')).toBe('immutable policy data');
  });
  it('allows only the explicit test script addition and blocks dependency/hook changes', async () => {
    await sandbox.prepare(id);
    const allowed = JSON.parse(originalPackage); allowed.scripts.test = 'node --test tests/*.test.mjs';
    await sandbox.apply(id, [{ path: 'package.json', content: JSON.stringify(allowed) }]);
    for (const altered of [ { ...allowed, dependencies: { next: 'other' } }, { ...allowed, scripts: { ...allowed.scripts, postinstall: 'bad' } } ]) {
      await expect(sandbox.apply(id, [{ path: 'package.json', content: JSON.stringify(altered) }])).rejects.toThrow('PACKAGE_CHANGE_DENIED');
    }
  });
  it('detects source admission changes across restart and accepts JSONB key ordering', async () => {
    await sandbox.prepare(id);
    const reordered = { imageId: source.imageId, admissionSha: source.admissionSha, baseSha: source.baseSha, repositoryUrl: source.repositoryUrl, profile: source.profile };
    expect((await new RepositorySandbox(root, reordered).snapshot(id)).sha).toBe((await sandbox.snapshot(id)).sha);
    await writeFile(manifestPath, `${await readFile(manifestPath, 'utf8')}\n`);
    await expect(sandbox.snapshot(id)).rejects.toThrow('REPOSITORY_SOURCE_CHANGED');
  });
  it('detects binary asset, trusted file and missing source tampering', async () => {
    await sandbox.prepare(id);
    await writeFile(join(root, '.local/repository-workspaces', id, 'src/app/favicon.ico'), 'tamper');
    await expect(sandbox.snapshot(id)).rejects.toThrow('TRUSTED_FILE_CHANGED');
  });
  it('blocks hardlinks and duplicate or oversized replacements', async () => {
    await sandbox.prepare(id);
    await expect(sandbox.apply(id, [{ path: 'src/app/page.tsx', content: 'a' }, { path: 'src/app/page.tsx', content: 'b' }])).rejects.toThrow('SIZE_LIMIT');
    await expect(sandbox.apply(id, [{ path: 'src/app/page.tsx', content: 'x'.repeat(32_001) }])).rejects.toThrow('SIZE_LIMIT');
    await link(join(root, '.local/repository-workspaces', id, 'src/app/page.tsx'), join(root, 'outside-link'));
    await expect(sandbox.snapshot(id)).rejects.toThrow('FILE_DENIED');
  });
  it('rejects unknown repository identities and pre-existing workspaces', async () => {
    await sandbox.prepare(id); await expect(sandbox.prepare(id)).rejects.toThrow();
    const data = JSON.parse(await readFile(manifestPath, 'utf8')); data.source.repositoryUrl = 'https://github.com/other/repository.git';
    await writeFile(manifestPath, JSON.stringify(data));
    await expect(loadRepositoryAdmission(root)).rejects.toThrow('ADMISSION_INVALID');
  });
});

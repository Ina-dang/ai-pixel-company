import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DockerSandbox } from '../src/index';

const roots: string[] = [];
async function sandbox(timeoutMs = 10_000) {
  const root = await mkdtemp(join(tmpdir(), 'pixel-sandbox-test-'));
  roots.push(root);
  return { root, worker: new DockerSandbox(root, { timeoutMs }), runId: randomUUID() };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('fixture workspace broker', () => {
  it('hashes exact files, reports real diff and protects trusted files', async () => {
    const { worker, runId } = await sandbox();
    const initial = await worker.prepare(runId);
    expect((await worker.snapshot(runId)).sha).toBe(initial.sha);
    const next = await worker.apply(runId, [
      { path: 'src/math.mjs', content: 'export const add = (a, b) => a + b;\nexport const sum = (values) => values.reduce(add, 0);\n' },
    ]);
    expect(next.sha).not.toBe(initial.sha);
    expect(next.diff).toContain('-  return a - b;');
    expect(next.diff).toContain('+export const add');
    await expect(worker.apply(runId, [{ path: 'test/math.test.mjs', content: '' }])).rejects.toThrow('PATH_DENIED');
    await expect(worker.apply(runId, [{ path: 'build.mjs', content: '' }])).rejects.toThrow('PATH_DENIED');
    await expect(worker.prepare(runId)).rejects.toThrow('WORKSPACE_EXISTS');
  });
  it('rejects traversal, duplicate files, oversized content and malformed run IDs', async () => {
    const { worker, runId } = await sandbox();
    await worker.prepare(runId);
    for (const path of ['../escape', '/etc/passwd', 'src/../build.mjs', 'src\\math.mjs', 'test/extra/evil.mjs']) {
      await expect(worker.apply(runId, [{ path, content: '' }])).rejects.toThrow('PATH_DENIED');
    }
    await expect(worker.apply(runId, [{ path: 'src/math.mjs', content: 'x'.repeat(65_537) }])).rejects.toThrow('SIZE_LIMIT');
    await expect(worker.apply(runId, [{ path: 'src/math.mjs', content: '' }, { path: 'src/math.mjs', content: '' }])).rejects.toThrow('DUPLICATE_PATH');
    await expect(worker.snapshot('../other')).rejects.toThrow('INVALID_RUN_ID');
  });
  it('detects trusted-file tampering and symbolic-link escape before accepting writes', async () => {
    const { root, worker, runId } = await sandbox();
    await worker.prepare(runId);
    const externalDirectory = join(root, 'external');
    await mkdir(externalDirectory);
    const external = join(externalDirectory, 'external.mjs');
    await writeFile(external, 'external');
    const link = join(root, runId, 'test', 'escape');
    await symlink(externalDirectory, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(worker.snapshot(runId)).rejects.toThrow('SYMLINK_DENIED');
    await expect(worker.apply(runId, [{ path: 'src/math.mjs', content: 'changed' }])).rejects.toThrow('SYMLINK_DENIED');
    expect(await readFile(external, 'utf8')).toBe('external');
    await rm(link);
    await writeFile(join(root, runId, 'build.mjs'), 'tampered');
    await expect(worker.snapshot(runId)).rejects.toThrow('TRUSTED_FILE_CHANGED');
  });
});

describe('real Docker verification (required, never silently skipped)', () => {
  it('fails closed when Docker cannot be invoked', async () => {
    const { worker } = await sandbox();
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), `missing-docker-${randomUUID()}`);
    try { await expect(worker.preflight()).rejects.toThrow('DOCKER_UNAVAILABLE'); }
    finally { process.env.PATH = originalPath; }
  });
  it('observes the initial failing tests then a real same-SHA test/build pass', async () => {
    const { worker, runId } = await sandbox();
    await worker.prepare(runId);
    const failing = await worker.verify(runId);
    expect(failing.test.exitCode).not.toBe(0);
    expect(failing.build.exitCode).toBe(0);
    expect(failing.test.command).toEqual(['node', '--test', 'test/math.test.mjs']);
    expect(failing.build.command).toEqual(['node', 'build.mjs']);
    const candidate = await worker.apply(runId, [{ path: 'src/math.mjs', content: 'export const add = (a, b) => a + b;\nexport const sum = (values) => values.reduce(add, 0);\n' }]);
    const passing = await worker.verify(runId);
    expect(passing.sha).toBe(candidate.sha);
    expect(passing.test.exitCode).toBe(0);
    expect(passing.build.exitCode).toBe(0);
    expect(passing.sandbox).toEqual({ networkDisabled: true, readOnlyRoot: true, resourceLimited: true });
  }, 60_000);
  it('blocks network, root/workspace writes, host credentials and daemon socket', async () => {
    const { worker, runId } = await sandbox();
    await worker.prepare(runId);
    process.env.PIXEL_HOST_SECRET_SENTINEL = 'must-never-enter-container';
    try {
      await worker.apply(runId, [
        { path: 'src/math.mjs', content: 'export const add = (a, b) => a + b;\nexport const sum = (values) => values.reduce(add, 0);\n' },
        { path: 'test/extra-isolation.mjs', content: `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, existsSync } from 'node:fs';
import { connect } from 'node:net';
test('isolation', async () => {
  assert.equal(process.getuid(), 1000);
  assert.equal(process.env.PIXEL_HOST_SECRET_SENTINEL, undefined);
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.CODEX_API_KEY, undefined);
  assert.equal(existsSync('/var/run/docker.sock'), false);
  assert.throws(() => writeFileSync('/rootfs-escape', 'x'));
  assert.throws(() => writeFileSync('/workspace/src/math.mjs', 'x'));
  await new Promise((resolve, reject) => {
    const socket = connect({host: '1.1.1.1', port: 80});
    socket.once('connect', () => {socket.destroy(); reject(new Error('network escape'));});
    socket.once('error', () => {socket.destroy(); resolve();});
    socket.setTimeout(1000, () => {socket.destroy(); resolve();});
  });
});\n` },
      ]);
      const result = await worker.verify(runId);
      expect(result.test.exitCode).toBe(0);
      expect(result.build.exitCode).toBe(0);
    } finally {
      delete process.env.PIXEL_HOST_SECRET_SENTINEL;
    }
  }, 30_000);
  it('times out generated code and removes the container before returning', async () => {
    const { worker, runId } = await sandbox(2_000);
    await worker.prepare(runId);
    await worker.apply(runId, [{ path: 'test/extra-infinite.mjs', content: 'setInterval(() => {}, 1000);\n' }]);
    const result = await worker.verify(runId);
    expect(result.test.exitCode).toBe(124);
    expect(await worker.activeContainers(runId)).toEqual([]);
    await worker.cleanup(runId);
    await expect(worker.snapshot(runId)).rejects.toThrow();
  }, 30_000);
  it('cancels active verification and removes every run container', async () => {
    const { worker, runId } = await sandbox();
    await worker.prepare(runId);
    await worker.apply(runId, [{ path: 'test/extra-infinite.mjs', content: 'setInterval(() => {}, 1000);\n' }]);
    const controller = new AbortController();
    const verification = worker.verify(runId, controller.signal);
    const timer = setTimeout(() => controller.abort(), 1_500);
    try { await expect(verification).rejects.toThrow('ABORTED'); } finally { clearTimeout(timer); }
    expect(await worker.activeContainers(runId)).toEqual([]);
  }, 30_000);
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { assessSubscription, subscriptionEnvironment, terminateProcess } from '../src/codex.js';
import { WorkflowRunner } from '../src/workflow.js';
import { ExecutionBlocked, initialCheckpoint, type AgentProvider, type Checkpoint, type CodeSandbox, type RoleOutput, type WorkflowRun, type WorkflowStore } from '../src/types.js';

const account = { type: 'chatgpt' };
function quota(percent = 12) { return { ordinaryUsageAllowed: true, rateLimitsByLimitId: { codex: {
  primary: { usedPercent: percent, resetsAt: 2000000000, windowDurationMins: 10080 }, secondary: null,
  credits: { hasCredits: false, unlimited: false, balance: '0' }, spendControlReached: false, rateLimitReachedType: null,
} } }; }
describe('subscription admission fails closed', () => {
  it('requires ChatGPT, verified quota and no paid credits', () => {
    expect(assessSubscription(account, quota()).ready).toBe(true);
    expect(assessSubscription({ type: 'apiKey' }, quota()).reason).toBe('CHATGPT_LOGIN_REQUIRED');
    expect(assessSubscription(account, {}).ready).toBe(false);
    const credits = quota(); credits.rateLimitsByLimitId.codex.credits.hasCredits = true;
    expect(assessSubscription(account, credits).reason).toBe('PAID_CREDITS_UNSUPPORTED');
    const missing = quota(); delete (missing.rateLimitsByLimitId.codex as Partial<typeof missing.rateLimitsByLimitId.codex>).spendControlReached;
    expect(assessSubscription(account, missing).ready).toBe(false);
  });
  it('blocks reserve threshold, exhausted allowance and spend controls', () => {
    expect(assessSubscription(account, quota(89)).ready).toBe(true);
    for (const percent of [90, 100]) expect(assessSubscription(account, quota(percent)).ready).toBe(false);
    const blocked = quota(); blocked.ordinaryUsageAllowed = false;
    expect(assessSubscription(account, blocked).reason).toBe('QUOTA_LIMIT');
    const spend = quota(); spend.rateLimitsByLimitId.codex.spendControlReached = true;
    expect(assessSubscription(account, spend).ready).toBe(false);
  });
  it('does not inherit API keys, endpoints, DB, billing or secret-bearing proxies', () => {
    expect(subscriptionEnvironment({ PATH: 'tools', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret',
      DATABASE_URL: 'secret', OPENAI_BASE_URL: 'https://other', HTTPS_PROXY: 'secret', CODEX_HOME: 'custom' })).toEqual({ PATH: 'tools' });
  });
  it('requires a verified relevant Codex window even with unrelated buckets', () => {
    const data = quota();
    const extra = { ...data.rateLimitsByLimitId, unrelated: structuredClone(data.rateLimitsByLimitId.codex) };
    expect(assessSubscription(account, { ...data, rateLimitsByLimitId: { ...extra, codex: { ...extra.codex, primary: null } } }).ready).toBe(false);
  });
  it('confirms native worker process termination before returning', async () => {
    const child = spawn('node', ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true });
    expect(await terminateProcess(child)).toBe(true);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});

class MemoryStore implements WorkflowStore {
  run: WorkflowRun = { id: randomUUID(), organizationId: randomUUID(), projectId: randomUUID(), taskId: randomUUID(), commandOriginalKo: '덧셈과 합계 오류를 수정해 주세요.', status: 'QUEUED', version: 1, leaseToken: null, leaseExpiresAt: null, checkpoint: initialCheckpoint(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  acknowledged = false;
  async claim() { if (this.run.status !== 'QUEUED') return null; this.run.status = 'RUNNING'; this.run.leaseToken = randomUUID(); return structuredClone(this.run); }
  async get() { return structuredClone(this.run); }
  async heartbeat(_id: string, token: string) { return this.run.status === 'RUNNING' && this.run.leaseToken === token; }
  async save(_id: string, token: string, change: { status?: WorkflowRun['status']; checkpoint?: Checkpoint }) {
    if (!await this.heartbeat('', token)) return false;
    Object.assign(this.run, structuredClone(change)); this.run.version++; return true;
  }
  async recover() { return 0; }
  async acknowledgeStop() { this.acknowledged = true; return true; }
}
class FixtureSandbox implements CodeSandbox {
  snapshotValue = { files: [{ path: 'src/math.mjs', content: 'broken' }], sha: 'a'.repeat(64), diff: '' };
  fail = false;
  async prepare() { return structuredClone(this.snapshotValue); }
  async snapshot() { return structuredClone(this.snapshotValue); }
  async apply(_id: string, files: { path: string; content: string }[]) {
    this.snapshotValue = { files, sha: (this.snapshotValue.sha[0] === 'b' ? 'c' : 'b').repeat(64), diff: 'actual change' }; return this.snapshot();
  }
  async verify() { return { sha: this.snapshotValue.sha, test: { exitCode: this.fail ? 1 : 0, output: this.fail ? 'failed' : 'passed' }, build: { exitCode: 0, output: 'checked' }, sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: new Date().toISOString() }; }
}
function provider(reviewPass = true): AgentProvider & { roles: string[] } {
  const roles: string[] = [];
  return { roles, status: async () => assessSubscription(account, quota()), close: async () => {}, run: async input => {
    roles.push(input.role); await input.onStarted(randomUUID(), '');
    const data = JSON.parse(input.prompt);
    const output: RoleOutput = { summaryKo: '검증 결과', specEn: input.role === 'PM' ? 'Fix arithmetic preserving exports' : '', acceptanceCriteria: [{ id: 'AC-01', description: 'Correct addition' }],
      files: input.role === 'DEVELOPER' ? [{ path: 'src/math.mjs', content: `fixed ${roles.length}` }] : [], verdict: input.role === 'QA' ? (reviewPass ? 'PASS' : 'FAIL') : 'NA', candidateSha: input.role === 'QA' ? data.candidateSha : '', issues: [] };
    return { role: input.role, threadId: randomUUID(), turnId: '', output, usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 }, candidateSha: null, completedAt: new Date().toISOString() };
  } };
}
describe('durable workflow control and evidence', () => {
  for (const result of ['PASS', 'FAIL', 'EXPIRED'] as const) it(`bounds a separately approved verification window: ${result}`, async () => {
    const store = new MemoryStore(), model = provider(), sandbox = new FixtureSandbox();
    await new WorkflowRunner(store, model, sandbox).tick();
    const originalStart = new Date(Date.now()-20*60_000).toISOString();
    store.run.fixture = 'how-to-trash-v1'; store.run.status = 'QUEUED';
    store.run.checkpoint.stage = 'VERIFY'; store.run.checkpoint.startedAt = originalStart;
    store.run.checkpoint.turns = 5; store.run.checkpoint.rework = 2;
    store.run.checkpoint.verificationWindow = { approvedAt: new Date(Date.now()-1000).toISOString(),
      deadlineAt: new Date(Date.now()+(result === 'EXPIRED' ? -1 : 290000)).toISOString(), qaAttemptsRemaining: 1, candidateSha: sandbox.snapshotValue.sha };
    model.roles.length = 0;
    if (result === 'FAIL') { const failing = provider(false); model.run = failing.run; model.roles = failing.roles; }
    await new WorkflowRunner(store, model, sandbox).tick();
    expect(store.run.checkpoint.startedAt).toBe(originalStart); expect(store.run.checkpoint.rework).toBe(2);
    expect(model.roles).toEqual(result === 'EXPIRED' ? [] : ['QA']);
    expect(store.run.status).toBe(result === 'PASS' ? 'WAITING_APPROVAL' : result === 'FAIL' ? 'FAILED' : 'BLOCKED');
    if (result !== 'EXPIRED') { expect(store.run.checkpoint.turns).toBe(6); expect(store.run.checkpoint.verificationWindow.qaAttemptsRemaining).toBe(0); }
  });
  it('routes the admitted repository and gives role-specific real-repository instructions', async () => {
    const store = new MemoryStore(), target = new FixtureSandbox(), prompts: string[] = [];
    store.run.fixture = 'how-to-trash-v1';
    const model = provider(), original = model.run;
    model.run = async input => { prompts.push(input.prompt); return original(input); };
    const fixture = new FixtureSandbox();
    const router: CodeSandbox = { ...fixture, prepare: () => { throw new Error('Wrong fixture'); },
      snapshot: fixture.snapshot.bind(fixture), apply: fixture.apply.bind(fixture), verify: fixture.verify.bind(fixture), forRun: () => target };
    await new WorkflowRunner(store, model, router).tick();
    expect(store.run.status).toBe('WAITING_APPROVAL');
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(JSON.parse(prompt).instruction).toContain('how-to-trash');
      expect(JSON.parse(prompt).instruction).not.toContain('fixes add(a,b)');
    }
  });
  it('hands PM spec to Developer, verifies exact SHA then QA, waits for owner', async () => {
    const store = new MemoryStore(), model = provider(), sandbox = new FixtureSandbox();
    await new WorkflowRunner(store, model, sandbox).tick();
    expect(model.roles).toEqual(['PM', 'DEVELOPER', 'QA']);
    expect(store.run.status).toBe('WAITING_APPROVAL');
    expect(store.run.checkpoint.roles.at(-1)?.candidateSha).toBe(store.run.checkpoint.verification?.sha);
    expect(store.run.checkpoint.usage).toEqual({ inputTokens: 30, cachedInputTokens: 0, outputTokens: 15 });
  });
  it('bounds QA rework to two revisions / three candidates / seven calls', async () => {
    const store = new MemoryStore(), model = provider(false);
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.run.status).toBe('FAILED'); expect(store.run.checkpoint.rework).toBe(2);
    expect(model.roles).toEqual(['PM', 'DEVELOPER', 'QA', 'DEVELOPER', 'QA', 'DEVELOPER', 'QA']);
  });
  it('failed tests never reach QA and bounded retry terminates', async () => {
    const store = new MemoryStore(), model = provider(), sandbox = new FixtureSandbox(); sandbox.fail = true;
    await new WorkflowRunner(store, model, sandbox).tick();
    expect(store.run.status).toBe('FAILED'); expect(model.roles).toEqual(['PM', 'DEVELOPER', 'DEVELOPER', 'DEVELOPER']);
  });
  it('quota denial blocks without fallback or automatic retries', async () => {
    const store = new MemoryStore(), model = provider(); let attempts = 0;
    model.run = async () => { attempts++; throw new ExecutionBlocked('QUOTA_LIMIT'); };
    const runner = new WorkflowRunner(store, model, new FixtureSandbox()); await runner.tick(); await runner.tick();
    expect(store.run.status).toBe('BLOCKED'); expect(store.run.checkpoint.stopReason).toBe('QUOTA_LIMIT'); expect(attempts).toBe(1);
  });
  it('fenced pause aborts active role and acknowledges only after execution stopped', async () => {
    const store = new MemoryStore(), model = provider();
    model.run = async input => { await input.onStarted(randomUUID(), ''); store.run.status = 'PAUSED';
      return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new ExecutionBlocked('INTERRUPTED')), { once: true })); };
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.run.status).toBe('PAUSED'); expect(store.acknowledged).toBe(true); expect(store.run.checkpoint.roles).toHaveLength(0);
  });
  it('tampered workspace blocks before any new model call', async () => {
    const store = new MemoryStore(), model = provider(); store.run.checkpoint.workspace = { files: [], sha: 'd'.repeat(64), diff: '' };
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.run.checkpoint.stopReason).toBe('WORKSPACE_CHANGED'); expect(model.roles).toHaveLength(0);
  });
  it('resumes an existing verified workspace without preparing it twice', async () => {
    const store = new MemoryStore(), model = provider(), sandbox = new FixtureSandbox();
    store.run.checkpoint.workspace = await sandbox.snapshot();
    sandbox.prepare = async () => { throw new Error('Workspace already exists'); };
    await new WorkflowRunner(store, model, sandbox).tick();
    expect(store.run.status).toBe('WAITING_APPROVAL');
  });
  it('preserves consumed usage when a completed PM contract is rejected', async () => {
    const store = new MemoryStore(), model = provider();
    const original = model.run;
    model.run = async input => { const value = await original(input); value.output.specEn = ''; return value; };
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.run.status).toBe('BLOCKED'); expect(store.run.checkpoint.usage.inputTokens).toBe(10);
    expect(store.run.checkpoint.stopReason).toBe('PM_CONTRACT_INVALID');
  });
  it('does not acknowledge a paused provider whose stop cannot be confirmed', async () => {
    const store = new MemoryStore(), model = provider();
    model.run = async input => { await input.onStarted('real-thread-id', null); store.run.status = 'PAUSED';
      return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new ExecutionBlocked('STOP_UNVERIFIABLE')), { once: true })); };
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.acknowledged).toBe(false); expect(store.run.checkpoint.activeThreadId).toBe('real-thread-id');
  });
  it('acknowledges a confirmed fast pause before the periodic heartbeat can fire', async () => {
    const store = new MemoryStore(), model = provider(); const original = model.run;
    model.run = async input => { const value = await original(input); store.run.status = 'PAUSED'; return value; };
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.run.status).toBe('PAUSED'); expect(store.acknowledged).toBe(true);
  });
  it('an exceeded elapsed budget cannot reach approval', async () => {
    const store = new MemoryStore(), model = provider();
    store.run.checkpoint.startedAt = new Date(Date.now() - 15 * 60_000 - 1).toISOString();
    await new WorkflowRunner(store, model, new FixtureSandbox()).tick();
    expect(store.run.status).toBe('BLOCKED'); expect(store.run.checkpoint.stopReason).toBe('RUN_TIME_LIMIT');
    expect(model.roles).toHaveLength(0);
  });
});

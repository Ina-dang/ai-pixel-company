import type { StaffingProfile } from '@ai-pixel/agents';
import type { Transaction } from '@ai-pixel/db';
import { z } from 'zod';
import { ApiError, canonical, digest } from './security.js';
import type { WorkflowRow } from './workflows.js';

export const reviewTypes = ['AUTO','SELF','PEER','PM','USER'] as const;
export const rubric = { version: 1, weights: { accuracy: 0.3, quality: 0.3, collaboration: 0.2, efficiency: 0.2 }, minimumAggregateSamples: 3 } as const;
const point = z.number().int().min(0).max(100).nullable();
export const reviewScores = z.strictObject({ accuracy: point, quality: point, collaboration: point, efficiency: point });
export type ReviewScores = z.infer<typeof reviewScores>;
export function reviewTotal(scores: ReviewScores | null) {
  if (!scores || Object.values(scores).some(value => value === null)) return null;
  return Math.round(Object.entries(rubric.weights).reduce((sum, [key, weight]) => sum + (scores[key as keyof ReviewScores] ?? 0) * weight, 0) * 100) / 100;
}
export async function reviewEvidence(tx: Transaction, org: string, project: string, runId: string, subjectId: string) {
  const rows = await tx<WorkflowRow[]>`select * from workflow_runs where organization_id=${org} and project_id=${project} and id=${runId}`;
  const run = rows[0]; if (!run) throw new ApiError(404, 'REVIEW_SCOPE_DENIED', '평가 대상 실행을 찾을 수 없습니다.');
  const tasks = await tx`select id,status,title,command_hash from tasks where organization_id=${org} and project_id=${project} and id=${run.task_id}`;
  const snapshots = await tx<{ profile: StaffingProfile }[]>`select profile from workflow_staffing_snapshots where organization_id=${org} and run_id=${runId} order by role`;
  const subject = snapshots.map(row => row.profile).find(profile => profile.employeeId === subjectId);
  if (!subject || !tasks[0]) throw new ApiError(409, 'REVIEW_SUBJECT_UNVERIFIABLE', '해당 실행에 고정된 직원 근거가 없습니다.');
  const roles = run.checkpoint.roles.filter(role => role.role === subject.role), lastRole = roles.at(-1), verification = run.checkpoint.verification;
  const evidence = {
    runId, runVersion: run.version, runStatus: run.status, taskId: run.task_id, taskStatus: tasks[0].status as string, commandHash: tasks[0].command_hash as string,
    candidateSha: run.checkpoint.workspace?.sha ?? null,
    subject: { employeeId: subjectId, nameKo: subject.nameKo, profileVersion: subject.profileVersion, role: subject.role, model: subject.model, provider: subject.provider },
    staff: snapshots.map(row => ({ employeeId: row.profile.employeeId, profileVersion: row.profile.profileVersion, role: row.profile.role, provider: row.profile.provider, model: row.profile.model })),
    roleEvidence: run.checkpoint.roles.map(role => ({ role: role.role, evidenceHash: digest(canonical(role)), completedAt: role.completedAt, candidateSha: role.candidateSha })),
    verification: verification ? { sha: verification.sha, testExit: verification.test.exitCode, buildExit: verification.build.exitCode, sandbox: verification.sandbox, verifiedAt: verification.verifiedAt } : null,
  };
  const tokens = roles.length ? roles.reduce((sum, role) => sum + role.usage.inputTokens + role.usage.outputTokens, 0) : null;
  const elapsed = run.checkpoint.startedAt && lastRole ? Date.parse(lastRole.completedAt) - Date.parse(run.checkpoint.startedAt) : null;
  const metrics = { completedResponseTokens: tokens, cachedInputTokens: roles.length ? roles.reduce((sum, role) => sum + role.usage.cachedInputTokens, 0) : null,
    roleCalls: roles.length, rework: run.checkpoint.rework, elapsedMs: elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
    testPass: verification ? verification.test.exitCode === 0 : null, buildPass: verification ? verification.build.exitCode === 0 : null,
    qaVerdict: run.checkpoint.roles.filter(role => role.role === 'QA').at(-1)?.output.verdict ?? null,
    ownerAccepted: run.status === 'SUCCEEDED', taskFailed: run.status === 'FAILED', taskCancelled: run.status === 'CANCELLED',
    estimatedCost: null, actualCost: null, currency: null, usageBasis: 'COMPLETED_RESPONSES_ONLY' };
  const refs = [`run:${runId}:v${run.version}`, ...evidence.roleEvidence.map(role => `role:${role.role}:${role.evidenceHash}`), ...(verification ? [`verification:${verification.sha}`] : [])];
  const verifiable = !!lastRole && !!evidence.candidateSha && verification?.sha === evidence.candidateSha && Object.values(verification.sandbox).every(Boolean);
  const terminal = ['SUCCEEDED','FAILED','CANCELLED'].includes(run.status);
  return { evidence, hash: digest(canonical(evidence)), metrics, refs, verifiable, terminal, subject, profiles: snapshots.map(row => row.profile) };
}
export type ReviewEvidence = Awaited<ReturnType<typeof reviewEvidence>>;

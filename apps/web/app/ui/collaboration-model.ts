import type { Task } from './api';

export type StaffRole = 'PM' | 'DEVELOPER' | 'QA';
export type EmploymentStatus = 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
export type ProfileLimits = { maxTurns: number; maxTokens: number; maxElapsedMs: number };
export type StaffTemplate = { role: StaffRole; nameKo: string; tools: string[]; provider: 'CHATGPT_SUBSCRIPTION'; model: string; limits: ProfileLimits; avatar: string };
export type StaffProfile = { employeeId: string; role: StaffRole; nameKo: string; profileVersion: number; provider: string; model: string;
  rolePrompt: string; skills: string[]; departmentKo: string; workStyleKo: string; tools: string[]; limits: ProfileLimits; avatar: string };
export type Employee = { id: string; organizationId: string; nameKo: string; role: StaffRole; employmentStatus: EmploymentStatus; version: number;
  currentProfileVersion: number; profile: StaffProfile; createdAt: string; updatedAt: string;
  profiles?: StaffProfile[]; employmentHistory?: { id: string; fromStatus: string | null; toStatus: string; createdAt: string }[] };
export type StaffAssignment = { role: StaffRole; employeeId: string; employeeNameKo: string; profileVersion: number; version: number; employmentStatus: EmploymentStatus };
export type IntegrationConnection = { id: string | null; provider: 'GITHUB' | 'SLACK'; configured: boolean; webhookConfigured?: boolean; enabled: boolean; version: number; publicConfig: Record<string, unknown> | null; reason: string | null;
  receiver?: { state: 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'STOPPED' | 'ERROR'; connectedAt: string | null; lastReceivedAt: string | null; reconnects: number; errorCode: string | null } | null };
export type IntegrationOperation = { id: string; provider: 'GITHUB' | 'SLACK'; kind: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'DEFERRED';
  runId: string | null; candidateSha: string | null; errorCode: string | null; externalRef: unknown; attempts: number; createdAt: string; updatedAt: string };
export type MergeRequest = { id: string; operationId: string; runId: string; scopeHash: string; version: number; status: string; expiresAt: string; approvedBy: string | null; approvedAt: string | null; errorCode: string | null; result: unknown;
  scope: { installationId: number; repositoryId: number; base: string; branch: string; headSha: string; baseSha: string; candidateSha: string; runVersion: number; pullNumber: number; mergeMethod: string; policyVersion: string; requiredChecks: string[]; remote: { draft: boolean; protected: boolean; protectionHash: string; mergeable: boolean; mergeableState: string; ci: { status: string } } } };
export type SlackCommandReceipt = { id: string; eventType: string; status: string; errorCode: string | null; result: { text: string; taskId?: string } | null; replyStatus: string; createdAt: string };
export type Integrations = { connections: IntegrationConnection[]; operations: IntegrationOperation[]; mergeRequests?: MergeRequest[]; commands?: SlackCommandReceipt[]; setup: { githubEnv: string[]; slackEnv: string[] } };

export const staffRoles: StaffRole[] = ['PM', 'DEVELOPER', 'QA'];
export const roleNames: Record<StaffRole, string> = { PM: 'PM', DEVELOPER: 'Developer', QA: 'QA' };
export const toolNames: Record<string, string> = { PLAN: '계획 작성', EDIT_FILES: '코드 파일 수정', VERIFY: '샌드박스 검증', REVIEW: 'QA 검토' };
export const employmentNames: Record<EmploymentStatus, string> = { ACTIVE: '재직', SUSPENDED: '일시 중지', RETIRED: '퇴사' };
export const operationNames: Record<string, string> = { ISSUE_CREATE: 'Issue 생성', BRANCH_CREATE: '작업 브랜치 생성', PUSH_CANDIDATE: '검증된 후보 push', DRAFT_PR_CREATE: '초안 PR 생성', CI_REFRESH: 'CI 상태 확인', MERGE_REQUEST: 'merge 승인 요청 기록', SLACK_REPORT: '한국어 결과 보고' };
export const operationStatusNames: Record<IntegrationOperation['status'], string> = { PENDING: '대기', RUNNING: '처리 중', SUCCEEDED: '확인된 성공', FAILED: '실패', UNKNOWN: '원격 결과 확인 필요', DEFERRED: '재시도 대기' };
export const kanbanLanes = [
  { id: 'ready', title: '대기·계획', statuses: ['TODO', 'PLANNING'] },
  { id: 'working', title: '진행 중', statuses: ['IN_PROGRESS'] },
  { id: 'review', title: '검토·승인', statuses: ['REVIEW', 'APPROVAL_REQUIRED'] },
  { id: 'closed', title: '종료', statuses: ['COMPLETED', 'FAILED', 'CANCELLED'] },
];
export function laneTasks(tasks: Task[], statuses: string[]) { return tasks.filter(task => statuses.includes(task.status)); }
export function listInput(value: string): string[] { return [...new Set(value.split(/[,\n]/).map(item => item.trim()).filter(Boolean))]; }
export function validLimits(limits: ProfileLimits, maximum: ProfileLimits): boolean {
  return limits.maxTokens >= 1000 && limits.maxElapsedMs >= 1000 && (Object.keys(limits) as (keyof ProfileLimits)[]).every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= maximum[key]);
}
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && ['github.com', 'app.slack.com'].includes(url.hostname) ? url.href : null; }
  catch { return null; }
}

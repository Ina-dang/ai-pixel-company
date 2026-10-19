export type Role = 'PM' | 'DEVELOPER' | 'QA';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'WAITING_APPROVAL' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type Stage = 'PM' | 'DEVELOPER' | 'VERIFY' | 'QA';
export type StaffingTool = 'PLAN' | 'EDIT_FILES' | 'VERIFY' | 'REVIEW';
export interface StaffingProfile {
  employeeId: string; role: Role; nameKo: string; profileVersion: number;
  provider: 'CHATGPT_SUBSCRIPTION'; model: 'codex-default'; rolePrompt: string; skills: string[];
  departmentKo: string; workStyleKo: string; tools: StaffingTool[];
  limits: { maxTurns: number; maxTokens: number; maxElapsedMs: number }; avatar: 'pm' | 'developer' | 'qa';
}
export interface FileContent { path: string; content: string }
export interface Workspace { files: FileContent[]; sha: string; diff: string }
export interface Verification {
  sha: string;
  test: { command?: string[]; exitCode: number; output: string };
  build: { command?: string[]; exitCode: number; output: string };
  sandbox: { networkDisabled: boolean; readOnlyRoot: boolean; resourceLimited: boolean };
  verifiedAt: string;
}
export interface RoleOutput {
  summaryKo: string;
  specEn: string;
  acceptanceCriteria: { id: string; description: string }[];
  files: FileContent[];
  verdict: 'PASS' | 'FAIL' | 'NA';
  candidateSha: string;
  issues: string[];
}
export interface Usage { inputTokens: number; cachedInputTokens: number; outputTokens: number }
export interface RoleEvidence { role: Role; threadId: string; turnId: string | null; output: RoleOutput; usage: Usage; candidateSha: string | null; completedAt: string }
export interface Checkpoint {
  stage: Stage;
  rework: number;
  turns: number;
  usage: Usage;
  roles: RoleEvidence[];
  workspace: Workspace | null;
  verification: Verification | null;
  activeThreadId: string | null;
  activeTurnId: string | null;
  startedAt: string | null;
  stopReason: string | null;
}
export interface WorkflowRun {
  id: string; organizationId: string; projectId: string; taskId: string;
  commandOriginalKo: string; status: RunStatus; version: number;
  leaseToken: string | null; leaseExpiresAt: string | null;
  checkpoint: Checkpoint; createdAt: string; updatedAt: string;
  staffing?: StaffingProfile[];
}
export interface WorkflowStore {
  claim(): Promise<WorkflowRun | null>;
  get(id: string): Promise<WorkflowRun | null>;
  save(id: string, leaseToken: string, change: { status?: RunStatus; checkpoint?: Checkpoint }): Promise<boolean>;
  heartbeat(id: string, leaseToken: string): Promise<boolean>;
  recover(): Promise<number>;
  acknowledgeStop(id: string, leaseToken: string): Promise<boolean>;
  authorizeRole?(id: string, role: Role, tools: StaffingTool[]): Promise<StaffingProfile>;
}
export interface SubscriptionState {
  ready: boolean;
  reason: string | null;
  authMode: 'chatgpt' | 'unknown';
  billingMode: 'CHATGPT_SUBSCRIPTION';
  windows: { usedPercent: number; resetsAt: number | null; windowDurationMins: number | null }[];
  checkedAt: string;
}
export interface AgentProvider {
  status(): Promise<SubscriptionState>;
  run(input: { role: Role; prompt: string; signal: AbortSignal; onStarted: (threadId: string, turnId: string | null) => Promise<void> }): Promise<RoleEvidence>;
  close(): Promise<void>;
}
export interface CodeSandbox {
  prepare(runId: string): Promise<Workspace>;
  apply(runId: string, files: FileContent[]): Promise<Workspace>;
  snapshot(runId: string): Promise<Workspace>;
  verify(runId: string, signal?: AbortSignal): Promise<Verification>;
}
export class ExecutionBlocked extends Error {
  constructor(public readonly reason: string) { super(reason); }
}
export const initialCheckpoint = (): Checkpoint => ({ stage: 'PM', rework: 0, turns: 0,
  usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, roles: [], workspace: null,
  verification: null, activeThreadId: null, activeTurnId: null, startedAt: null, stopReason: null });

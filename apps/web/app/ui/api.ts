import type { OfficeAgent } from '@ai-pixel/contracts';

export type Session = {
  user: { id: string; displayName: string };
  organization: { id: string; name: string };
  csrfToken: string;
};

export type Project = {
  id: string;
  name: string;
  repositoryUrl: string;
  defaultBranch: string;
  version: number;
};

export type Criterion = {
  id: string;
  descriptionKo: string;
  method: string;
  required: boolean;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  commandOriginalKo: string;
  status: string;
  statusLabelKo: string;
  priority: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  acceptanceCriteria: Criterion[];
};

export type CompanyEvent = {
  eventId: string;
  type: string;
  sequence: string;
  timestamp: string;
  payload: Record<string, unknown>;
  projectId?: string | null;
  aggregateVersion?: number;
};

export type Snapshot = {
  projectId: string;
  cursor: string;
  tasks: Task[];
  agents: OfficeAgent[];
  approvals: unknown[];
  syncedAt?: string;
};

export type TaskDetail = Task & { events: CompanyEvent[] };

export type SubscriptionState = {
  ready: boolean;
  reason: string | null;
  authMode: "chatgpt" | "unknown";
  billingMode: "CHATGPT_SUBSCRIPTION";
  windows: { usedPercent: number; resetsAt: number | null; windowDurationMins: number | null }[];
  checkedAt: string;
};

export type RoleEvidence = {
  role: "PM" | "DEVELOPER" | "QA";
  threadId: string;
  turnId: string | null;
  candidateSha: string | null;
  completedAt: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  output: {
    summaryKo: string;
    specEn: string;
    acceptanceCriteria: { id: string; description: string }[];
    files: { path: string; content: string }[];
    verdict: "PASS" | "FAIL" | "NA";
    candidateSha: string;
    issues: string[];
  };
};

export type WorkflowRun = {
  id: string;
  taskId: string;
  status: "QUEUED" | "RUNNING" | "PAUSED" | "BLOCKED" | "WAITING_APPROVAL" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  version: number;
  createdAt: string;
  updatedAt: string;
  checkpoint: {
    stage: "PM" | "DEVELOPER" | "VERIFY" | "QA";
    rework: number;
    turns: number;
    stopReason: string | null;
    activeTurnId: string | null;
    activeThreadId: string | null;
    usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
    roles: RoleEvidence[];
    workspace: { files: { path: string; content: string }[]; sha: string; diff: string } | null;
    verification: {
      sha: string;
      test: { exitCode: number; output: string };
      build: { exitCode: number; output: string };
      sandbox: { networkDisabled: boolean; readOnlyRoot: boolean; resourceLimited: boolean };
      verifiedAt: string;
    } | null;
  };
  stopping?: boolean;
  resumable?: boolean;
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public requestId?: string) {
    super(message);
  }
}

type ApiResponse<T> = { data: T; pagination?: { nextCursor: string | null } };

async function apiResponse<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<ApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "서버에 연결할 수 없습니다. API 서버와 네트워크를 확인해 주세요.");
  }
  const body = await response.json().catch(() => null) as {
    data?: T;
    pagination?: { nextCursor: string | null };
    error?: { messageKo?: string };
    requestId?: string;
  } | null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.error?.messageKo ?? "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", body?.requestId);
  }
  if (response.status === 204) return { data: undefined as T };
  if (!body || !("data" in body)) throw new ApiError(response.status, "서버 응답 형식을 확인할 수 없습니다.");
  return { data: body.data as T, pagination: body.pagination };
}

export async function api<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<T> {
  return (await apiResponse<T>(path, options, csrfToken)).data;
}

export async function allProjects(signal?: AbortSignal): Promise<Project[]> {
  const projects: Project[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await apiResponse<Project[]>(`/projects?${query}`, { signal });
    if (!Array.isArray(page.data)) throw new ApiError(200, "프로젝트 목록 응답 형식을 확인할 수 없습니다.");
    projects.push(...page.data);
    const next = page.pagination?.nextCursor;
    if (next === null) return projects;
    if (typeof next !== "string" || !next || page.data.length === 0 || seenCursors.has(next)) {
      throw new ApiError(200, "프로젝트 목록의 페이지 정보를 확인할 수 없습니다. 다시 시도해 주세요.");
    }
    seenCursors.add(next);
    cursor = next;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message + (error.requestId ? ` (요청 ID: ${error.requestId})` : "");
  return "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

export function formatTime(value?: string): string {
  if (!value) return "시간 정보 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

export const eventLabels: Record<string, string> = {
  "project.created": "프로젝트 생성",
  "task.created": "업무 등록",
  "task.updated": "업무 수정",
  "task.status.changed": "업무 상태 변경",
  "workflow.run.created": "AI 실행 등록",
  "workflow.run.updated": "AI 실행 상태 변경",
  "agent.completed": "직원 작업 결과 기록",
  "approval.requested": "결과 수락 요청",
  "approval.resolved": "결과 수락 처리",
};

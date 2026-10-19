import { officeAgentSchema, sequenceSchema, type OfficeAgent } from '@ai-pixel/contracts';
import type { CompanyEvent, Snapshot } from './api';

export const officeRoles = ['PM', 'DEVELOPER', 'QA'] as const;
export const roleNames = { PM: 'PM', DEVELOPER: 'Developer', QA: 'QA' } as const;
export const stateNames = { IDLE: '대기 중', RUNNING: '작업 중', WAITING: '응답 대기', REVIEWING: '검토 중', BLOCKED: '진행 불가', ERROR: '오류 발생' } as const;
export const locationNames = { pmDesk: '기획 데스크', developerDesk: '개발 데스크', qaDesk: 'QA 검토실', owner: '대표실', lounge: '공용 공간', meeting: '회의실' } as const;

export function validOfficeAgents(input: unknown): OfficeAgent[] {
  if (!Array.isArray(input) || input.length !== 3) return [];
  const parsed = input.map(agent => officeAgentSchema.safeParse(agent));
  if (parsed.some(agent => !agent.success)) return [];
  const agents = parsed.flatMap(agent => agent.success ? [agent.data] : []);
  if (new Set(agents.map(agent => agent.id)).size !== 3 || agents.some(agent => agent.id !== agent.role)) return [];
  return officeRoles.flatMap(role => agents.filter(agent => agent.id === role));
}

// Events only invalidate a snapshot. Neither animation nor an event payload is
// allowed to decide the authoritative employee/task/run state.
export function chooseSnapshot(current: Snapshot | null, incoming: Snapshot, projectId: string, reset = false): Snapshot | null {
  if (incoming.projectId !== projectId || !sequenceSchema.safeParse(incoming.cursor).success
    || !Array.isArray(incoming.tasks) || !Array.isArray(incoming.agents) || !Array.isArray(incoming.approvals)) return current;
  if (!current || current.projectId !== projectId || reset) return incoming;
  if (BigInt(incoming.cursor) <= BigInt(current.cursor)) return current;
  const before = validOfficeAgents(current.agents);
  const after = validOfficeAgents(incoming.agents);
  if (after.some(agent => before.some(previous => previous.id === agent.id && previous.runId === agent.runId && agent.runId !== null && previous.version > agent.version))) return current;
  return incoming;
}

export class ProjectEventGate {
  private seen = new Set<string>();
  constructor(private projectId: string, public cursor: string) {}
  advance(cursor: string) {
    if (sequenceSchema.safeParse(cursor).success && BigInt(cursor) > BigInt(this.cursor)) this.cursor = cursor;
  }
  reset(cursor: string) { this.seen.clear(); this.cursor = sequenceSchema.safeParse(cursor).success ? cursor : '0'; }
  receive(event: CompanyEvent): boolean {
    if (event.projectId !== undefined && event.projectId !== this.projectId) return false;
    if (!event.eventId || this.seen.has(event.eventId) || !sequenceSchema.safeParse(event.sequence).success || BigInt(event.sequence) <= BigInt(this.cursor)) return false;
    this.seen.add(event.eventId);
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value as string);
    this.cursor = event.sequence;
    return true;
  }
}

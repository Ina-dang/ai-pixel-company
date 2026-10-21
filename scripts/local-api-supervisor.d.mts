export class StartupError extends Error { code: string; constructor(code: string); }
export function redactLog(text: string): string;
export function sameProcessOwner(saved: unknown, observed: unknown): boolean;
export function webBuildReady(buildId: unknown, routes: unknown): boolean;
export function workspaceState(services: { api: Record<string, unknown>; web: Record<string, unknown> }): {
  state: string; apiPid: unknown; webPid: unknown; attempt: unknown; services: { api: Record<string, unknown>; web: Record<string, unknown> };
};
export function waitUntil(check: () => boolean | Promise<boolean>, options: {
  timeoutMs: number; intervalMs?: number; stopped?: () => boolean; sleep?: (ms: number) => Promise<unknown>; now?: () => number;
}): Promise<boolean>;
export type SupervisedChild = {
  pid: number | undefined; ready(stopped: () => boolean): Promise<boolean>; exited(): boolean; stop(): Promise<void>;
};
export function supervise(options: {
  prepare(): Promise<void>; launch(): Promise<SupervisedChild>; stopped(): boolean;
  record(state: Record<string, unknown>): void; sleep?: (ms: number) => Promise<unknown>; maxRestarts?: number; service?: 'API' | 'WEB';
}): Promise<number>;

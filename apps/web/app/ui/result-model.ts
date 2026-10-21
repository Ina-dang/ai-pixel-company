import type { Project, WorkflowRun } from './api';

export const verificationName = (project: Project) => /검증|시험/.test(project.name);

export function dashboardLink(projectId: string, taskId?: string) {
  const query = new URLSearchParams({ project: projectId });
  if (taskId) query.set('task', taskId);
  return `/?${query}#task-inspector`;
}

export function repositoryLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`;
  } catch { return null; }
}

export function deliveryLinks(run: WorkflowRun) {
  const delivery = run.checkpoint.delivery;
  if (!delivery || delivery.candidateSha !== run.checkpoint.workspace?.sha || delivery.repositoryUrl !== run.repositorySource?.repositoryUrl) return null;
  const repository = repositoryLink(delivery.repositoryUrl);
  if (!repository || !/^[a-f0-9]{40}$/.test(delivery.commitSha) || !/^codex\/[\w./-]+$/.test(delivery.branch) || delivery.branch.includes('..')) return null;
  return { commit: `${repository}/commit/${delivery.commitSha}`, branch: `${repository}/tree/${delivery.branch.split('/').map(encodeURIComponent).join('/')}`, delivery };
}

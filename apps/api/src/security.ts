import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '@ai-pixel/db';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ApiConfig = {
  appOrigin: string;
  bootstrapSecretHash: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
  ssePollMs: number;
  sseHeartbeatMs: number;
  sseBatchSize: number;
  sseRetentionDays: number;
  loginMaxAttempts: number;
  loginWindowMs: number;
};
export type Auth = {
  sessionId: string;
  userId: string;
  organizationId: string;
  displayName: string;
  organizationName: string;
  csrfHash: string;
};
export type ApiEnv = { Variables: { auth: Auth; requestId: string } };

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    public messageKo: string,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function equals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticate(database: Database, token: string | undefined): Promise<Auth | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await database.sql<Auth[]>`
    select s.id as "sessionId", s.user_id as "userId", s.organization_id as "organizationId",
      u.display_name as "displayName", o.name as "organizationName", s.csrf_hash as "csrfHash"
    from sessions s join users u on u.id = s.user_id
      join organizations o on o.id = s.organization_id
      join memberships m on m.organization_id = s.organization_id and m.user_id = s.user_id
    where s.token_hash = ${digest(token)} and s.expires_at > now() and s.revoked_at is null
      and o.status = 'ACTIVE' and m.status = 'ACTIVE' and m.role = 'OWNER'
    limit 1`;
  return rows[0] ?? null;
}

export function checkOrigin(c: Context<ApiEnv>, config: ApiConfig) {
  if (c.req.header('Origin') !== config.appOrigin) {
    throw new ApiError(403, 'FORBIDDEN', '요청 출처를 확인할 수 없습니다.');
  }
}

export function csrfToken(c: Context<ApiEnv>) {
  const cookie = getCookie(c, 'pixel_csrf');
  if (!cookie || !equals(digest(cookie), c.get('auth').csrfHash)) {
    throw new ApiError(403, 'FORBIDDEN', '보안 토큰을 확인할 수 없습니다. 다시 로그인하세요.');
  }
  return cookie;
}

export function checkCsrf(c: Context<ApiEnv>) {
  const token = csrfToken(c);
  if (!equals(c.req.header('X-CSRF-Token') ?? '', token)) {
    throw new ApiError(403, 'FORBIDDEN', '보안 토큰이 일치하지 않습니다.');
  }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

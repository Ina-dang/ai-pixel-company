import { readFileSync } from 'node:fs';

export function loadRuntime() {
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(readFileSync(new URL('../.local/runtime.json', import.meta.url), 'utf8'));
  } catch {
    // Environment-only configuration is supported; required values are checked below.
  }
  const databaseUrl = process.env.DATABASE_URL ?? saved.databaseUrl;
  const bootstrapSecretHash = process.env.OWNER_BOOTSTRAP_HASH ?? saved.bootstrapSecretHash;
  const appOrigin = process.env.APP_ORIGIN ?? saved.appOrigin ?? 'http://127.0.0.1:3000';
  if (!databaseUrl || !bootstrapSecretHash) {
    throw new Error('로컬 설정이 없습니다. pnpm setup:local을 실행하거나 환경 변수를 설정하세요.');
  }
  const origin = new URL(appOrigin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
    throw new Error('Phase 0은 loopback 로컬 환경만 지원합니다.');
  }
  return { databaseUrl, bootstrapSecretHash, appOrigin: origin.origin };
}

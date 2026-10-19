import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { hash } from '@node-rs/argon2';

await mkdir('.local', { recursive: true });
if (existsSync('.local/runtime.json')) {
  console.log('기존 로컬 설정을 유지했습니다. Owner 키: .local/owner-key');
} else {
  const password = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const runtime = {
    databaseUrl: `postgres://pixel:${password}@127.0.0.1:55432/pixel_company`,
    bootstrapSecretHash: await hash(secret),
    appOrigin: 'http://127.0.0.1:3000',
  };
  await writeFile('.local/runtime.json', JSON.stringify(runtime, null, 2), { mode: 0o600, flag: 'wx' });
  await writeFile('.local/owner-key', secret, { mode: 0o600, flag: 'wx' });
  await writeFile('.local/compose.env', `POSTGRES_PASSWORD=${password}\n`, { mode: 0o600, flag: 'wx' });
  console.log('로컬 설정을 생성했습니다. Owner 키는 .local/owner-key 파일에서 확인하세요.');
}

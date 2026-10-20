import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@ai-pixel/db';
import { hash } from '@node-rs/argon2';
import { createApp } from '../../apps/api/src/app.js';
import { VoiceService } from '../../apps/api/src/voice.js';
import { LocalWhisper } from '../../apps/api/src/voice-provider.js';

// Launched only by the isolated crash test; never accepts a source database.
const root = process.env.VOICE_CRASH_ROOT ?? '', url = process.env.VOICE_CRASH_DATABASE ?? '';
if (!/^pixel_voice_recovery_test_[a-f0-9]{12}$/.test(new URL(url).pathname.slice(1))
  || !path.basename(root).startsWith('voice-crash-test-')) throw new Error('FIXTURE_SCOPE_INVALID');
const db = createDatabase(url), origin = 'http://127.0.0.1:3000';
const provider = new LocalWhisper(root, (id, pid) => { process.send?.({ type: 'native', id, pid }); });
if (process.env.VOICE_CRASH_MODE === 'controlled-native') {
  // A clearly labeled long-running native fixture proves orphan termination.
  Object.assign(provider, { checked: true, executable: path.join(root, '.local/voice-runtime/bin/Release/whisper-cli.exe') });
}
const voice = new VoiceService(db, root, provider);
const app = createApp({ database: db, voice, config: {
  appOrigin: origin, bootstrapSecretHash: await hash('public-crash-fixture'), sessionTtlSeconds: 3600,
  cookieSecure: false, ssePollMs: 10, sseHeartbeatMs: 20, sseBatchSize: 1000, sseRetentionDays: 30,
  loginMaxAttempts: 10, loginWindowMs: 60000,
} });
try {
  await voice.start();
  const login = await app.request('http://127.0.0.1:3001/api/v1/auth/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'public-crash-fixture' }) });
  if (login.status !== 200) throw new Error('FIXTURE_LOGIN_FAILED');
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const csrf = (await login.json()).data.csrfToken;
  const headers = { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' };
  const project = await app.request('http://127.0.0.1:3001/api/v1/projects', { method: 'POST', headers, body: JSON.stringify({ name: '강제 종료 격리 시험', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company-integration-tests.git', defaultBranch: 'fixture-base' }) });
  if (project.status !== 201) throw new Error('FIXTURE_PROJECT_FAILED');
  const projectId = (await project.json()).data.id;
  // Public synthetic silence tests cleanup, not Korean recognition or a microphone.
  const wav = Buffer.alloc(960044);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const admission = await app.request(`http://127.0.0.1:3001/api/v1/projects/${projectId}/voice/candidates`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID(), 'Content-Type': 'audio/wav', 'X-Voice-Consent': 'local-transcription-v1', 'X-Voice-Input': 'FILE' }, body: wav });
  if (admission.status !== 202) throw new Error('FIXTURE_ADMISSION_FAILED');
  process.send?.({ type: 'admitted', id: (await admission.json()).data.id });
} catch {
  process.send?.({ type: 'failed' });
  await voice.stop(); await db.close(); process.exit(1);
}

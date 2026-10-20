import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const voiceFixtureText = '로그인 화면의 제목을 수정해 주세요.';
/** Generates public test words with an installed offline Windows voice. No microphone or cloud TTS. */
export async function createVoiceFixture(root: string) {
  const directory = path.join(root, '.local/voice-fixtures');
  await mkdir(directory, { recursive: true });
  const raw = path.join(directory, 'synthesized-raw.wav'), output = path.join(directory, 'korean-test.wav');
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $voiceFixtureSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $voiceFixtureSynth.SelectVoice('Microsoft Heami Desktop'); $voiceFixtureFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono); $voiceFixtureSynth.SetOutputToWaveFile(${quote(raw)},$voiceFixtureFormat); $voiceFixtureSynth.Speak(${quote(voiceFixtureText)}); $voiceFixtureSynth.Dispose()`], { windowsHide: true, timeout: 30_000, stdio: 'pipe' });
  const source = await readFile(raw); let pcm: Buffer | undefined;
  for (let i = 12; i + 8 <= source.length;) { const length = source.readUInt32LE(i + 4); if (source.toString('ascii', i, i + 4) === 'data') { pcm = source.subarray(i + 8, i + 8 + length); break; } i += 8 + length + length % 2; }
  if (!pcm?.length) throw new Error('VOICE_FIXTURE_INVALID');
  const result = Buffer.alloc(44 + pcm.length);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8); result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22); result.writeUInt32LE(16000, 24); result.writeUInt32LE(32000, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(pcm.length, 40); pcm.copy(result, 44);
  await writeFile(output, result); await rm(raw);
  return { file: output, wav: result, expected: voiceFixtureText };
}

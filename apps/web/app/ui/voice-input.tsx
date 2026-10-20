"use client";

import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type Session } from './api';

export type VoiceCandidate = { id: string; version: number; status: string; transcript: string | null; errorCode: string | null };
type Readiness = { ready: boolean; busy: boolean; usedToday: number; limits: { daily: number }; provider: string };
async function encodeWave(blob: Blob) {
  const context = new AudioContext();
  try {
    const input = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.floor(input.duration * 16000);
    if (frames > 480_000) throw new Error('VOICE_DURATION_LIMIT');
    if (frames < 4000) throw new Error('VOICE_TOO_SHORT');
    const renderer = new OfflineAudioContext(1, frames, 16000), source = renderer.createBufferSource();
    source.buffer = input; source.connect(renderer.destination); source.start();
    const audio = (await renderer.startRendering()).getChannelData(0), buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) { const sample = Math.max(-1, Math.min(1, audio[i])); view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true); }
    return buffer;
  } finally { await context.close(); }
}
export function VoiceInput({ projectId, session, onCandidate, onBusy }: { projectId: string; session: Session; onCandidate: (candidate: VoiceCandidate | null) => void; onBusy: (busy: boolean) => void }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null), [consent, setConsent] = useState(false), [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [candidate, setCandidate] = useState<VoiceCandidate | null>(null), [message, setMessage] = useState('');
  const stream = useRef<MediaStream | null>(null), recorder = useRef<MediaRecorder | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), controller = useRef<AbortController | null>(null), id = useRef<string | null>(null), alive = useRef(true), recordingGeneration = useRef(0), cancelRequested = useRef(false);
  const callbacks = useRef({ onCandidate, onBusy }); callbacks.current = { onCandidate, onBusy };
  const csrf = session.csrfToken;
  function release() { if (timer.current) clearTimeout(timer.current); stream.current?.getTracks().forEach(track => { track.stop(); }); stream.current = null; }
  useEffect(() => {
    alive.current = true;
    void api<Readiness>('/voice/status').then(value => { if (alive.current) setReadiness(value); }).catch(() => { if (alive.current) setMessage('음성 상태를 확인할 수 없습니다. 텍스트 입력을 사용하세요.'); });
    return () => {
      alive.current = false; recordingGeneration.current++; controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => { track.stop(); }); stream.current = null;
      if (id.current) void api(`/voice/candidates/${id.current}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } }, csrf).catch(() => undefined);
    };
  }, [csrf]);
  async function upload(blob: Blob) {
    if (!consent || busy || id.current || !alive.current) return;
    setBusy(true); callbacks.current.onBusy(true); setMessage('이 컴퓨터에서 전사 중입니다. 확인 전에는 업무가 등록되지 않습니다.');
    cancelRequested.current = false;
    const abort = new AbortController(); controller.current = abort;
    try {
      if (blob.size > 2_097_152) throw new Error('VOICE_FILE_LIMIT');
      const wav = await encodeWave(blob);
      if (!alive.current || abort.signal.aborted) return;
      const created = await api<{ id: string }>(`/projects/${projectId}/voice/candidates`, { method: 'POST', body: wav, signal: abort.signal, headers: { 'Content-Type': 'audio/wav', 'X-Voice-Consent': 'local-transcription-v1', 'Idempotency-Key': crypto.randomUUID() } }, csrf);
      id.current = created.id;
      if (cancelRequested.current || !alive.current) {
        await api(`/voice/candidates/${created.id}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } }, csrf);
        id.current = null;
        if (alive.current) { setCandidate(null); callbacks.current.onCandidate(null); setMessage('음성 후보를 취소·삭제했습니다.'); }
        return;
      }
      for (let attempt = 0; attempt < 150; attempt++) {
        if (!alive.current || abort.signal.aborted) return;
        const row = await api<VoiceCandidate>(`/voice/candidates/${created.id}`, { signal: abort.signal });
        if (row.status === 'READY') { setCandidate(row); callbacks.current.onCandidate(row); setMessage('전사 후보입니다. 이름·숫자·경로와 수용 기준을 확인하고 수정하세요.'); return; }
        if (row.status !== 'PROCESSING') throw new Error(row.errorCode ?? 'VOICE_NOT_READY');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('VOICE_RESULT_UNVERIFIABLE');
    } catch (error) {
      if (alive.current && !abort.signal.aborted) setMessage(error instanceof Error && error.message.startsWith('VOICE_') ? '전사를 완료하지 못했습니다. 후보 취소·삭제 후 텍스트로 계속할 수 있습니다. 자동 재시도하지 않습니다.' : errorMessage(error));
    } finally { if (alive.current) { setBusy(false); callbacks.current.onBusy(false); } }
  }
  async function start() {
    if (!consent || busy || candidate || recording) return;
    const generation = ++recordingGeneration.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!alive.current || generation !== recordingGeneration.current) { media.getTracks().forEach(track => { track.stop(); }); return; }
      stream.current = media;
      const capture = new MediaRecorder(media), chunks: Blob[] = []; let bytes = 0;
      recorder.current = capture;
      capture.ondataavailable = event => { bytes += event.data.size; if (bytes <= 2_097_152) chunks.push(event.data); else if (capture.state === 'recording') capture.stop(); };
      capture.onstop = () => { release(); if (alive.current) { setRecording(false); callbacks.current.onBusy(false); if (generation === recordingGeneration.current) void upload(new Blob(chunks, { type: capture.mimeType })); } chunks.length = 0; };
      capture.onerror = () => { recordingGeneration.current++; release(); setRecording(false); callbacks.current.onBusy(false); setMessage('녹음을 계속할 수 없습니다. 텍스트로 입력해 주세요.'); };
      capture.start(1000); setRecording(true); callbacks.current.onBusy(true); setMessage('녹음 중 · 최대 30초'); timer.current = setTimeout(() => { if (capture.state === 'recording') capture.stop(); }, 30_000);
    } catch { release(); if (alive.current) { setRecording(false); callbacks.current.onBusy(false); setMessage('마이크가 허용되지 않았거나 지원되지 않습니다. 텍스트 입력이나 음성 파일을 사용하세요.'); } }
  }
  async function cancel() {
    recordingGeneration.current++; cancelRequested.current = true; release(); if (recorder.current?.state === 'recording') recorder.current.stop(); setRecording(false);
    const candidateId = id.current;
    if (busy && !candidateId) { setMessage('요청 결과 확인 후 후보를 취소합니다. 응답이 불명하면 자동 재전송하지 않습니다.'); return; }
    controller.current?.abort();
    try {
      if (candidateId) await api(`/voice/candidates/${candidateId}`, { method: 'DELETE', headers: { 'Idempotency-Key': crypto.randomUUID() } }, csrf);
      id.current = null; setCandidate(null); callbacks.current.onCandidate(null); setMessage('음성 후보를 취소·삭제했습니다. 텍스트로 입력할 수 있습니다.');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); callbacks.current.onBusy(false); }
  }
  const disabled = !readiness?.ready || readiness.busy || readiness.usedToday >= readiness.limits.daily;
  return <fieldset className="voice-input"><legend>음성으로 업무 준비</legend>
    <p className="muted small">로컬 CPU에서 한국어를 전사합니다. 외부 STT 전송·유료 API 전환 없음. 최대 30초, 동시 1건, UTC 하루 20회입니다. 임시 음성은 처리·취소 후 삭제하고 후보 텍스트는 1시간 뒤 만료되어 30초 정리 주기에 폐기합니다. 서버 강제 종료 시에는 관리자 복구 확인이 필요합니다.</p>
    <p className="small">{readiness?.ready ? `로컬 모델 준비됨 · 오늘 ${readiness.usedToday}/${readiness.limits.daily}회 사용` : '로컬 모델 준비 여부 확인 필요 · 텍스트 입력 가능'}</p>
    <label className="acceptance-check"><input type="checkbox" checked={consent} disabled={busy || recording || Boolean(candidate)} onChange={event => setConsent(event.target.checked)} /><span>이 컴퓨터에서 음성을 처리하고 임시 WAV를 삭제하는 데 동의합니다. 후보 텍스트는 확인·취소 또는 1시간 만료까지 서버에 보관됩니다.</span></label>
    <div className="form-actions"><button type="button" className="button secondary" disabled={disabled || !consent || busy || Boolean(candidate)} onClick={() => { if (recording) recorder.current?.stop(); else void start(); }}>{recording ? '녹음 끝내고 전사' : '마이크로 입력'}</button>
      <label className="field">음성 파일 선택<input type="file" accept="audio/wav,audio/webm,audio/ogg,audio/mp4" disabled={disabled || !consent || busy || recording || Boolean(candidate)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></label>
      <button type="button" className="button secondary" onClick={() => void cancel()} disabled={!recording && !busy && !candidate && !id.current}>음성 후보 취소·삭제</button></div>
    {message && <p role="status" className="form-notice">{message}</p>}
    <p className="small"><strong>프로젝트·직원 이름, 숫자와 파일 경로를 직접 확인하세요.</strong> 음성은 실행·merge·배포 승인을 대신하지 않습니다.</p>
  </fieldset>;
}

create table voice_candidates (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  project_id uuid not null references projects(id),
  actor_id uuid not null references users(id),
  session_id uuid not null references sessions(id),
  status text not null check(status in ('PROCESSING','READY','CONFIRMED','CANCELLED','EXPIRED','FAILED')),
  transcript text check(length(transcript)<=10000),
  transcript_hash text,
  audio_hash text not null,
  duration_ms integer not null check(duration_ms between 250 and 30000),
  consent_version text not null check(consent_version='local-transcription-v1'),
  provider text not null default 'whisper.cpp-b5454-tiny-local',
  error_code text,
  task_id uuid references tasks(id),
  edited boolean,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 hour',
  confirmed_at timestamptz,
  check((status='READY' and transcript is not null) or (status<>'READY' and transcript is null))
);
create unique index voice_single_local_process on voice_candidates((true)) where status='PROCESSING';
create index voice_candidate_expiry on voice_candidates(expires_at) where status='READY';
create index voice_daily_budget on voice_candidates(organization_id,created_at);

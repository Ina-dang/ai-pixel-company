alter table voice_candidates
  add column owner_receipt jsonb,
  add column recovery_details jsonb,
  add column recovery_attempts integer not null default 0 check(recovery_attempts between 0 and 2),
  add column capture_source text not null default 'UNKNOWN' check(capture_source in ('UNKNOWN','FILE','MICROPHONE'));

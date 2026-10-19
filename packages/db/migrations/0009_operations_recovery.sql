CREATE TABLE operations_controls (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), paused boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'LIVE' CHECK(mode IN ('LIVE','RESTORE_QUARANTINE')),
  reason_ko text NOT NULL DEFAULT '', maintenance_token uuid, version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operations_snapshots (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), snapshot jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operations_alerts (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), rule_key text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('WARNING','CRITICAL')), message_ko text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  evidence jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  opened_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX operations_one_active_alert ON operations_alerts(organization_id,rule_key) WHERE status IN ('OPEN','ACKNOWLEDGED');
CREATE TABLE operations_alert_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), alert_id uuid NOT NULL REFERENCES operations_alerts(id),
  action text NOT NULL CHECK(action IN ('OPEN','ACKNOWLEDGE','RESOLVE')), actor_id text NOT NULL, original_ko text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER operations_alert_history_immutable BEFORE UPDATE OR DELETE ON operations_alert_events FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE TABLE operations_notification_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), project_id uuid,
  enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE operations_notification_outbox (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), event_id uuid NOT NULL UNIQUE REFERENCES operations_alert_events(id),
  connection_id uuid NOT NULL REFERENCES integration_connections(id), connection_version integer NOT NULL, text_ko text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','DEFERRED','FAILED','UNKNOWN')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), next_attempt_at timestamptz NOT NULL DEFAULT now(),
  external_ref jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operations_jobs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), requested_by uuid NOT NULL REFERENCES users(id), session_id uuid NOT NULL REFERENCES sessions(id),
  kind text NOT NULL CHECK(kind IN ('BACKUP','RESTORE_VERIFY')), backup_id uuid,
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
  result jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX operations_one_active_job ON operations_jobs((true)) WHERE status IN ('QUEUED','RUNNING','UNKNOWN');
CREATE TABLE operations_backups (
  id uuid PRIMARY KEY REFERENCES operations_jobs(id), organization_id uuid NOT NULL REFERENCES organizations(id),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes bigint NOT NULL CHECK(bytes>0),
  captured_at timestamptz NOT NULL, table_count integer NOT NULL, artifact_count integer NOT NULL,
  migration text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE operations_jobs ADD FOREIGN KEY(backup_id) REFERENCES operations_backups(id);
CREATE TABLE operations_release_checks (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL,
  status text NOT NULL CHECK(status IN ('PASS','FAIL','NOT_APPLICABLE')), profile text NOT NULL CHECK(profile='LOCAL_FIXTURE'),
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'), artifact_sha text NOT NULL CHECK(artifact_sha ~ '^[a-f0-9]{64}$'),
  details jsonb NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER operations_release_checks_immutable BEFORE UPDATE OR DELETE ON operations_release_checks FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE INDEX operations_release_checks_lookup ON operations_release_checks(organization_id,name,checked_at DESC);

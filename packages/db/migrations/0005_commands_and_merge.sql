ALTER TABLE integration_inbox ADD COLUMN connection_version integer;
ALTER TABLE integration_inbox ADD COLUMN result jsonb;
ALTER TABLE integration_inbox ADD COLUMN reply_status text NOT NULL DEFAULT 'NONE'
  CHECK(reply_status IN ('NONE','PENDING','SENDING','SENT','FAILED','UNKNOWN'));
ALTER TABLE integration_inbox ADD COLUMN reply_ref jsonb;
ALTER TABLE integration_merge_requests DROP CONSTRAINT integration_merge_requests_status_check;
ALTER TABLE integration_merge_requests ADD CONSTRAINT integration_merge_requests_status_check
  CHECK(status IN ('REQUESTED','APPROVED','QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN','REVOKED','EXPIRED','STALE'));
ALTER TABLE integration_merge_requests ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE integration_merge_requests ADD COLUMN approved_by uuid REFERENCES users(id);
ALTER TABLE integration_merge_requests ADD COLUMN approved_session_id uuid REFERENCES sessions(id);
ALTER TABLE integration_merge_requests ADD COLUMN approved_at timestamptz;
ALTER TABLE integration_merge_requests ADD COLUMN result jsonb;
ALTER TABLE integration_merge_requests ADD COLUMN error_code text;
ALTER TABLE integration_merge_requests ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX integration_merge_queue_idx ON integration_merge_requests(created_at) WHERE status='QUEUED';
DROP INDEX integration_one_remote_action_idx;
CREATE UNIQUE INDEX integration_one_remote_action_idx ON integration_operations(connection_id,run_id,kind)
  WHERE status IN ('PENDING','RUNNING','SUCCEEDED','UNKNOWN','DEFERRED') AND kind NOT IN ('CI_REFRESH','MERGE_REQUEST');

CREATE TABLE integration_connections (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('GITHUB','SLACK')), config jsonb NOT NULL, secret_refs jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE(organization_id,project_id,provider),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
  CHECK(jsonb_typeof(config)='object' AND jsonb_typeof(secret_refs)='object')
);
CREATE TABLE integration_inbox (
  id uuid PRIMARY KEY, connection_id uuid NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('GITHUB','SLACK')), delivery_id text NOT NULL, body_hash text NOT NULL,
  event_type text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','UNKNOWN')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id,delivery_id), FOREIGN KEY(organization_id,connection_id) REFERENCES integration_connections(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE integration_operations (
  id uuid PRIMARY KEY, connection_id uuid NOT NULL, connection_version integer NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('GITHUB','SLACK')), kind text NOT NULL CHECK(kind IN ('ISSUE_CREATE','BRANCH_CREATE','PUSH_CANDIDATE','DRAFT_PR_CREATE','CI_REFRESH','MERGE_REQUEST','SLACK_REPORT')),
  run_id uuid NOT NULL, candidate_sha text NOT NULL CHECK(candidate_sha ~ '^[a-f0-9]{64}$'), request jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN','DEFERRED')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), error_code text, external_ref jsonb,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), FOREIGN KEY(organization_id,connection_id) REFERENCES integration_connections(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id), FOREIGN KEY(organization_id,run_id) REFERENCES workflow_runs(organization_id,id)
);
CREATE INDEX integration_operations_queue_idx ON integration_operations(next_attempt_at,created_at) WHERE status IN ('PENDING','DEFERRED');
CREATE INDEX integration_inbox_queue_idx ON integration_inbox(created_at) WHERE status='RECEIVED';
CREATE UNIQUE INDEX integration_one_remote_action_idx ON integration_operations(connection_id,run_id,kind) WHERE status IN ('PENDING','RUNNING','SUCCEEDED','UNKNOWN','DEFERRED') AND kind<>'CI_REFRESH';
CREATE TABLE integration_merge_requests (
  id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, organization_id uuid NOT NULL, project_id uuid NOT NULL, run_id uuid NOT NULL,
  scope jsonb NOT NULL, scope_hash text NOT NULL CHECK(scope_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','REVOKED','EXPIRED','STALE')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,operation_id) REFERENCES integration_operations(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id), FOREIGN KEY(organization_id,run_id) REFERENCES workflow_runs(organization_id,id)
);

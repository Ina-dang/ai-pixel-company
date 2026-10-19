CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL,
  command_original_ko text NOT NULL, fixture text NOT NULL DEFAULT 'node-functions-v1',
  status text NOT NULL DEFAULT 'QUEUED', version integer NOT NULL DEFAULT 1,
  checkpoint jsonb NOT NULL, lease_token uuid, lease_expires_at timestamptz, stop_lease_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT workflow_task_fk FOREIGN KEY (organization_id,project_id,task_id) REFERENCES tasks(organization_id,project_id,id),
  CONSTRAINT workflow_status_check CHECK (status IN ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT workflow_fixture_check CHECK (fixture = 'node-functions-v1'),
  CONSTRAINT workflow_version_check CHECK (version > 0),
  CONSTRAINT workflow_checkpoint_check CHECK (jsonb_typeof(checkpoint) = 'object'),
  CONSTRAINT workflow_lease_check CHECK ((status = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL))
);
CREATE UNIQUE INDEX workflow_one_active_task_idx ON workflow_runs(organization_id,task_id)
  WHERE status IN ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL');
CREATE INDEX workflow_queue_idx ON workflow_runs(created_at,id) WHERE status='QUEUED';
CREATE INDEX workflow_expired_lease_idx ON workflow_runs(lease_expires_at) WHERE status='RUNNING';
CREATE TABLE workflow_acceptances (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL, candidate_sha text NOT NULL,
  accepted_by uuid NOT NULL, session_id uuid NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceptance_run_unique UNIQUE (organization_id,run_id),
  CONSTRAINT acceptance_run_fk FOREIGN KEY (organization_id,run_id) REFERENCES workflow_runs(organization_id,id),
  CONSTRAINT acceptance_actor_fk FOREIGN KEY (organization_id,accepted_by) REFERENCES memberships(organization_id,user_id),
  CONSTRAINT acceptance_session_fk FOREIGN KEY (organization_id,session_id) REFERENCES sessions(organization_id,id),
  CONSTRAINT acceptance_sha_check CHECK (candidate_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$')
);

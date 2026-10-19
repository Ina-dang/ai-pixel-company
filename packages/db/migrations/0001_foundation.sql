CREATE TABLE organizations (
  id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_status_check CHECK (status IN ('ACTIVE','SUSPENDED'))
);
CREATE TABLE users (
  id uuid PRIMARY KEY, external_subject text NOT NULL UNIQUE, display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_org_user_unique UNIQUE (organization_id,user_id), CONSTRAINT memberships_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT memberships_role_check CHECK (role IN ('OWNER','VIEWER')), CONSTRAINT memberships_status_check CHECK (status IN ('ACTIVE','REVOKED'))
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, token_hash text NOT NULL UNIQUE, csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_membership_fk FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id),
  CONSTRAINT sessions_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT sessions_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$' AND csrf_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE projects (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, repository_url text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main', status text NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_org_id_unique UNIQUE (organization_id,id), CONSTRAINT projects_status_check CHECK (status IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT projects_version_check CHECK (version > 0), CONSTRAINT projects_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE INDEX projects_org_status_idx ON projects(organization_id,status);
CREATE TABLE tasks (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, title text NOT NULL, command_original_ko text NOT NULL,
  command_hash text NOT NULL, source text NOT NULL DEFAULT 'TEXT', spec_en text, spec_version integer NOT NULL DEFAULT 1,
  acceptance_criteria jsonb NOT NULL, priority text NOT NULL DEFAULT 'MEDIUM', status text NOT NULL DEFAULT 'TODO', blocked_reason text,
  version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_org_id_unique UNIQUE (organization_id,id), CONSTRAINT tasks_org_project_id_unique UNIQUE (organization_id,project_id,id),
  CONSTRAINT tasks_project_fk FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
  CONSTRAINT tasks_creator_fk FOREIGN KEY (organization_id,created_by) REFERENCES memberships(organization_id,user_id),
  CONSTRAINT tasks_status_check CHECK (status IN ('TODO','PLANNING','IN_PROGRESS','REVIEW','APPROVAL_REQUIRED','COMPLETED','FAILED','CANCELLED')),
  CONSTRAINT tasks_priority_check CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')), CONSTRAINT tasks_source_check CHECK (source IN ('TEXT','VOICE','SLACK')),
  CONSTRAINT tasks_version_check CHECK (version > 0 AND spec_version > 0), CONSTRAINT tasks_command_hash_check CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT tasks_criteria_check CHECK (jsonb_typeof(acceptance_criteria) = 'array' AND jsonb_array_length(acceptance_criteria) BETWEEN 1 AND 100),
  CONSTRAINT tasks_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT tasks_original_command_check CHECK (char_length(btrim(command_original_ko)) BETWEEN 1 AND 20000)
);
CREATE INDEX tasks_org_project_status_created_idx ON tasks(organization_id,project_id,status,created_at,id);
CREATE TABLE organization_event_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), last_sequence bigint NOT NULL DEFAULT 0,
  CONSTRAINT event_counter_nonnegative_check CHECK (last_sequence >= 0)
);
CREATE TABLE agent_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), project_id uuid, workflow_run_id uuid, task_id uuid, agent_id uuid,
  sequence bigint NOT NULL, schema_version integer NOT NULL DEFAULT 1, type text NOT NULL, aggregate_version integer NOT NULL,
  payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), source_event_id text,
  CONSTRAINT events_org_id_unique UNIQUE (organization_id,id), CONSTRAINT events_org_sequence_unique UNIQUE (organization_id,sequence),
  CONSTRAINT events_org_source_unique UNIQUE (organization_id,source_event_id),
  CONSTRAINT events_project_fk FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
  CONSTRAINT events_task_fk FOREIGN KEY (organization_id,project_id,task_id) REFERENCES tasks(organization_id,project_id,id),
  CONSTRAINT events_versions_check CHECK (sequence > 0 AND schema_version = 1 AND aggregate_version > 0),
  CONSTRAINT events_payload_check CHECK (jsonb_typeof(payload) = 'object'), CONSTRAINT events_task_project_check CHECK (task_id IS NULL OR project_id IS NOT NULL)
);
CREATE INDEX events_org_project_sequence_idx ON agent_events(organization_id,project_id,sequence);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), project_id uuid,
  actor_type text NOT NULL, actor_id text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, request_id text NOT NULL,
  outcome text NOT NULL, before_hash text, after_hash text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT audit_project_fk FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
  CONSTRAINT audit_outcome_check CHECK (outcome IN ('SUCCESS','DENIED','FAILED')), CONSTRAINT audit_actor_type_check CHECK (actor_type IN ('USER','SYSTEM','AGENT')),
  CONSTRAINT audit_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX audit_org_created_idx ON audit_logs(organization_id,created_at);
CREATE INDEX audit_org_target_idx ON audit_logs(organization_id,target_type,target_id);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit rows are append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE idempotency_keys (
  organization_id uuid NOT NULL REFERENCES organizations(id), actor_id text NOT NULL, route text NOT NULL, key text NOT NULL,
  request_hash text NOT NULL, response_ref jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,actor_id,route,key), CONSTRAINT idempotency_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT idempotency_expiry_check CHECK (expires_at > created_at), CONSTRAINT idempotency_response_check CHECK (jsonb_typeof(response_ref) = 'object')
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys(expires_at);

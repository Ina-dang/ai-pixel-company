CREATE TABLE company_execution_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), monthly_tokens bigint NOT NULL DEFAULT 2000000,
  run_tokens integer NOT NULL DEFAULT 500000, version integer NOT NULL DEFAULT 1,
  CHECK(monthly_tokens BETWEEN 1000 AND 1000000000 AND run_tokens BETWEEN 1000 AND 500000 AND version>0)
);
CREATE TABLE project_execution_policies (
  organization_id uuid NOT NULL, project_id uuid NOT NULL, monthly_tokens bigint NOT NULL DEFAULT 1000000,
  run_tokens integer NOT NULL DEFAULT 500000, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(organization_id,project_id), FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
  CHECK(monthly_tokens BETWEEN 1000 AND 1000000000 AND run_tokens BETWEEN 1000 AND 500000 AND version>0)
);
CREATE TABLE execution_allowances (
  organization_id uuid NOT NULL, project_id uuid NOT NULL, operation_id uuid NOT NULL, kind text NOT NULL,
  period_start date NOT NULL, reserved_tokens bigint NOT NULL, spent_tokens bigint NOT NULL DEFAULT 0, base_tokens bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'HELD', updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,operation_id,period_start), FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
  CHECK(kind IN ('WORKFLOW','REVIEW') AND status IN ('HELD','SETTLED','UNKNOWN')),
  CHECK(reserved_tokens>=0 AND spent_tokens>=0 AND base_tokens>=0)
);
CREATE INDEX allowances_project_period_idx ON execution_allowances(organization_id,project_id,period_start);
ALTER TABLE tasks ADD CONSTRAINT tasks_project_scope_unique UNIQUE(organization_id,project_id,id);
CREATE TABLE task_dependencies (
  organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL, prerequisite_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,task_id,prerequisite_id), CHECK(task_id<>prerequisite_id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
  FOREIGN KEY(organization_id,project_id,task_id) REFERENCES tasks(organization_id,project_id,id),
  FOREIGN KEY(organization_id,project_id,prerequisite_id) REFERENCES tasks(organization_id,project_id,id)
);
CREATE FUNCTION validate_task_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM projects WHERE organization_id=NEW.organization_id AND id=NEW.project_id FOR UPDATE;
  IF EXISTS(WITH RECURSIVE paths(id) AS (
    SELECT NEW.prerequisite_id UNION SELECT d.prerequisite_id FROM task_dependencies d JOIN paths p ON d.task_id=p.id
    WHERE d.organization_id=NEW.organization_id AND d.project_id=NEW.project_id
  ) SELECT 1 FROM paths WHERE id=NEW.task_id) THEN
    RAISE EXCEPTION 'Dependency cycle' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_dependency_dag BEFORE INSERT OR UPDATE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION validate_task_dependency();
CREATE TABLE task_schedules (
  organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES users(id),
  enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, run_id uuid,
  reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,task_id), FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
  FOREIGN KEY(organization_id,task_id) REFERENCES tasks(organization_id,id), FOREIGN KEY(organization_id,run_id) REFERENCES workflow_runs(organization_id,id), CHECK(version>0)
);
CREATE TABLE performance_reviews (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL, run_id uuid NOT NULL,
  subject_employee_id uuid NOT NULL, subject_profile_version integer NOT NULL, type text NOT NULL,
  reviewer_employee_id uuid, reviewer_user_id uuid REFERENCES users(id), rubric_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT', revision_count integer NOT NULL DEFAULT 0, generation_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id), UNIQUE NULLS NOT DISTINCT(organization_id,task_id,subject_employee_id,type,reviewer_employee_id,reviewer_user_id),
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id), FOREIGN KEY(organization_id,task_id) REFERENCES tasks(organization_id,id),
  FOREIGN KEY(organization_id,run_id) REFERENCES workflow_runs(organization_id,id),
  FOREIGN KEY(organization_id,subject_employee_id,subject_profile_version) REFERENCES employee_profiles(organization_id,employee_id,version),
  FOREIGN KEY(organization_id,reviewer_employee_id) REFERENCES employees(organization_id,id),
  CHECK(type IN ('AUTO','SELF','PEER','PM','USER') AND status IN ('DRAFT','PUBLISHED','NEEDS_REVIEW','INVALID','UNKNOWN')),
  CHECK(revision_count BETWEEN 0 AND 2 AND generation_count BETWEEN 0 AND 2 AND version>0 AND rubric_version=1),
  CHECK((type='AUTO' AND reviewer_employee_id IS NULL AND reviewer_user_id IS NULL)
    OR (type='USER' AND reviewer_employee_id IS NULL AND reviewer_user_id IS NOT NULL)
    OR (type IN ('SELF','PEER','PM') AND reviewer_employee_id IS NOT NULL AND reviewer_user_id IS NULL)),
  CHECK(type<>'SELF' OR reviewer_employee_id=subject_employee_id), CHECK(type<>'PEER' OR reviewer_employee_id<>subject_employee_id)
);
CREATE TABLE performance_review_revisions (
  organization_id uuid NOT NULL, review_id uuid NOT NULL, revision integer NOT NULL, scores jsonb, weights jsonb NOT NULL,
  score numeric, body_en text NOT NULL DEFAULT '', original_ko text, summary_ko text NOT NULL, evidence jsonb NOT NULL, evidence_hash text NOT NULL,
  metrics jsonb NOT NULL, flags jsonb NOT NULL DEFAULT '[]', usage jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,review_id,revision), FOREIGN KEY(organization_id,review_id) REFERENCES performance_reviews(organization_id,id),
  CHECK(revision BETWEEN 1 AND 2 AND evidence_hash ~ '^[a-f0-9]{64}$' AND (score IS NULL OR score BETWEEN 0 AND 100)),
  CHECK(jsonb_typeof(evidence)='object' AND jsonb_typeof(metrics)='object' AND jsonb_typeof(weights)='object')
);
CREATE TRIGGER performance_revisions_immutable BEFORE UPDATE OR DELETE ON performance_review_revisions FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE TABLE performance_review_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, review_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, original_ko text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,review_id) REFERENCES performance_reviews(organization_id,id), CHECK(action IN ('CONFIRM','DISPUTE'))
);
CREATE TRIGGER performance_events_immutable BEFORE UPDATE OR DELETE ON performance_review_events FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE TABLE performance_review_jobs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, review_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'QUEUED', evidence jsonb NOT NULL, evidence_hash text NOT NULL, reviewer_profile jsonb NOT NULL,
  lease_token uuid, lease_expires_at timestamptz, active_thread_id text, error_code text, usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,review_id) REFERENCES performance_reviews(organization_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
  CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN')), CHECK(evidence_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX review_one_active_job_idx ON performance_review_jobs(review_id) WHERE status IN ('QUEUED','RUNNING','UNKNOWN');
CREATE TABLE departments (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name_ko text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1, UNIQUE(organization_id,id), UNIQUE(organization_id,name_ko),
  CHECK(status IN ('ACTIVE','ARCHIVED') AND char_length(btrim(name_ko)) BETWEEN 1 AND 80 AND version>0)
);
CREATE TABLE employee_departments (
  organization_id uuid NOT NULL, employee_id uuid NOT NULL, department_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(organization_id,employee_id), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id),
  FOREIGN KEY(organization_id,department_id) REFERENCES departments(organization_id,id), CHECK(version>0)
);
CREATE TABLE employee_department_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, employee_id uuid NOT NULL, department_id uuid, actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id),
  FOREIGN KEY(organization_id,department_id) REFERENCES departments(organization_id,id)
);
CREATE TRIGGER department_events_immutable BEFORE UPDATE OR DELETE ON employee_department_events FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE FUNCTION validate_review_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision performance_review_revisions%ROWTYPE;
BEGIN
  IF NEW.status='PUBLISHED' THEN
    SELECT * INTO revision FROM performance_review_revisions WHERE organization_id=NEW.organization_id AND review_id=NEW.id AND performance_review_revisions.revision=NEW.revision_count;
    IF NOT FOUND OR revision.score IS NULL OR revision.scores IS NULL OR jsonb_typeof(revision.scores)<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(revision.scores))<>4
      OR NOT(revision.scores ?& ARRAY['accuracy','quality','collaboration','efficiency'])
      OR EXISTS(SELECT 1 FROM jsonb_each(revision.scores) WHERE jsonb_typeof(value)<>'number' OR value::text::numeric NOT BETWEEN 0 AND 100)
      OR revision.weights<>'{"accuracy":0.3,"quality":0.3,"collaboration":0.2,"efficiency":0.2}'::jsonb THEN
      RAISE EXCEPTION 'Published review needs complete scores and evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER review_publication_guard BEFORE INSERT OR UPDATE ON performance_reviews FOR EACH ROW EXECUTE FUNCTION validate_review_publication();

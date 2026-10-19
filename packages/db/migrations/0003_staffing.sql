CREATE TABLE employees (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name_ko text NOT NULL,
  role text NOT NULL, employment_status text NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1,
  current_profile_version integer NOT NULL DEFAULT 1, is_baseline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  CHECK (role IN ('PM','DEVELOPER','QA')), CHECK (employment_status IN ('ACTIVE','SUSPENDED','RETIRED')),
  CHECK (char_length(btrim(name_ko)) BETWEEN 1 AND 80), CHECK (version>0 AND current_profile_version>0)
);
CREATE UNIQUE INDEX employee_baseline_role_idx ON employees(organization_id,role) WHERE is_baseline;
CREATE TABLE employee_profiles (
  organization_id uuid NOT NULL, employee_id uuid NOT NULL, version integer NOT NULL,
  config jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,employee_id,version),
  FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id),
  CHECK (version>0 AND jsonb_typeof(config)='object'),
  CHECK (config->>'provider'='CHATGPT_SUBSCRIPTION' AND config->>'model'='codex-default')
);
CREATE FUNCTION reject_staffing_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Staffing history is immutable' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER employee_profiles_immutable BEFORE UPDATE OR DELETE ON employee_profiles FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE TABLE employee_employment_events (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, employee_id uuid NOT NULL, from_status text,
  to_status text NOT NULL, actor_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id),
  CHECK (from_status IS NULL OR from_status IN ('ACTIVE','SUSPENDED','RETIRED')), CHECK (to_status IN ('ACTIVE','SUSPENDED','RETIRED'))
);
CREATE TRIGGER employee_employment_events_immutable BEFORE UPDATE OR DELETE ON employee_employment_events FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
CREATE SEQUENCE staffing_assignment_version_seq AS integer MINVALUE 1 MAXVALUE 2147483647 NO CYCLE;
CREATE TABLE project_staffing (
  organization_id uuid NOT NULL, project_id uuid NOT NULL, role text NOT NULL, employee_id uuid NOT NULL,
  version integer NOT NULL DEFAULT nextval('staffing_assignment_version_seq'), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,project_id,role),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id),
  FOREIGN KEY (organization_id,employee_id) REFERENCES employees(organization_id,id),
  CHECK (role IN ('PM','DEVELOPER','QA') AND version>0)
);
CREATE TABLE project_staffing_initializations (
  organization_id uuid NOT NULL, project_id uuid NOT NULL, initialized_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,project_id), FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE workflow_staffing_snapshots (
  organization_id uuid NOT NULL, run_id uuid NOT NULL, role text NOT NULL, employee_id uuid NOT NULL,
  profile_version integer NOT NULL, profile jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,run_id,role),
  FOREIGN KEY (organization_id,run_id) REFERENCES workflow_runs(organization_id,id),
  FOREIGN KEY (organization_id,employee_id,profile_version) REFERENCES employee_profiles(organization_id,employee_id,version),
  CHECK (role IN ('PM','DEVELOPER','QA') AND jsonb_typeof(profile)='object')
);
CREATE TRIGGER workflow_staffing_snapshots_immutable BEFORE UPDATE OR DELETE ON workflow_staffing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_staffing_history_mutation();
INSERT INTO employees (id,organization_id,name_ko,role,is_baseline)
  SELECT gen_random_uuid(),o.id,r.name,r.role,true FROM organizations o CROSS JOIN (VALUES ('PM','기본 PM'),('DEVELOPER','기본 개발자'),('QA','기본 QA')) AS r(role,name);
INSERT INTO employee_profiles (organization_id,employee_id,version,config)
  SELECT organization_id,id,1,jsonb_build_object('employeeId',id,'role',role,'nameKo',name_ko,'profileVersion',1,
    'provider','CHATGPT_SUBSCRIPTION','model','codex-default','rolePrompt','Follow the bounded role contract and provide verifiable evidence.',
    'skills','[]'::jsonb,'departmentKo',CASE role WHEN 'PM' THEN '기획' WHEN 'DEVELOPER' THEN '개발' ELSE '품질' END,
    'workStyleKo','근거를 확인하고 간결하게 보고합니다.',
    'tools',CASE role WHEN 'PM' THEN '["PLAN"]'::jsonb WHEN 'DEVELOPER' THEN '["EDIT_FILES"]'::jsonb ELSE '["VERIFY","REVIEW"]'::jsonb END,
    'limits',jsonb_build_object('maxTurns',7,'maxTokens',500000,'maxElapsedMs',900000),
    'avatar',CASE role WHEN 'PM' THEN 'pm' WHEN 'DEVELOPER' THEN 'developer' ELSE 'qa' END) FROM employees WHERE is_baseline;
INSERT INTO employee_employment_events (id,organization_id,employee_id,to_status)
  SELECT gen_random_uuid(),organization_id,id,'ACTIVE' FROM employees WHERE is_baseline;
INSERT INTO project_staffing_initializations (organization_id,project_id) SELECT organization_id,id FROM projects;
INSERT INTO project_staffing (organization_id,project_id,role,employee_id)
  SELECT p.organization_id,p.id,e.role,e.id FROM projects p JOIN employees e ON e.organization_id=p.organization_id AND e.is_baseline;

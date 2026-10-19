CREATE OR REPLACE FUNCTION validate_review_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision performance_review_revisions%ROWTYPE; source workflow_runs%ROWTYPE; expected_score numeric;
BEGIN
  IF NEW.status='PUBLISHED' THEN
    SELECT * INTO revision FROM performance_review_revisions WHERE organization_id=NEW.organization_id AND review_id=NEW.id AND performance_review_revisions.revision=NEW.revision_count;
    IF NOT FOUND OR revision.score IS NULL OR revision.scores IS NULL OR jsonb_typeof(revision.scores)<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(revision.scores))<>4
      OR NOT(revision.scores ?& ARRAY['accuracy','quality','collaboration','efficiency'])
      OR EXISTS(SELECT 1 FROM jsonb_each(revision.scores) WHERE jsonb_typeof(value)<>'number' OR value::text::numeric NOT BETWEEN 0 AND 100)
      OR revision.weights<>'{"accuracy":0.3,"quality":0.3,"collaboration":0.2,"efficiency":0.2}'::jsonb THEN
      RAISE EXCEPTION 'Published review needs complete scores' USING ERRCODE='23514';
    END IF;
    expected_score=round((revision.scores->>'accuracy')::numeric*0.3+(revision.scores->>'quality')::numeric*0.3+(revision.scores->>'collaboration')::numeric*0.2+(revision.scores->>'efficiency')::numeric*0.2,2);
    SELECT * INTO source FROM workflow_runs WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND task_id=NEW.task_id AND id=NEW.run_id;
    IF NOT FOUND OR source.status NOT IN ('SUCCEEDED','FAILED','CANCELLED') OR revision.score<>expected_score
      OR revision.evidence->>'runId'<>NEW.run_id::text OR (revision.evidence->>'runVersion')::integer<>source.version
      OR revision.evidence->'subject'->>'employeeId'<>NEW.subject_employee_id::text
      OR (revision.evidence->'subject'->>'profileVersion')::integer<>NEW.subject_profile_version
      OR coalesce(revision.evidence->>'candidateSha','')='' OR revision.evidence->'verification'->>'sha' IS DISTINCT FROM revision.evidence->>'candidateSha'
      OR coalesce(jsonb_array_length(revision.evidence->'roleEvidence'),0)=0
      OR NOT EXISTS(SELECT 1 FROM workflow_staffing_snapshots WHERE organization_id=NEW.organization_id AND run_id=NEW.run_id AND employee_id=NEW.subject_employee_id AND profile_version=NEW.subject_profile_version) THEN
      RAISE EXCEPTION 'Published review needs current execution evidence and rubric' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- Backfill only completed, provider-reported role usage. Unknown/in-flight tokens and currency are not invented.
WITH role_usage AS (
  SELECT r.organization_id,r.project_id,r.id AS operation_id,
    date_trunc('month',(e->>'completedAt')::timestamptz AT TIME ZONE 'UTC')::date AS period_start,
    sum((e->'usage'->>'inputTokens')::bigint+(e->'usage'->>'outputTokens')::bigint) AS tokens
  FROM workflow_runs r CROSS JOIN LATERAL jsonb_array_elements(r.checkpoint->'roles') e
  WHERE e->>'completedAt' IS NOT NULL GROUP BY r.organization_id,r.project_id,r.id,period_start
), ledger AS (
  SELECT *,coalesce(sum(tokens) OVER(PARTITION BY operation_id ORDER BY period_start ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_tokens FROM role_usage
)
INSERT INTO execution_allowances(organization_id,project_id,operation_id,kind,period_start,reserved_tokens,spent_tokens,base_tokens,status)
SELECT organization_id,project_id,operation_id,'WORKFLOW',period_start,tokens,tokens,prior_tokens,'SETTLED' FROM ledger
ON CONFLICT(organization_id,operation_id,period_start) DO NOTHING;

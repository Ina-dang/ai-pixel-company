-- SQL NULL must not bypass publication guards when a required JSON field is absent.
CREATE FUNCTION validate_review_evidence_presence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision performance_review_revisions%ROWTYPE; source workflow_runs%ROWTYPE;
BEGIN
  IF NEW.status='PUBLISHED' THEN
    SELECT * INTO revision FROM performance_review_revisions WHERE organization_id=NEW.organization_id AND review_id=NEW.id AND performance_review_revisions.revision=NEW.revision_count;
    SELECT * INTO source FROM workflow_runs WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND task_id=NEW.task_id AND id=NEW.run_id;
    IF revision.evidence->>'runId' IS DISTINCT FROM NEW.run_id::text
      OR revision.evidence->>'runVersion' IS DISTINCT FROM source.version::text
      OR revision.evidence->'subject'->>'employeeId' IS DISTINCT FROM NEW.subject_employee_id::text
      OR revision.evidence->'subject'->>'profileVersion' IS DISTINCT FROM NEW.subject_profile_version::text
      OR revision.evidence->>'candidateSha' IS DISTINCT FROM source.checkpoint->'workspace'->>'sha'
      OR revision.evidence->'verification'->>'sha' IS DISTINCT FROM source.checkpoint->'verification'->>'sha'
      OR revision.evidence->'verification'->>'testExit' IS DISTINCT FROM source.checkpoint->'verification'->'test'->>'exitCode'
      OR revision.evidence->'verification'->>'buildExit' IS DISTINCT FROM source.checkpoint->'verification'->'build'->>'exitCode'
      OR revision.evidence->'verification'->'sandbox' IS DISTINCT FROM '{"networkDisabled":true,"readOnlyRoot":true,"resourceLimited":true}'::jsonb THEN
      RAISE EXCEPTION 'Published review evidence fields must match the source' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER performance_review_evidence_presence BEFORE INSERT OR UPDATE ON performance_reviews FOR EACH ROW EXECUTE FUNCTION validate_review_evidence_presence();

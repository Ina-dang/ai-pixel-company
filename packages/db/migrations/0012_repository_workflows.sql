ALTER TABLE workflow_runs DROP CONSTRAINT workflow_fixture_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_fixture_check CHECK (fixture IN ('node-functions-v1','how-to-trash-v1'));
ALTER TABLE workflow_runs ADD COLUMN repository_source jsonb;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_repository_source_check CHECK (
  (fixture='node-functions-v1' AND repository_source IS NULL) OR
  (fixture='how-to-trash-v1' AND repository_source IS NOT NULL AND
   jsonb_typeof(repository_source)='object' AND
   coalesce(repository_source->>'profile','')='how-to-trash-v1' AND
   coalesce(repository_source->>'repositoryUrl','')='https://github.com/Ina-dang/how-to-trash.git' AND
   coalesce(repository_source->>'baseSha','') ~ '^[a-f0-9]{40}$' AND
   coalesce(repository_source->>'admissionSha','') ~ '^[a-f0-9]{64}$' AND
   coalesce(repository_source->>'imageId','') ~ '^sha256:[a-f0-9]{64}$')
);
CREATE FUNCTION preserve_repository_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fixture IS DISTINCT FROM OLD.fixture OR NEW.repository_source IS DISTINCT FROM OLD.repository_source THEN
    RAISE EXCEPTION 'Run repository source is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workflow_repository_source_immutable BEFORE UPDATE ON workflow_runs
FOR EACH ROW EXECUTE FUNCTION preserve_repository_source();

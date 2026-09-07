ALTER TABLE workflow_runs
  ADD COLUMN work_type text,
  ADD COLUMN attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_work_type_check CHECK (work_type IS NULL OR work_type = 'EVALUATE_RELEASE');

CREATE INDEX workflow_runs_claim_idx ON workflow_runs (work_type, status, lease_expires_at, created_at) WHERE work_type IS NOT NULL;

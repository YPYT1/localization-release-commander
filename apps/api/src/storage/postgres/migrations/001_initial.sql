CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rulesets (
  id text PRIMARY KEY,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('YOUTUBE', 'OTT')),
  language text NOT NULL,
  version text NOT NULL,
  rules_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rulesets(id, name, platform, language, version, rules_json, status, updated_at) VALUES
  ('youtube-en-v1', 'YouTube English Delivery', 'YOUTUBE', 'en', '1.0.0', '{"checks":8}', 'PUBLISHED', '2026-09-04T00:00:00Z'),
  ('youtube-ja-v1', 'YouTube Japanese Delivery', 'YOUTUBE', 'ja', '1.0.0', '{"checks":8}', 'PUBLISHED', '2026-09-04T00:00:00Z'),
  ('youtube-es-v1', 'YouTube Spanish Delivery', 'YOUTUBE', 'es', '1.0.0', '{"checks":8}', 'PUBLISHED', '2026-09-04T00:00:00Z'),
  ('ott-en-v1', 'OTT English Delivery', 'OTT', 'en', '1.0.0', '{"checks":10}', 'PUBLISHED', '2026-09-04T00:00:00Z'),
  ('ott-ja-v1', 'OTT Japanese Delivery', 'OTT', 'ja', '1.0.0', '{"checks":10}', 'PUBLISHED', '2026-09-04T00:00:00Z'),
  ('ott-es-v1', 'OTT Spanish Delivery', 'OTT', 'es', '1.0.0', '{"checks":10}', 'PUBLISHED', '2026-09-04T00:00:00Z');

CREATE TABLE releases (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  rule_set_id text NOT NULL REFERENCES rulesets(id),
  episode text NOT NULL,
  territory text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('YOUTUBE', 'OTT')),
  language text NOT NULL,
  state text NOT NULL CHECK (state IN ('DRAFT', 'VALIDATING', 'BLOCKED', 'REMEDIATING', 'NEEDS_HUMAN', 'READY_FOR_APPROVAL', 'APPROVED', 'SUBMITTING', 'RETRY_WAIT', 'SUBMITTED', 'QC_PASSED', 'QC_FAILED', 'COMPLETED')),
  deadline timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  parent_asset_id uuid REFERENCES assets(id),
  kind text NOT NULL CHECK (kind IN ('VIDEO', 'SUBTITLE', 'AUDIO', 'POSTER', 'METADATA', 'RIGHTS', 'DELIVERY_PACKAGE')),
  language text,
  file_name text NOT NULL,
  uri text NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, sha256)
);

CREATE TABLE findings (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'BLOCKER')),
  code text NOT NULL,
  message text NOT NULL,
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE actions (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  type text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('R0', 'R1', 'R2', 'R3')),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RUNNING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES actions(id),
  actor_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, actor_id)
);

CREATE TABLE delivery_attempts (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  provider text NOT NULL CHECK (provider IN ('YOUTUBE', 'OTT')),
  request_id text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('PENDING', 'SUBMITTING', 'SUBMITTED', 'QC_PASSED', 'QC_FAILED', 'FAILED')),
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  type text NOT NULL,
  actor text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(id),
  graph_version text NOT NULL,
  checkpoint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX releases_project_updated_idx ON releases (project_id, updated_at DESC);
CREATE INDEX assets_release_created_idx ON assets (release_id, created_at);
CREATE INDEX findings_release_created_idx ON findings (release_id, created_at);
CREATE INDEX actions_release_created_idx ON actions (release_id, created_at);
CREATE INDEX approvals_action_decided_idx ON approvals (action_id, decided_at);
CREATE INDEX delivery_attempts_release_created_idx ON delivery_attempts (release_id, created_at);
CREATE INDEX audit_events_release_occurred_idx ON audit_events (release_id, occurred_at, id);
CREATE INDEX audit_events_actor_occurred_idx ON audit_events (actor, occurred_at);
CREATE INDEX workflow_runs_release_created_idx ON workflow_runs (release_id, created_at);

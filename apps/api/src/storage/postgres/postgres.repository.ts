import { randomUUID } from "node:crypto";
import type {
  ActionDto,
  ActionRisk,
  ActionStatus,
  ApprovalDecision,
  ApprovalDto,
  AssetDto,
  AssetKind,
  AuditEventDto,
  CreateAssetInput,
  CreateReleaseInput,
  DeliveryAttemptDto,
  DeliveryStatus,
  FindingDto,
  FindingSeverity,
  FindingStatus,
  Platform,
  ProjectDto,
  ReleaseDetailDto,
  ReleaseState,
  ReleaseSummaryDto,
} from "@lrc/contracts";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  AuditFilter,
  NewAction,
  NewDelivery,
  NewFinding,
  ReleaseRecord,
  ReleaseRepository,
  WorkflowRunRecord,
} from "../../domain/repository.js";

interface ProjectRow extends QueryResultRow {
  id: string;
  name: string;
  createdAt: Date | string;
}

interface ReleaseRow extends QueryResultRow {
  id: string;
  projectId: string;
  ruleSetId: string;
  episode: string;
  territory: string;
  platform: Platform;
  language: string;
  state: ReleaseState;
  deadline: Date | string | null;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface AssetRow extends QueryResultRow {
  id: string;
  releaseId: string;
  parentAssetId: string | null;
  kind: AssetKind;
  language: string | null;
  fileName: string;
  uri: string;
  sha256: string;
  metadata: Record<string, unknown>;
  createdAt: Date | string;
}

interface FindingRow extends QueryResultRow {
  id: string;
  code: string;
  severity: FindingSeverity;
  message: string;
  source: string;
  status: FindingStatus;
  evidence: Record<string, unknown>;
  suggestedAction: string | null;
  createdAt: Date | string;
}

interface ActionRow extends QueryResultRow {
  id: string;
  releaseId: string;
  type: string;
  risk: ActionRisk;
  status: ActionStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  idempotencyKey: string;
  createdAt: Date | string;
}

interface ApprovalRow extends QueryResultRow {
  id: string;
  actionId: string;
  actorId: string;
  decision: ApprovalDecision;
  reason: string;
  decidedAt: Date | string;
}

interface DeliveryRow extends QueryResultRow {
  id: string;
  releaseId: string;
  provider: Platform;
  requestId: string;
  status: DeliveryStatus;
  response: Record<string, unknown>;
  createdAt: Date | string;
}

interface AuditRow extends QueryResultRow {
  id: string;
  releaseId: string;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
  occurredAt: Date | string;
}

interface WorkflowRunRow extends QueryResultRow {
  id: string;
  releaseId: string;
  graphVersion: string;
  checkpoint: Record<string, unknown>;
  status: WorkflowRunRecord["status"];
  createdAt: Date | string;
  updatedAt: Date | string;
}

type DatabaseClient = Pick<Pool | PoolClient, "query">;

const RELEASE_COLUMNS = `id, project_id AS "projectId", rule_set_id AS "ruleSetId", episode, territory, platform, language, state, deadline, version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const ASSET_COLUMNS = `id, release_id AS "releaseId", parent_asset_id AS "parentAssetId", kind, language, file_name AS "fileName",
  uri, sha256, metadata_json AS metadata, created_at AS "createdAt"`;
const FINDING_COLUMNS = `id, code, severity, message, source, status, evidence_json AS evidence,
  suggested_action AS "suggestedAction", created_at AS "createdAt"`;
const ACTION_COLUMNS = `id, release_id AS "releaseId", type, risk, status, input_json AS input, output_json AS output,
  idempotency_key AS "idempotencyKey", created_at AS "createdAt"`;
const APPROVAL_COLUMNS = `id, action_id AS "actionId", actor_id AS "actorId", decision, reason, decided_at AS "decidedAt"`;
const DELIVERY_COLUMNS = `id, release_id AS "releaseId", provider, request_id AS "requestId", status,
  response_json AS response, created_at AS "createdAt"`;
const AUDIT_COLUMNS = `id, release_id AS "releaseId", type, actor, payload_json AS payload, occurred_at AS "occurredAt"`;
const RUN_COLUMNS = `id, release_id AS "releaseId", graph_version AS "graphVersion", checkpoint_json AS checkpoint, status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export class PostgresReleaseRepository implements ReleaseRepository {
  constructor(private readonly pool: Pool, private readonly ownsPool = false) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }

  async createProject(name: string): Promise<ProjectDto> {
    const result = await this.pool.query<ProjectRow>(
      `INSERT INTO projects(id, name) VALUES ($1, $2) RETURNING id, name, created_at AS "createdAt"`,
      [randomUUID(), name],
    );
    return this.project(result.rows[0]!);
  }

  async getProject(id: string): Promise<ProjectDto | undefined> {
    const result = await this.pool.query<ProjectRow>(`SELECT id, name, created_at AS "createdAt" FROM projects WHERE id = $1`, [id]);
    return result.rows[0] ? this.project(result.rows[0]) : undefined;
  }

  async createRelease(input: CreateReleaseInput & { projectId: string }): Promise<ReleaseRecord> {
    const result = await this.pool.query<ReleaseRow>(
      `INSERT INTO releases(id, project_id, rule_set_id, episode, territory, platform, language, state, deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8) RETURNING ${RELEASE_COLUMNS}`,
      [randomUUID(), input.projectId, input.ruleSetId, input.episode, input.territory, input.platform, input.language, input.deadline ?? null],
    );
    return this.release(result.rows[0]!);
  }

  async listReleases(projectIds?: readonly string[]): Promise<ReleaseSummaryDto[]> {
    if (projectIds?.length === 0) return [];
    const result = projectIds
      ? await this.pool.query<ReleaseRow>(`SELECT ${RELEASE_COLUMNS} FROM releases WHERE project_id = ANY($1::uuid[]) ORDER BY updated_at DESC, id`, [projectIds])
      : await this.pool.query<ReleaseRow>(`SELECT ${RELEASE_COLUMNS} FROM releases ORDER BY updated_at DESC, id`);
    return result.rows.map((row) => this.releaseSummary(row));
  }

  async getReleaseRecord(id: string): Promise<ReleaseRecord | undefined> {
    const result = await this.pool.query<ReleaseRow>(`SELECT ${RELEASE_COLUMNS} FROM releases WHERE id = $1`, [id]);
    return result.rows[0] ? this.release(result.rows[0]) : undefined;
  }

  async getRelease(id: string): Promise<ReleaseDetailDto | undefined> {
    const release = await this.getReleaseRecord(id);
    if (!release) return undefined;
    const [assets, findings, actions, approvals, deliveries] = await Promise.all([
      this.pool.query<AssetRow>(`SELECT ${ASSET_COLUMNS} FROM assets WHERE release_id = $1 ORDER BY created_at, id`, [id]),
      this.pool.query<FindingRow>(`SELECT ${FINDING_COLUMNS} FROM findings WHERE release_id = $1 ORDER BY created_at, id`, [id]),
      this.pool.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE release_id = $1 ORDER BY created_at, id`, [id]),
      this.pool.query<ApprovalRow>(
        `SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE action_id IN (SELECT id FROM actions WHERE release_id = $1) ORDER BY decided_at, id`,
        [id],
      ),
      this.pool.query<DeliveryRow>(`SELECT ${DELIVERY_COLUMNS} FROM delivery_attempts WHERE release_id = $1 ORDER BY created_at, id`, [id]),
    ]);
    return {
      ...release,
      assets: assets.rows.map((row) => this.asset(row)),
      findings: findings.rows.map((row) => this.finding(row)),
      actions: actions.rows.map((row) => this.action(row)),
      approvals: approvals.rows.map((row) => this.approval(row)),
      deliveries: deliveries.rows.map((row) => this.delivery(row)),
    };
  }

  async updateReleaseState(id: string, state: ReleaseState): Promise<ReleaseRecord | undefined> {
    const result = await this.pool.query<ReleaseRow>(
      `UPDATE releases SET state = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING ${RELEASE_COLUMNS}`,
      [id, state],
    );
    return result.rows[0] ? this.release(result.rows[0]) : undefined;
  }

  async findAssetByHash(releaseId: string, sha256: string): Promise<AssetDto | undefined> {
    const result = await this.pool.query<AssetRow>(`SELECT ${ASSET_COLUMNS} FROM assets WHERE release_id = $1 AND sha256 = $2`, [releaseId, sha256]);
    return result.rows[0] ? this.asset(result.rows[0]) : undefined;
  }

  async createAsset(releaseId: string, input: CreateAssetInput & { sha256: string; uri: string }): Promise<AssetDto> {
    const parentAssetId = typeof input.metadata?.parentAssetId === "string" ? input.metadata.parentAssetId : null;
    const result = await this.pool.query<AssetRow>(
      `INSERT INTO assets(id, release_id, parent_asset_id, kind, language, file_name, uri, sha256, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (release_id, sha256) DO UPDATE SET sha256 = assets.sha256 RETURNING ${ASSET_COLUMNS}`,
      [randomUUID(), releaseId, parentAssetId, input.kind, input.language ?? null, input.fileName, input.uri, input.sha256, JSON.stringify(input.metadata ?? {})],
    );
    return this.asset(result.rows[0]!);
  }

  async replaceFindings(releaseId: string, findings: NewFinding[]): Promise<FindingDto[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM findings WHERE release_id = $1", [releaseId]);
      const created: FindingDto[] = [];
      for (const finding of findings) created.push(await this.insertFinding(client, releaseId, finding));
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listFindings(releaseId: string): Promise<FindingDto[]> {
    const result = await this.pool.query<FindingRow>(`SELECT ${FINDING_COLUMNS} FROM findings WHERE release_id = $1 ORDER BY created_at, id`, [releaseId]);
    return result.rows.map((row) => this.finding(row));
  }

  async findActionByIdempotencyKey(idempotencyKey: string): Promise<ActionDto | undefined> {
    const result = await this.pool.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE idempotency_key = $1`, [idempotencyKey]);
    return result.rows[0] ? this.action(result.rows[0]) : undefined;
  }

  async createAction(input: NewAction): Promise<ActionDto> {
    const result = await this.pool.query<ActionRow>(
      `INSERT INTO actions(id, release_id, type, risk, input_json, output_json, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
       ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = actions.idempotency_key RETURNING ${ACTION_COLUMNS}`,
      [randomUUID(), input.releaseId, input.type, input.risk, JSON.stringify(input.input), input.output == null ? null : JSON.stringify(input.output), input.idempotencyKey, input.status],
    );
    return this.action(result.rows[0]!);
  }

  async getAction(id: string): Promise<ActionDto | undefined> {
    const result = await this.pool.query<ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE id = $1`, [id]);
    return result.rows[0] ? this.action(result.rows[0]) : undefined;
  }

  async updateAction(id: string, status: ActionStatus, output: Record<string, unknown> | null = null): Promise<ActionDto | undefined> {
    const result = await this.pool.query<ActionRow>(
      `UPDATE actions SET status = $2, output_json = $3::jsonb WHERE id = $1 RETURNING ${ACTION_COLUMNS}`,
      [id, status, output == null ? null : JSON.stringify(output)],
    );
    return result.rows[0] ? this.action(result.rows[0]) : undefined;
  }

  async createApproval(input: Omit<ApprovalDto, "id" | "decidedAt">): Promise<ApprovalDto> {
    const result = await this.pool.query<ApprovalRow>(
      `INSERT INTO approvals(id, action_id, actor_id, decision, reason) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (action_id, actor_id) DO UPDATE SET actor_id = approvals.actor_id RETURNING ${APPROVAL_COLUMNS}`,
      [randomUUID(), input.actionId, input.actorId, input.decision, input.reason],
    );
    return this.approval(result.rows[0]!);
  }

  async listApprovals(actionId: string): Promise<ApprovalDto[]> {
    const result = await this.pool.query<ApprovalRow>(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE action_id = $1 ORDER BY decided_at, id`, [actionId]);
    return result.rows.map((row) => this.approval(row));
  }

  async findDeliveryForRelease(releaseId: string): Promise<DeliveryAttemptDto | undefined> {
    const result = await this.pool.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS} FROM delivery_attempts WHERE release_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [releaseId],
    );
    return result.rows[0] ? this.delivery(result.rows[0]) : undefined;
  }

  async createDelivery(input: NewDelivery): Promise<DeliveryAttemptDto> {
    const result = await this.pool.query<DeliveryRow>(
      `INSERT INTO delivery_attempts(id, release_id, provider, request_id, status, response_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING ${DELIVERY_COLUMNS}`,
      [randomUUID(), input.releaseId, input.provider, input.requestId ?? "", input.status, JSON.stringify(input.response ?? {})],
    );
    return this.delivery(result.rows[0]!);
  }

  async getDelivery(id: string): Promise<DeliveryAttemptDto | undefined> {
    const result = await this.pool.query<DeliveryRow>(`SELECT ${DELIVERY_COLUMNS} FROM delivery_attempts WHERE id = $1`, [id]);
    return result.rows[0] ? this.delivery(result.rows[0]) : undefined;
  }

  async claimDelivery(id: string): Promise<{ delivery: DeliveryAttemptDto; claimed: boolean } | undefined> {
    const claimed = await this.pool.query<DeliveryRow>(
      `UPDATE delivery_attempts SET status = 'SUBMITTING' WHERE id = $1 AND status IN ('PENDING', 'FAILED') RETURNING ${DELIVERY_COLUMNS}`,
      [id],
    );
    if (claimed.rows[0]) return { delivery: this.delivery(claimed.rows[0]), claimed: true };
    const existing = await this.getDelivery(id);
    return existing ? { delivery: existing, claimed: false } : undefined;
  }

  async updateDelivery(id: string, status: DeliveryStatus, requestId: string, response: Record<string, unknown>): Promise<DeliveryAttemptDto | undefined> {
    const result = await this.pool.query<DeliveryRow>(
      `UPDATE delivery_attempts SET status = $2, request_id = $3, response_json = $4::jsonb WHERE id = $1 RETURNING ${DELIVERY_COLUMNS}`,
      [id, status, requestId, JSON.stringify(response)],
    );
    return result.rows[0] ? this.delivery(result.rows[0]) : undefined;
  }

  async appendAudit(input: Omit<AuditEventDto, "id" | "occurredAt">): Promise<AuditEventDto> {
    const result = await this.pool.query<AuditRow>(
      `INSERT INTO audit_events(id, release_id, type, actor, payload_json) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING ${AUDIT_COLUMNS}`,
      [randomUUID(), input.releaseId, input.type, input.actor, JSON.stringify(input.payload)],
    );
    return this.audit(result.rows[0]!);
  }

  async listAudit(filter: AuditFilter = {}): Promise<AuditEventDto[]> {
    if (filter.projectIds?.length === 0) return [];
    const values: unknown[] = [];
    const clauses: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      clauses.push(`${column} = $${values.length}`);
    };
    if (filter.releaseId) add("release_id", filter.releaseId);
    if (filter.projectIds) {
      values.push(filter.projectIds);
      clauses.push(`release_id IN (SELECT id FROM releases WHERE project_id = ANY($${values.length}::uuid[]))`);
    }
    if (filter.actor) add("actor", filter.actor);
    if (filter.type) add("type", filter.type);
    if (filter.after) {
      values.push(filter.after);
      clauses.push(`occurred_at > $${values.length}`);
    }
    values.push(filter.limit ?? 100);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.pool.query<AuditRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_events ${where} ORDER BY occurred_at, id LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => this.audit(row));
  }

  async createWorkflowRun(releaseId: string, graphVersion: string): Promise<WorkflowRunRecord> {
    const result = await this.pool.query<WorkflowRunRow>(
      `INSERT INTO workflow_runs(id, release_id, graph_version, status) VALUES ($1, $2, $3, 'RUNNING') RETURNING ${RUN_COLUMNS}`,
      [randomUUID(), releaseId, graphVersion],
    );
    return this.workflowRun(result.rows[0]!);
  }

  async updateWorkflowRun(id: string, status: WorkflowRunRecord["status"], checkpoint: Record<string, unknown>): Promise<WorkflowRunRecord | undefined> {
    const result = await this.pool.query<WorkflowRunRow>(
      `UPDATE workflow_runs SET status = $2, checkpoint_json = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
      [id, status, JSON.stringify(checkpoint)],
    );
    return result.rows[0] ? this.workflowRun(result.rows[0]) : undefined;
  }

  async listWorkflowRuns(releaseId: string): Promise<WorkflowRunRecord[]> {
    const result = await this.pool.query<WorkflowRunRow>(`SELECT ${RUN_COLUMNS} FROM workflow_runs WHERE release_id = $1 ORDER BY created_at, id`, [releaseId]);
    return result.rows.map((row) => this.workflowRun(row));
  }

  private async insertFinding(client: DatabaseClient, releaseId: string, finding: NewFinding): Promise<FindingDto> {
    const result = await client.query<FindingRow>(
      `INSERT INTO findings(id, release_id, severity, code, message, source, status, evidence_json, suggested_action)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING ${FINDING_COLUMNS}`,
      [randomUUID(), releaseId, finding.severity, finding.code, finding.message, finding.source, finding.status, JSON.stringify(finding.evidence ?? {}), finding.suggestedAction ?? null],
    );
    return this.finding(result.rows[0]!);
  }

  private project(row: ProjectRow): ProjectDto {
    return { id: row.id, name: row.name, createdAt: this.iso(row.createdAt) };
  }

  private release(row: ReleaseRow): ReleaseRecord {
    return { ...this.releaseSummary(row), projectId: row.projectId, ruleSetId: row.ruleSetId, deadline: row.deadline ? this.iso(row.deadline) : null, version: row.version, createdAt: this.iso(row.createdAt) };
  }

  private releaseSummary(row: ReleaseRow): ReleaseSummaryDto {
    return { id: row.id, episode: row.episode, territory: row.territory, platform: row.platform, language: row.language, state: row.state, updatedAt: this.iso(row.updatedAt) };
  }

  private asset(row: AssetRow): AssetDto {
    return { ...row, metadata: row.metadata ?? {}, createdAt: this.iso(row.createdAt) };
  }

  private finding(row: FindingRow): FindingDto {
    return {
      id: row.id,
      code: row.code,
      severity: row.severity,
      message: row.message,
      source: row.source,
      status: row.status,
      evidence: row.evidence ?? {},
      suggestedAction: row.suggestedAction ?? undefined,
      createdAt: this.iso(row.createdAt),
    };
  }

  private action(row: ActionRow): ActionDto {
    return { ...row, input: row.input ?? {}, output: row.output ?? null, createdAt: this.iso(row.createdAt) };
  }

  private approval(row: ApprovalRow): ApprovalDto {
    return { ...row, decidedAt: this.iso(row.decidedAt) };
  }

  private delivery(row: DeliveryRow): DeliveryAttemptDto {
    return { ...row, response: row.response ?? {}, createdAt: this.iso(row.createdAt) };
  }

  private audit(row: AuditRow): AuditEventDto {
    return { ...row, payload: row.payload ?? {}, occurredAt: this.iso(row.occurredAt) };
  }

  private workflowRun(row: WorkflowRunRow): WorkflowRunRecord {
    return { ...row, checkpoint: row.checkpoint ?? {}, createdAt: this.iso(row.createdAt), updatedAt: this.iso(row.updatedAt) };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}

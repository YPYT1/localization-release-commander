# Implementation plan

Status: Accepted — 2026-09-04

## Outcome

Deliver a runnable production-oriented MVP in one pnpm monorepo: marketing site, operational workspace, NestJS API, persistent domain model, deterministic subtitle QC and repair, LangGraph workflow, approval/delivery simulation, audit trail, tests and local deployment.

## Workstreams

1. Domain/API: PostgreSQL repositories, REST endpoints, validation, idempotency and audit.
2. Agent/QC: SRT/TTML, rules, repair, rights checks, workflow and deterministic platform simulation.
3. Web: marketing pages and complete operations workspace against the API contract.
4. Integration: shared contracts, environment, containers, seed/demo path, CI and E2E verification.

## Completion gates

- A1–A7 from `docs/02-scope-acceptance.md` have runnable assertions.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- Local API and web surfaces pass browser/API smoke tests.
- A complete demo Release can be created, validated, repaired/approved, submitted and audited.
- Documentation and README match observed behavior.
- The final commit is pushed and local `main` matches `origin/main`.

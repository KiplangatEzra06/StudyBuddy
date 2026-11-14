# Phase 1 Backlog — Core Infrastructure and Security

## Status and scope

This backlog follows the user-supplied review's statement that approved Stage 12 defines Phase 1 as **Core Infrastructure and Security**. The underlying twelve-stage source files were not present in the repository to independently verify the roadmap text. This document is a proposal for approval; it is **not authorization to begin implementation**.

Do not include broad AI orchestration or local-to-cloud feature migrations in Phase 1 unless a security/infrastructure dependency requires them and the scope is separately approved. Preserve the existing modular monolith and avoid unnecessary complexity for a solo developer.

## Priority and dependency order

Complexity: S = small, M = medium, L = large. Estimates are relative planning estimates, not calendar commitments.

### P1. Establish canonical configuration and safe setup

- **Objective:** Reconcile required environment variable documentation; decide whether to add a safe `.env.example` containing names/placeholders only; validate startup configuration consistently.
- **Files/modules:** `server.js`, `backend/app/index.js`, `db/pool.js`, `README.md`, `backend/README.md`, potential `.env.example`.
- **Dependencies:** Confirm production/local variable contract; no secrets in template.
- **Expected outcome:** One authoritative setup path and explicit startup failure behavior.
- **Acceptance criteria:** Every required variable is documented once and consistent; `.env.example` (if approved) has no real values; environment validation tests cover missing/invalid required settings.
- **Verification:** Automated config tests; review `npm start`/migration instructions using a disposable local configuration.
- **Migration/rollback:** Documentation/config validation only initially; do not alter deployed environment. Roll back template/config changes without changing app secrets.
- **Risks:** Accidentally expose secrets or change production startup behavior.
- **Complexity:** S–M.

### P2. Decide database migration and recovery baseline

- **Objective:** Choose versioned migration history and define backup/restore expectations before expanding schema.
- **Files/modules:** `db/schema.sql`, `db/migrate.js`, `db/pool.js`, `package.json`, deployment/runbook docs.
- **Dependencies:** P1 configuration; access to a dedicated test database; owner approval of RPO/RTO and migration policy.
- **Expected outcome:** Documented, ordered migration process and recoverability plan with no destructive migration.
- **Acceptance criteria:** Migration history is reviewable; rerun behavior is tested; backup/restore procedure is documented and a restore is verified on a non-production database; production migration execution point is explicit.
- **Verification:** Dedicated `TEST_DATABASE_URL` integration run; migration against disposable fresh and representative existing schemas; restore drill.
- **Migration/rollback:** Preserve existing schema/data; no automatic production migration until separately approved; provide forward repair/restore plan for non-reversible changes.
- **Risks:** Schema drift, downtime, data loss, untested recovery.
- **Complexity:** M–L.

### P3. Define identity, authorization, and ownership boundaries

- **Objective:** Keep current single-admin behavior explicit and establish an authorization/ownership design before any multi-user expansion.
- **Files/modules:** `backend/routes/auth.js`, `backend/middleware/request.js`, controllers/repositories, `db/schema.sql` only after approval.
- **Dependencies:** Product decision on single-user versus future multi-user; data ownership inventory; P2 migration/recovery strategy before schema changes.
- **Expected outcome:** Consistent server-derived identity and a documented owner-check contract for every server-backed resource.
- **Acceptance criteria:** Each protected read/update/delete has an ownership decision; client-supplied owner IDs are never trusted; cross-owner tests exist before enabling multiple users; current single-admin flows remain compatible.
- **Verification:** Request/repository authorization tests, including negative cross-owner cases, using dedicated DB fixtures.
- **Migration/rollback:** Do not add owner columns or alter existing data until strategy and backfill are approved; migration must preserve existing admin data.
- **Risks:** Unauthorized record access or lockout if identity changes are rushed.
- **Complexity:** M–L.

### P4. Harden API request validation and security policy

- **Objective:** Audit and standardize request size/type validation, CSRF/session handling, rate limits, error responses, and security headers for all API routes.
- **Files/modules:** `backend/app/index.js`, `backend/middleware/`, `backend/routes/`, controllers, `frontend/services/api.js`.
- **Dependencies:** P1 config and P3 identity/authorization contract.
- **Expected outcome:** Explicit, consistent API security boundary with safe failure behavior.
- **Acceptance criteria:** Every endpoint has a documented auth/CSRF/body-size/validation policy; negative tests cover malformed, oversized, unauthenticated, and unauthorized requests; public health/auth exceptions are explicit.
- **Verification:** Request-level tests and security-focused regression tests; inspect production proxy/cookie settings before release.
- **Migration/rollback:** Maintain current API shapes and cookie behavior unless a change is separately approved; deploy incrementally and retain rollback config.
- **Risks:** Breaking clients or blocking legitimate uploads/AI requests.
- **Complexity:** M.

### P5. Secure file handling and untrusted-content boundaries

- **Objective:** Document and test upload validation, content type/size limits, extracted-content handling, retention/deletion, and prompt-injection boundaries.
- **Files/modules:** `backend/services/assignment-briefs.js`, `backend/controllers/assignment-briefs.js`, `backend/config/prompts.js`, `backend/controllers/ai.js`, frontend document/brief features.
- **Dependencies:** P4 API limits; product decision about source-file retention; storage audit.
- **Expected outcome:** Secure, transparent file lifecycle and explicit treatment of retrieved content as untrusted.
- **Acceptance criteria:** Supported type/size and actual-content checks are tested; upload limits enforced; stored metadata/text and non-retained bytes are clearly distinguished; untrusted text cannot alter backend authorization or assessment policy; deletion behavior is documented and tested.
- **Verification:** Unit/request tests for malformed and adversarial content; verify no source file bytes are claimed retained; no OCR added (deferred beyond v1).
- **Migration/rollback:** Do not add object storage or alter retention without approval; preserve current assignment-brief API payloads.
- **Risks:** Malicious files, prompt injection, unexpected retention, privacy exposure.
- **Complexity:** M.

### P6. Establish privacy, retention, and governance foundations

- **Objective:** Document data categories, provider transmission, retention/deletion expectations, student/age safeguards, and incident ownership.
- **Files/modules:** `docs/`, AI provider boundary, backup/export/deletion paths; application changes only after policy approval.
- **Dependencies:** P3 ownership; P5 file lifecycle; provider terms and target-user/jurisdiction decisions.
- **Expected outcome:** Reviewable privacy/governance baseline that prevents implicit reuse of student data.
- **Acceptance criteria:** Data flows and retention are documented; conversations/uploads are explicitly not automatic training data; deletion/export scope is mapped across stores; unresolved legal/age requirements are recorded, not guessed.
- **Verification:** Documentation review against actual data flows and provider configuration; deletion/export tests where behavior is implemented.
- **Migration/rollback:** Policy decisions precede behavior changes; preserve user data; do not delete records as a cleanup shortcut.
- **Risks:** Regulatory/privacy obligations and inconsistent data deletion.
- **Complexity:** M.

### P7. Improve logging, auditability, and operational monitoring

- **Objective:** Ensure operational errors are diagnosable without logging secrets, session tokens, or unnecessary study content.
- **Files/modules:** `db/pool.js`, `backend/app/index.js`, AI services/controllers, deployment and runbook docs.
- **Dependencies:** P1 environment contract; P6 data classification.
- **Expected outcome:** Consistent operational signal and documented incident/alert response appropriate to current scale.
- **Acceptance criteria:** Required failure categories are logged with correlation context; secret/private-content redaction is tested; health/readiness semantics are documented; alert and incident ownership is explicit.
- **Verification:** Log redaction tests; simulated DB/provider errors; health endpoint checks in non-production.
- **Migration/rollback:** No new telemetry vendor or service without measured need and approval; retain privacy-safe existing logs.
- **Risks:** Secret exposure, under-diagnosed outages, unnecessary infrastructure complexity.
- **Complexity:** M.

### P8. Build test and CI foundations

- **Objective:** Separate test layers and establish an automated, safe gate for code changes.
- **Files/modules:** `test/`, `package.json`, repository CI configuration (none identified at audit time).
- **Dependencies:** P1 test environment variables; dedicated database provisioning for DB tests.
- **Expected outcome:** Repeatable unit, request, database integration, browser E2E and security regression strategy.
- **Acceptance criteria:** CI runs current non-DB suite; DB tests run only against a dedicated DB and refuse production URL; critical auth/ownership/file/API regressions are covered; missing browser/E2E scope is explicit rather than implied.
- **Verification:** CI run on a branch/PR; `npm test`; `TEST_DATABASE_URL` integration run; browser test workflow for core persistence once selected.
- **Migration/rollback:** CI addition must not deploy or mutate production; use disposable fixtures and cleanup.
- **Risks:** Leaking secrets in CI, destructive tests, flaky checks.
- **Complexity:** M.

### P9. Verify deployment and operational release path

- **Objective:** Align documented Render settings, environment configuration, migrations, health checks, backups and smoke tests.
- **Files/modules:** `README.md`, `backend/README.md`, deployment settings/docs, release checklist.
- **Dependencies:** P1, P2, P4, P7, P8; deployment access and explicit user approval for production actions.
- **Expected outcome:** Documented release path with staging verification and rollback/restore steps.
- **Acceptance criteria:** Build/start/migrate sequence is unambiguous; production variable names are checked without exposing values; non-production smoke tests pass; production smoke test is separately authorized and recorded.
- **Verification:** Staging deployment and health/auth/core workflow smoke tests; production status remains Unverified until actually checked.
- **Migration/rollback:** No production deployment in this planning task; define rollback and DB recovery before release.
- **Risks:** Service interruption, migrations not applied, secrets/config drift.
- **Complexity:** M.

## Dependencies and sequence

`P1 → P2 → P3 → P4 → P5 → P6/P7 → P8 → P9`

P6 and P7 can proceed in parallel once ownership and data classification are agreed. Do not begin data migrations, multi-user access, new file storage, OCR, fine-tuning, or production deployment without their explicit decision/approval gates.

## Phase 1 exit criteria

- Infrastructure/security boundaries and configuration are documented and test-backed.
- Migration and restore strategy is approved and verified on non-production data.
- Authorization/ownership is explicit and negative tests exist for supported access scopes.
- File and untrusted-content handling has a documented, tested lifecycle.
- Privacy, logging, testing and deployment limitations are explicit.
- Current user workflows remain preserved by regression tests.
- The user has approved any production-impacting action.

## Out of scope until separate approval

- Implementing the full AI Tutor blueprint or new AI modes.
- General IndexedDB-to-PostgreSQL migration or synchronization engine.
- OCR, vector database, object storage, background queues, or microservices.
- Fine-tuning or using student content as training data.
- Any production database mutation or deployment.

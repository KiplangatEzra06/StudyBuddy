# Refactoring Plan

## Status and scope

This is a dependency-aware proposal only. The supplied review identifies the approved Phase 1 scope as Core Infrastructure and Security. No Phase 1 implementation or production change is authorized until the user explicitly approves the audit and plan.

The existing application is a modular monolith; do not rewrite it or introduce microservices. Preserve the PostgreSQL/IndexedDB hybrid direction. Migrations, new storage infrastructure, behavior changes and production actions require explicit decisions and safe verification.

## Principles

- Preserve existing workflows and user data.
- Resolve security and recovery foundations before expanding persistence or AI capabilities.
- Keep HTTP, business logic and data access boundaries clear; do not split components into services for appearance alone.
- Make changes small, testable and reversible.
- Distinguish approved requirements from proposed implementation choices.
- Do not add OCR in v1; keep future document processing extensible.
- Do not treat activity as mastery or student content as automatic training data.

## Phase 1 sequence: core infrastructure and security

### 1. Canonical configuration and safe setup

Reconcile environment variable requirements, missing `.env.example` reference, startup validation, and local/deployment instructions. Template values must be names/placeholders only. Preserve existing startup behavior until tests and deployment expectations are explicit.

### 2. Database migration, backup and recovery

Choose a migration-history approach and define backup/restore objectives before schema growth. Test migration and restore against disposable/non-production databases. Do not run automatic production migrations or destructive changes without a separate approved release plan.

### 3. Identity, authorization and data ownership

Document the current single-admin scope and define ownership checks for every server-backed resource. If multi-user access is approved later, add schema/backfill, repository scoping, and cross-owner tests before exposing it. Do not silently convert the current admin identity model.

### 4. API and file security

Audit route validation, body/content-type limits, CSRF/session policy, rate limiting, error responses, file processing and untrusted AI context. Preserve API shapes unless separately approved. Document assignment brief metadata/text versus original bytes accurately. Assessment restrictions must be enforced by backend policy, not prompt text alone.

### 5. Privacy, governance and safe observability

Map sensitive data flows and retention/deletion. Keep uploaded/retrieved material untrusted. Conversations and uploaded materials are not training data by default. Establish useful logging/health/incident practices without exposing credentials, session tokens or unnecessary learning content.

### 6. Automated verification foundations

Maintain current unit/request tests, enable dedicated database integration, add security regression coverage, then select browser E2E coverage for IndexedDB-critical workflows. Add CI only with safe test isolation; tests must not use production database credentials.

### 7. Deployment/release verification

Align Render documentation with config, migration, backup, smoke-test and rollback procedures. Deployment remains unverified until a staging/live smoke test is actually run. Production action requires explicit user approval.

The detailed objective, dependencies, acceptance criteria, verification, rollback, risks and complexity for each item are in `PHASE_1_BACKLOG.md`.

## Subsequent architecture work (not Phase 1 authorization)

After infrastructure/security completion and explicit approval:

1. Define per-feature data ownership and lifecycle contracts; decide local versus server authority per domain.
2. Refine AI orchestration boundaries (provider gateway, prompt/context building, response validation, evaluation) without presuming separate deployable services.
3. Implement distinct Tutor modes and adaptive policies, separating ordinary tutoring from backend-enforced assessment restrictions.
4. Define knowledge source provenance/retrieval, document processing formats, and future OCR extension. OCR stays deferred beyond v1.
5. Define memory visibility, correction, retention, deletion and synchronization before storing learner memories.
6. Develop adaptive learning measures only with validated evidence; keep mastery, confidence, recency and consistency distinct. Activity/completion alone is not mastery.
7. Add exam prediction only after the rule requiring three verified papers is enforced; below threshold, provide descriptive analysis only.
8. Decompose large feature modules only where bounded responsibilities and tests justify it.

These are architectural directions, not approved implementation choices for new vendors, schemas, models or policies. Resolve related items in `TECHNICAL_DECISION_LOG.md` first.

## Features to preserve

- Single-admin session authentication and current API behavior.
- Flashcard/deck workflows, import safeguards, and SM-2 review scheduling.
- Local documents, notes, classes, assignments, quizzes, timer history and Tutor conversations.
- Assignment brief validation and current server persistence behavior.
- Tutor source grounding, while addressing the general prompt's direct-answer conflict in a separately approved behavior change.
- Backup/export/import and undo behavior.

## Migration and rollback strategy

1. Capture current schema, record shapes and baseline tests before changing persistence.
2. Use a dedicated test database and representative fixtures; never reset production.
3. For any local-data migration, preserve the original IndexedDB data and backup until import counts/content are verified.
4. Make imports idempotent and define conflict/deletion behavior before enabling sync.
5. Deploy schema changes through an approved, staged procedure with a tested recovery path.
6. Change reads/writes behind reversible, bounded steps; keep old reads or exports until the new path is verified.
7. Record migration outcome and rollback trigger. A passing unit test is not a migration or production verification.

## Stop conditions

Pause for approval if a change requires destructive migration, changes user-facing Tutor assessment behavior, adds a dependency/vendor/service, changes retention of user material, expands to multiple users, or deploys to production.

# StudyBuddy Development Log

**Version:** 0.1  
**Purpose:** Maintain a chronological record of implementation, decisions, defects, and releases.

## 2026-11-14 — Phase 0 review corrections

**Status:** Implemented (documentation corrections); production/runtime claims remain Unverified

- Corrected the Phase 0 system, feature, storage, and gap analyses against the actual repository, including migration history, deployment artifacts, test-layer limitations, Tutor behavior, local retrieval, and current storage ownership.
- Replaced the proposed Phase 1 backlog with a dependency-aware Core Infrastructure and Security proposal, as identified by the supplied Stage 12 review. Updated the refactoring plan and technical roadmap to keep Phase 1 distinct from later AI architecture work.
- Expanded the decision log with explicit statuses and unresolved blueprint decisions. Added `docs/architecture/PHASE_0_REVIEW_RESPONSE.md`.
- Confirmed during inspection that storage uses the native IndexedDB API (not the `idb` package), `.env.example` is absent, and the checked-in feature module line counts differ from the submitted review.
- No application code, prompts, APIs, schema, dependencies, or production services were changed.
- Verification: inspected relevant code/docs and repository inventory. No tests were rerun because this change is documentation-only; the latest prior `npm test` run reported 24 passed, 0 failed, 1 skipped (dedicated `TEST_DATABASE_URL` unavailable).
- Open: production smoke/backup verification, browser E2E, database integration, and independent access to all twelve blueprint source documents remain outstanding. Phase 1 requires explicit approval.

## 2026-11-10 — Groq AI provider migration

**Status:** Implemented

- Replaced active Ollama calls with one OpenAI-compatible AI service, Groq model fallback on rate limits, per-model cooldowns, and token-budget protection.
- Added an authenticated AI health endpoint and documented the required `AI_*` environment variables, local check, and Render settings.
- Removed the unused Ollama transport and `node-fetch` dependency; the OpenAI SDK requires Node.js 22 or newer.
- Preserved Tutor step-by-step assignment guidance and frontend rendering.
- Verification: `npm test` passed; AI fallback and budget behavior passed mock-provider checks. The database integration test was skipped because `TEST_DATABASE_URL` was not set.
- Open: `.env.example` was already deleted in the worktree and was left deleted at the user's request. The assignment-brief UI's existing Ollama wording remains unchanged because frontend files were out of scope.

## 1. Project baseline

- Live application: https://studybuddy2-r2i6.onrender.com/
- Repository: https://github.com/KiplangatEzra06/StudyBuddy
- Planning baseline: November 2026.
- Product direction: all-in-one learning workspace.
- AI direction: adaptive and context-aware.
- Experience direction: hybrid.
- December direction: reimagine the complete product experience.

Repository documentation describes an Express/Node backend, native JavaScript ES-module frontend, Neon PostgreSQL, `pg`, server-side sessions, Render deployment, and Groq through an OpenAI-compatible AI service. It also documents a mixture of PostgreSQL persistence and IndexedDB persistence. Verify these details against current code before relying on them.

## 2. Current priorities

1. Audit current storage and module boundaries.
2. Establish a clear data ownership model.
3. Move durable learning data toward cloud persistence safely.
4. Preserve existing feature behavior during refactoring.
5. Improve AI tutor context and learning workflows.
6. Stabilize and prepare for the December UX transformation.

## 3. Decision register

| Date | Decision | Rationale / impact |
|---|---|---|
| 2026-11 | Product identity: all-in-one learning workspace | Connect organization, learning, practice, and reflection |
| 2026-11 | AI tutor: adaptive | Use relevant learning context rather than generic chat alone |
| 2026-11 | Experience: hybrid | Combine a personal workspace with focused feature workspaces |
| 2026-11 | December: reimagine | Revisit journeys and information architecture before visual implementation |
| 2026-11 | Storage: cloud-first | Improve durability and support independent user data |
| 2026-11 | Early testing: one primary tester | Keep testing practical while validating multi-user isolation technically |

Add exact dates and rationale when decisions are finalized.

## 4. Milestone plan

| Period | Focus | Expected evidence |
|---|---|---|
| Nov 9–15 | Audit and architecture | Feature map, storage inventory, defect list, migration plan |
| Nov 16–22 | Module separation and storage pilot | Cloud-backed pilot, migration verification, ownership tests |
| Nov 23–29 | AI tutor and integrations | Context-aware workflows, persisted conversations, generation review |
| Nov 30 | Stabilization | Regression results, production smoke test, release notes |
| December | UX reimagination | UX audit, flows, wireframes, design system, implementation plan |

## 5. Defect register

| ID | Issue | Severity | Status | Evidence / notes |
|---|---|---|---|---|
| SB-001 | Populate during the November audit | — | Open | Record reproducible steps and affected workflow |
| SB-002 | Populate during the November audit | — | Open | Record expected vs actual behavior |

Do not leave vague defects in the register. Include steps to reproduce, expected behavior, actual behavior, environment, and relevant logs.

## 6. Work entry template

Copy this section for each meaningful work session.

### YYYY-MM-DD — Short title

**Goal:**  
What outcome was targeted?

**Changes made:**
- Files/modules changed
- Schema/API changes
- UI or workflow changes

**Verification:**
- Tests run
- Manual workflows checked
- Production behavior checked, if deployed

**Results:**  
What passed? What failed?

**Risks / follow-up:**
- Known limitations
- Migration or compatibility concerns
- Next action

## 7. Release checklist

### Before deployment
- [ ] Review changes and environment variables.
- [ ] Confirm database migrations are safe and ordered.
- [ ] Run automated tests.
- [ ] Verify authentication and ownership checks.
- [ ] Confirm existing core workflows still work.
- [ ] Check error handling and logs.
- [ ] Update relevant documentation.

### After deployment
- [ ] Confirm the service starts successfully.
- [ ] Sign in and sign out.
- [ ] Create, edit, and retrieve representative records.
- [ ] Refresh and start a new session to verify persistence.
- [ ] Verify user data isolation where multi-user access is enabled.
- [ ] Test critical feature integrations.
- [ ] Record deployment version, date, and outcome.

## 8. Evidence discipline

A repository test result is not proof that the live deployment works. A screen existing is not proof that its workflow is complete. Mark claims as implemented only when supported by code inspection and an appropriate test. Record unverified behavior explicitly.

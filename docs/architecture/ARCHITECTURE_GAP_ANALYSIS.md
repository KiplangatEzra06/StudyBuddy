# Architecture Gap Analysis

## Scope and status terms

This comparison uses the approved Phase 0 blueprint supplied by the user and the repository code inspected for this audit. The exact twelve separate blueprint source documents were not found in the repository; constraints explicitly included in the supplied blueprint are retained here, while omitted stage-level details remain unverified.

Statuses: **Implemented**, **Partially implemented**, **Missing**, **Conflicting**, and **Requires verification**. A visible UI or code path alone is not proof of a complete workflow.

## Approved architecture versus current implementation

| Requirement | Status | Evidence / gap |
|---|---|---|
| Modular monolith, one deployable backend, no premature microservices | Implemented | Express app composition and domain routes; no microservices. |
| Incremental, dependency-driven transformation and preservation | Approved; implementation planning only | Existing app is maintained; no Phase 1 work is authorized yet. |
| Coherent feature-based frontend, shared conventions and clear API boundary | Partially implemented | Native ES modules, services, shared state and event bus; no formal component/state system. |
| PostgreSQL authority for server-backed records | Partially implemented | Sessions, decks/cards/reviews, assignment workspace snapshots. Other workspace records remain local. |
| IndexedDB for approved offline/local caching and queued operations | Partially implemented | Native IndexedDB key/value store exists; no formal general queue/sync protocol. |
| Explicit ownership of files, extracted text, metadata, chunks, embeddings | Partially implemented | Brief metadata/text exists in PostgreSQL; document content is mostly local; no object or vector storage. |
| Secure authentication, authorization and resource ownership | Partially implemented | Single-admin cookie session and request guards exist; multi-user authorization is not implemented for cards/decks. |
| AI integration behind reusable boundary | Partially implemented | Provider adapter/fallback exists; orchestration concerns are spread across controllers and services. |
| Operational readiness (migration, backups, CI, monitoring) | Requires verification / missing pieces | Idempotent schema script exists but is unversioned; no CI workflow found; backup/production operation not verified. |

## Twelve logical product domains

| Logical domain | Current state | Gap and next boundary |
|---|---|---|
| Authentication | Single-admin session authentication implemented | Authorization remains single-user; define ownership scope before multi-user use. |
| Courses | Classes are browser-local | No explicit Courses domain/API or server persistence. |
| Materials | Local documents/notes and browser-selected Tutor references | No server-managed material repository, OCR, object store or vector retrieval. |
| AI Tutor | Tutor API and local history exist | One general behavior is too prescriptive; six approved modes are not established as distinct policy contracts. |
| AI Orchestration | Provider call, fallback, token budgeting exist | Model Gateway, Prompt Manager, Context Manager, Tool Registry, usage monitoring and response contract are not complete logical modules. |
| Learning Engine | Flashcard reviews and SM-2 exist | No separate mastery/confidence/recency/consistency model or learning-objective graph. Activity must not equal mastery. |
| Assessments | Quiz generation and local results exist | No structured evaluation engine; Test Mode restrictions are not enforced in backend logic. |
| Memory Manager | Tutor conversations stored locally | Five logical memory domains and learner controls are not implemented. |
| Insights | Review topic stats and progress UI exist | No validated multi-dimensional learner model; activity metrics must not overstate mastery. |
| Productivity | Timer, assignments, classes, calendar exist locally | Persistence and cross-feature ownership remain local; broader cloud authority not implemented. |
| Evaluation | Selected schema/response validation and unit tests exist | No AI evaluation suite for academic accuracy, pedagogy, grounding, critical failures, or monitoring. |
| Governance | Session hardening, limits, and some prompt injection boundaries exist | Privacy/retention, age safeguards, deletion propagation, incident response and provider policy controls remain unspecified. |

## AI Tutor blueprint capability comparison

| Capability / constraint | Status | Finding |
|---|---|---|
| Understanding, adaptation, guidance, evidence and progress principles | Partially implemented | Grounding and structured feedback exist; broad behavior is not consistently adaptive. |
| Adaptive direct-first or guided-first teaching; honor explicit direct-answer request in ordinary tutoring | Conflicting | `backend/config/prompts.js` says never complete or reveal an answer even if asked. This conflicts with approved behavior. Assignment-specific academic-integrity rules may remain restrictive. |
| Subject/topic/objective adaptation; distinct mastery, confidence, recency and consistency | Missing | Current review scheduling is not this learner model. Completing activity must never establish mastery. |
| Eight teaching methodologies | Partially implemented | The prompt supports step-by-step guidance, but no methodology selection/evaluation contract was identified. |
| Six modes: Learn, Practice, Revise, Test, Explain, Apply | Missing / requires verification | No explicit six-mode API or backend policy model was identified. Test Mode must not rely on prompt instructions alone. |
| Context authority, source conflict/missing-source handling | Partially implemented | Browser-supplied references are wrapped as untrusted and source metadata is validated; no server-managed retrieval pipeline or source conflict model. |
| OCR deferred beyond v1; extensible document pipeline | Deferred | No OCR identified. Keep a future extension seam; do not add OCR in v1 without approval. |
| Examination prediction threshold (at least 3 verified papers) | Missing | No exam prediction workflow or enforcement gate found. Below threshold must remain descriptive-only; predictions must never be guaranteed. |
| Five logical memory domains and user visibility/control | Missing | Tutor history is local; persistent learner memory and deletion controls are not implemented. |
| AI orchestrator component set | Partially implemented | Some provider, context-by-client, prompt, and validation pieces exist; no complete set of Orchestrator, Model Gateway, Prompt Manager, Context Manager, Retrieval Engine, Memory Manager, Response Validator, Tool Registry, Evaluation Engine and Usage Monitor. |
| Evidence-driven model improvement; no automatic training from student data | Partially implemented / no fine-tuning found | No fine-tuning pipeline was found. Conversations and uploaded materials must not become training data automatically. |
| Evaluation layers and critical-failure gates | Partially implemented | Unit/request tests exist; AI pedagogy evaluations, adversarial tests, browser E2E and production smoke checks are absent/unverified. |
| Defense in depth and untrusted-content controls | Partially implemented | Session controls, input checks, upload validation and untrusted reference delimiters exist; complete authorization, scanning, retention and incident controls are not established. |

## Prioritized technical debt and risks

No evidence supports labeling an observed issue “Critical” at this stage. Priorities below are practical architectural risks, not confirmed production incidents.

| Priority | Finding and evidence | Why it matters | Recommended resolution / dependency |
|---|---|---|---|
| High | General Tutor prompt prohibits direct solutions in all cases (`backend/config/prompts.js`). | Conflicts with approved adaptive ordinary tutoring; may block user-directed learning. | Define mode/context policy with a distinct backend-enforced assessment boundary. Do not edit prompts during Phase 0. |
| High | Server records are not generally user-scoped; single-admin setup; `cards`/`decks` schema has no owner field. | Multi-user rollout without migration and authorization would risk cross-user access. | Keep single-admin scope explicit; design/test ownership before enabling multi-user. |
| High | Idempotent whole-schema migration lacks version ledger; start does not migrate; no backup procedure verified. | Harder to diagnose ordered changes or recover safely. | Decide versioned migration and backup/recovery policy before schema expansion. |
| High | No CI, DB integration test was skipped, no browser E2E or production smoke test. | Passing current tests cannot establish persistence or production reliability. | Add test layers and a safe CI/deployment verification path. |
| Medium | IndexedDB write helper returns `false` on failure and `undefined` on failed reads; callers vary in result checking. | Failed saves may be mistaken for success. | Inventory callsites and establish explicit save error UX/test coverage. |
| Medium | Tutor references are indexed/retrieved in the browser and sent with requests. | Not a server-managed, independently authorized knowledge retrieval system; client selection is not a trusted authority. | Define server-side access/context contract before moving to retrieval infrastructure. |
| Medium | No original brief-file object storage; only metadata/extracted text persisted. | Users may assume uploaded files can be retrieved after attachment. | Explicitly define retention and product UX; select storage only if required. |
| Medium | `.env.example` absent; `backend/README.md` references it. | New local setups lack a checked-in variable-name template. | Decide and document a safe template containing names/placeholders only. |
| Medium | Outdated Ollama wording remains in `public/index.html`. | Misleads users about provider/data handling. | Correct as a separate approved product-copy task; preserve backend behavior. |
| Low | Large feature modules (verified sizes below). | Increases change/review complexity, but size alone is not a defect. | Decompose only when a bounded functional responsibility is identified. |

In this checkout, `frontend/features/notes.js` is 1,132 lines, `tutor.js` 746, and `flashcards.js` 656. These differ from the counts in the submitted review; actual repository counts are used here.

## Features to preserve

- Single-admin authentication/session behavior and current protections.
- Flashcard persistence, import safeguards, and SM-2 review scheduling.
- Local notes, documents, classes, assignments, quiz results, timer sessions and Tutor history.
- Tutor source-grounding behavior, while correcting its general-versus-assessment policy in a later approved task.
- Assignment brief validation and persistence behavior.
- Existing export/import and undo workflows.

## Refactoring direction

Phase 1 must follow the approved **Core Infrastructure and Security** scope, not replace it with architecture cleanup. First establish configuration, migration/recovery, identity/authorization boundaries, API/file/input controls, privacy/logging/monitoring, tests/CI and deployment verification. Only after these foundations are reviewed should AI orchestration and feature-module decomposition proceed. See `PHASE_1_BACKLOG.md` and `REFACTORING_PLAN.md`.

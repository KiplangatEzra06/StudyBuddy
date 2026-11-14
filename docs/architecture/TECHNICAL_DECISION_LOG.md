# Technical Decision Log

## Status vocabulary

- **Approved** — product/architecture constraint approved in the supplied blueprint.
- **Implemented** — verified in code and by relevant evidence.
- **Partially implemented** — some code exists, but the approved behavior is incomplete.
- **Proposed** — recommendation for review; not authorization to implement.
- **Unresolved** — options remain open; approval is required.
- **Deferred** — explicitly out of current scope or postponed.

An approved target is not automatically implemented. No decision in this log authorizes Phase 1 implementation.

## Approved architectural and product constraints

| Decision / constraint | Status | Current evidence and implementation status |
|---|---|---|
| Modular monolith, one deployable backend initially; no premature microservices | Approved; Implemented in broad structure | Express app composition and domain route/controller/service/repository folders. |
| Incremental, dependency-driven transformation; preserve working features | Approved | This is the required approach; Phase 1 has not been approved or started. |
| One feature-based modular frontend with shared conventions and clear API boundary | Approved; Partially implemented | Native ES modules, shared state/event bus, API service; no formal state-management/component system. |
| Progressive cloud architecture; add services only when requirements justify them | Approved | Current app uses PostgreSQL and browser persistence; no object/vector/queue services identified. |
| PostgreSQL authoritative for server-backed records | Approved; Partially implemented | Sessions/cards/reviews/assignment workspace stored in PostgreSQL; several workspace domains remain local-only. |
| IndexedDB for approved offline caching/local queued operations | Approved; Partially implemented | Native IndexedDB key/value store exists; general queue/sync is not implemented. |
| Explicit ownership/relationships for original files, extracted text, metadata, chunks and embeddings | Approved; Partially implemented | Assignment extracted text/metadata exist; original upload bytes, chunk/embedding server models are absent. |
| Tutor philosophy: understanding, adaptability, guidance, evidence, progress | Approved; Partially implemented and partly Conflicting | Sources are grounded; generic prompt enforces guided-only behavior, conflicting with adaptive/direct-first teaching. |
| Ordinary tutoring can adapt between direct-first and guided-first; honor direct answer requests | Approved; Conflicting in general prompt | `backend/config/prompts.js` prohibits direct answers universally. Assignment/test restrictions must be a separate policy. |
| Six distinct modes: Learn, Practice, Revise, Test, Explain, Apply | Approved; Missing as explicit mode contract | No distinct backend mode/policy model identified. |
| Eight teaching methodologies; adapt correction strategy | Approved; Partially implemented | Some stepwise teaching exists; no methodology selector or evaluation contract identified. |
| Mastery, confidence, recency and consistency remain distinct; activity alone never establishes mastery | Approved; Missing | SM-2 tracks card scheduling, not a validated multi-dimensional learner model. |
| Broader learning progression changes are student-reviewable recommendations | Approved; Missing | No such recommendation workflow identified. |
| Source authority distinguishes course material, supplementary knowledge, conflicts and missing evidence | Approved; Partially implemented | Prompt/source validation exists; no formal conflict-resolution or evidence authority model. |
| OCR deferred beyond v1; document processing remains extensible | Approved; Deferred | No OCR identified; keep future extension possible. |
| At least three verified exam papers before predictions; otherwise descriptive analysis only; never guarantee predictions | Approved; Missing | No examination prediction workflow or enforcement gate found. |
| Five memory domains (Learner Profile, Learning, Interaction, Session, Goal/Planning) with learner visibility/control | Approved; Missing | Tutor conversations are browser-local; persistent learner memory not identified. |
| Logical AI components: Orchestrator, Model Gateway, Prompt Manager, Context Manager, Retrieval Engine, Memory Manager, Response Validator, Tool Registry, Evaluation Engine, Usage Monitor | Approved; Partially implemented | Provider calls, prompts, local references and validation exist in pieces; complete logical architecture does not. These are not a mandate for separate services. |
| Improve prompts/retrieval/orchestration before fine-tuning; user conversations/materials/memories are not automatic training data | Approved; current fine-tuning Deferred | No fine-tuning pipeline found; no automatic training path identified. Maintain explicit consent/provenance if ever considered. |
| Evaluation includes unit/integration/AI/E2E/regression/adversarial tests; critical failures not hidden by averages | Approved; Partially implemented | Unit and request-level tests exist; AI pedagogy evaluations, browser E2E, adversarial coverage and critical-failure gates are missing/unverified. |
| Defense in depth: auth, backend authorization, ownership, secure APIs/files, untrusted inputs, privacy/age safeguards | Approved; Partially implemented | Session/request controls and some validation exist; multi-user ownership, age safeguards, retention and incident practices are not established. |

## Unresolved technical decisions

These are deliberately not resolved by this audit. Evidence/recommendations are advisory; owner approval is required before implementation.

| Question | Options | Evidence needed | Recommendation (not approval) | Impact | Status |
|---|---|---|---|---|---|
| What identity/authorization model follows the current single-admin product? | Keep single-admin; add RBAC; add ABAC; staged hybrid | Product/user scope, threat model, cross-user requirements | Keep single-admin until multi-user is explicitly scoped; design ownership seams before expansion | Auth, schema ownership, every repository/API | Unresolved |
| Which local domains become server-authoritative, and when? | Keep local; migrate selected domains; migrate all durable workspace data | User/device requirements, data sensitivity, usage/reliability evidence | Decide per domain; avoid blanket migration | Schema, APIs, import, support and privacy | Unresolved |
| What migration framework/history is appropriate? | Continue idempotent schema; versioned SQL files; established migration tool | Deployment cadence, rollback needs, current production schema | Select before schema growth; do not combine selection with an unreviewed migration | Outage/data recovery risk and deployment workflow | Unresolved |
| What backup and recovery targets are required? | Provider backup only; scheduled exports; PITR plus tested restore; hybrid | Database plan/features, RPO/RTO, cost, data policy | Define RPO/RTO and test restore before claiming recovery readiness | Operations and data loss exposure | Unresolved |
| Do users need uploaded source files to be retrievable? | Metadata/text only; object storage; browser-local original | User workflow, retention, file sizes/types, privacy | Clarify product expectation first; never imply bytes are retained when they are not | Storage vendor, deletion and access controls | Unresolved |
| How should offline queued operations synchronize? | No sync; per-domain queue; generic outbox with idempotency | Offline use cases, conflict cases, multi-device target | Start with explicit use case and conflict model, not a generic sync engine | IDs, retry, conflict, tombstones, UX | Unresolved |
| What retrieval architecture is required? | Browser lexical retrieval; server lexical retrieval; embeddings/vector; hybrid | Material volume, privacy, citation accuracy, latency/cost | Measure current needs; preserve source IDs and authorization regardless of index | Data model, provider/service choice, cost | Unresolved |
| How should Tutor choose methodology/mode and assess understanding? | User-selected mode; rules; model recommendation with user override; hybrid | Learning outcomes and evaluation data | Keep mode selection explicit and testable; separate ordinary tutoring from restricted assessments | Prompt/API policy, UX, AI evaluation | Unresolved |
| What are mastery/confidence/decay/prerequisite formulas? | Rule-based; evidence-weighted; calibrated model | Validated learning evidence and academic review | Do not equate activity or completion with mastery; retain separate measures | Learner profile, recommendations and trust | Unresolved |
| How should Test Mode and academic integrity restrictions work? | Backend policy by mode/context; institutional configuration; both | Assessment policy, user contexts, abuse cases | Enforce restrictions backend-side, not prompt-only | API contract and tutor UX | Unresolved |
| What exam-paper verification/provenance is sufficient? | User-confirmed; institution/source verified; reviewed metadata workflow | Source authority, duplicate detection, subject/exam identity | Require at least 3 verified papers; below that descriptive-only; never guarantee predictions | New assessment data and evaluation | Unresolved |
| What source conflict/citation/page-reference model is required? | Exact excerpts; page/section provenance; source hierarchy; hybrid | File formats, extraction fidelity, user needs | Preserve source identity/provenance at ingestion; do not invent citations | Document pipeline and Tutor trust | Unresolved |
| What file types, extraction libraries, tables/math/diagrams need support? | Current set; narrow supported formats; extensible adapters | Actual user files, quality tests, licensing/ops | Define supported v1 formats and quality limits; OCR remains deferred | Processing/security and storage | Unresolved |
| Should a vector store be added? | PostgreSQL only; PostgreSQL extension; external vector service; defer | Retrieval quality/scale measurements, data residency, cost | Defer until retrieval evaluation demonstrates need | Infrastructure, migration, deletion and privacy | Unresolved |
| What is the memory schema, retention, deletion and preference reconciliation model? | Local-only; server-owned; hybrid with explicit versioning | User control requirements, retention policy, offline conflict cases | Make inferred memories reviewable and deletable; never silently treat them as student facts | Privacy, account export/deletion, personalization | Unresolved |
| What model/provider routing, prompt versioning, cache and stream policy is needed? | Fixed provider; config-based fallback; task-based gateway | Reliability, latency, cost and provider privacy terms | Evolve behind one contract; record prompt/model versions when evaluation exists | Reliability, cost, observability | Unresolved |
| What AI evaluation thresholds/release gates are acceptable? | Golden datasets; expert review; automated benchmark; hybrid | Validated cases, critical failure taxonomy, reviewer variance | Add critical-failure gates separate from aggregate quality scores | CI, release safety and monitoring | Unresolved |
| Is fine-tuning ever justified? | Never; reconsider after evidence; selected opt-in dataset | Quality gap after prompt/retrieval work, consent/licensing, cost | Defer; no student data is training data by default | Data governance, model registry and deployment | Deferred |
| What privacy/age/residency/incident requirements apply? | Product-specific policy, jurisdictional policy, provider constraints | Target markets, user ages, legal review, provider terms | Obtain policy/legal input before expanding data collection | Consent, retention, deletion and vendors | Unresolved |
| What object storage, background queue and monitoring services are necessary? | None initially; managed services per measured need | File retention, workload, latency, alerting and cost | Keep deployment progressive; add services only against explicit requirements | Operations, cost, failure modes | Unresolved |
| What should replace missing `.env.example`? | Safe checked-in placeholder; generated setup docs; both | Variable contract and secret-handling convention | Add names and placeholders only after the canonical variable list is confirmed | Local setup and deployment consistency | Unresolved |

## Phase 1 scope and approval

The supplied review states that the approved Stage 12 roadmap defines **Phase 1 — Core Infrastructure and Security**. The underlying twelve blueprint files/Stage 12 roadmap were not found in the repository, so this scope is recorded from the user-supplied review rather than independently cross-checked against source files.

Phase 1 planning must prioritize configuration, authentication/authorization foundations, data ownership, migration/backup, API and file security, privacy/governance, logging/monitoring, tests/CI, and deployment verification. The backlog is a proposal only. **Phase 1 implementation is not approved and must not begin until explicit user approval.**

## Audit evidence

- Current persistence/migration: `db/schema.sql`, `db/migrate.js`, `db/pool.js`
- Auth and app composition: `backend/routes/auth.js`, `backend/middleware/request.js`, `backend/app/index.js`
- AI behavior/provider: `backend/config/prompts.js`, `backend/controllers/ai.js`, `backend/services/ai/index.js`
- Local data: `frontend/services/storage.js`, `frontend/features/tutor-sources.js`
- Test/deployment documentation: `package.json`, `test/`, `README.md`, `backend/README.md`
- Product constraints: user-supplied Phase 0 blueprint and review; no distinct twelve-stage blueprint files found in repository docs.

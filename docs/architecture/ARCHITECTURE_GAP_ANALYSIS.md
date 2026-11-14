# Architecture Gap Analysis

## Scope

This document compares the current StudyBuddy codebase against the approved architectural direction described in the Phase 0 brief: modular monolith with clear boundaries, progressive transformation, no premature microservices, and explicit data ownership between PostgreSQL and IndexedDB.

## Approved-blueprint comparison

| Architectural area | Current state | Gap against approved blueprint | Priority |
| --- | --- | --- | --- |
| Modular monolith | Present | Strongly aligned | High |
| Clear domains | Partially present | Some modules are mixed or under-specified | High |
| Service-ready interfaces | Partially present | Some controller/service logic is still tight | High |
| Data ownership explicitness | Partially present | Mixed local/browser and server-backed behaviors need clearer ownership rules | High |
| AI orchestration boundary | Partially present | AI provider logic and prompt orchestration are not fully isolated | High |
| Assignment-brief domain boundary | Partial | File-processing and persistence logic is still tightly coupled | Medium |
| Local/offline persistence | Present | Mostly appropriate, but boundaries should be standardized | Medium |
| Deployment readiness | Good | Mostly compliant with Render-style needs | Medium |

## Missing or underdeveloped modules

### 1. Explicit AI orchestration layer

Current state:

- `backend/services/ai/index.js` contains provider logic and fallback handling.
- `backend/controllers/ai.js` manages prompt construction and output validation.
- Frontend features call the AI endpoints directly.

Gap:

The app has AI capabilities, but the orchestration flow is not yet abstracted into a clean, service-ready domain layer that enforces a single contract across tutor, notes, summary, card generation, and quiz generation.

### 2. Stronger domain boundaries for assignment briefs

Current state:

- Assignment brief logic spans router, controller, service, repository, and frontend UI modules.

Gap:

This feature works but is still visible as a multi-layer workflow with a less explicit ownership boundary than the flashcard/review domain.

### 3. Data-ownership enforcement contract

Current state:

- Data is deliberately split between PostgreSQL and IndexedDB.
- Documentation states this split clearly.

Gap:

The repository still has parts of the app where local and server persistence behavior is not fully formalized in a single ownership contract. That makes future refactors riskier.

## Architectural weaknesses

### A. Stale migration language

The app has already migrated away from some prior technologies, but product copy still references older implementations. Example: the UI text in `public/index.html` still says "Brief content is sent to Ollama Cloud..." even though the repo description and AI service now center on Groq/OpenAI-compatible provider logic.

This is a concrete product/architecture mismatch and is a sign of incomplete migration cleanup.

### B. Mixing local and server responsibilities in some workflows

The system is intentionally hybrid, but some user-facing workflows still combine browser-local processing with server-backed persistence in ways that are not fully documented as explicit contracts.

### C. Partial domain clarity around AI output validation

The system validates tutor output and normalizes AI-generated content, but the validation concerns are spread across several controller and service boundaries. That is workable, but not yet ideal for a long-term architecture.

### D. Dependency pressure from growing frontend feature modules

The frontend feature modules are modular, but they still rely on shared state and callback abstractions without a fully centralized state-management layer. This is acceptable for a single-user app, but it should remain intentionally bounded.

## Recommended evolution path

### Phase 1 priorities

1. Formalize data ownership boundaries
2. Isolate AI orchestration from UI and controller concerns
3. Normalize assignment-brief feature ownership
4. Remove stale migration copy and documentation drift
5. Prepare module-by-module refactoring with test coverage preserved

## Summary

The repository is not in a broken state, but it is not yet fully aligned with the approved blueprint. The strongest foundation is already present: modular frontend structure, separate backend, PostgreSQL authority, IndexedDB local workflow, and working AI/review logic. The gap is mostly in boundary enforcement and architectural cleanliness rather than in absence of core functionality.

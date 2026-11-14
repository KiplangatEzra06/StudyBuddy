# Existing Feature Inventory

## Overview

This inventory records the feature set that currently exists in the repository and identifies whether each feature appears to be working, partially implemented, or in need of refactoring.

| Feature | Current status | Relevant files | Dependencies | Data ownership | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Authentication | Working | `backend/routes/auth.js`, `backend/middleware/request.js`, `backend/app/index.js` | session config, bcrypt, DB session store | PostgreSQL | Preserve and harden |
| Dashboard | Working | `frontend/features/dashboard.js`, `public/styles/dashboard.css` | shared state, event bus | Local UI state + some backend stats | Preserve |
| Documents | Working | `frontend/features/documents.js`, `frontend/services/storage.js` | IndexedDB storage | IndexedDB | Preserve and clarify ownership |
| Notes | Implemented; tests cover parser/validation rather than full UI workflow | `frontend/features/notes.js`, `backend/controllers/ai.js` | AI generation, IndexedDB | Generated notes are stored in IndexedDB | Preserve |
| Classes | Implemented; runtime workflow not independently validated | `frontend/features/classes.js`, `frontend/services/storage.js` | frontend state, IndexedDB, calendar data | IndexedDB | Preserve |
| Assignments | Implemented; runtime workflow not independently validated | `frontend/features/assignments.js`, `frontend/services/storage.js` | frontend state, IndexedDB, optional assignment-brief API | IndexedDB for normal assignment records; a JSON snapshot is also stored with a saved server-side brief | Preserve and clarify snapshot semantics |
| Assignment briefs | Implemented; runtime workflow not independently validated | `backend/routes/assignment-briefs.js`, `backend/controllers/assignment-briefs.js`, `backend/repositories/assignment-briefs.js`, `frontend/features/assignment-brief.js` | raw upload validation, text validation, PostgreSQL | PostgreSQL stores assignment snapshot, extracted text, and file metadata; original file bytes are not retained | Preserve; clarify payload and lifecycle boundaries |
| Flashcards | Working | `frontend/features/flashcards.js`, `backend/controllers/cards.js`, `backend/repositories/cards.js` | review engine, DB | PostgreSQL | Preserve and keep authoritative |
| Review engine | Working | `backend/services/sm2.js`, `backend/controllers/review.js` | cards, user answers | PostgreSQL | Preserve |
| Learning review UI | Working | `frontend/features/learning.js` | flashcards, review API | PostgreSQL + local UI state | Preserve |
| Quiz | Working | `frontend/features/quiz.js` | AI generation, local storage | IndexedDB + AI output | Preserve |
| Timer | Working | `frontend/features/timer.js` | local browser state | IndexedDB | Preserve |
| Progress | Working | `frontend/features/progress.js` | review stats, UI data | PostgreSQL/local mix | Preserve and clarify ownership |
| Tutor | Implemented; tests cover key response validation paths | `frontend/features/tutor.js`, `backend/controllers/ai.js`, `backend/services/ai/index.js` | AI provider, message parsing, local tutor history | Conversation history in IndexedDB; AI requests are served by backend | Preserve and modularize AI orchestration |
| Backup / import | Working | `frontend/features/settings.js`, `frontend/shared/backup-data.js` | data validation and merging | Local browser export/import | Preserve |
| Calendar | Working | `frontend/features/calendar.js`, `frontend/shared/calendar-data.js` | class and assignment data | Local + backend-derived data | Preserve |
| Settings | Working | `frontend/features/settings.js` | local settings and backup helpers | IndexedDB + localStorage | Preserve |

## Findings by feature area

“Implemented” describes code presence and the extent of repository tests; it is not a claim that every end-to-end production workflow was manually exercised.

### 1. Authentication

- Status: robust and stable
- Scope: session login/logout plus protections for `/api/*` routes
- Files: `backend/routes/auth.js`, `backend/middleware/request.js`, `backend/app/index.js`
- Recommendation: preserve as the formal security boundary for the app

### 2. Study and learning workflows

- Status: strongly implemented
- Scope: cards, review scheduling, learning flow, quiz behavior
- Files: `backend/services/sm2.js`, `backend/controllers/review.js`, `frontend/features/learning.js`
- Recommendation: treat as a core domain with explicit server authority

### 3. Local workspace features

- Status: active and useful
- Scope: notes, documents, timer, classes, assignments, dashboard, settings
- Files: `frontend/features/*`, `frontend/services/storage.js`
- Recommendation: keep local-first for browser-only offline usage and clarify when backend persistence is desired

### 4. AI tutor and academic support

- Status: partially integrated but not yet boundary-clean
- Scope: tutor interaction, prompts, source validation, model fallback
- Files: `backend/services/ai/index.js`, `backend/controllers/ai.js`, `frontend/features/tutor.js`
- Recommendation: split provider logic, prompt orchestration, and response validation into separate service layers

### 5. Assignment-brief workflows

- Status: present but not yet fully cleanly separated
- Scope: file upload and brief parsing flow
- Files: `backend/controllers/assignment-briefs.js`, `backend/routes/assignment-briefs.js`, `frontend/features/assignment-brief.js`
- Recommendation: continue to preserve the feature but normalize the domain ownership and validation boundaries

## Preservation and refactoring recommendations

- Preserve existing working workflows wherever they already meet user expectations.
- Keep PostgreSQL authoritative where the app is already server-backed and durable.
- Keep IndexedDB authoritative for local/offline user workspaces.
- Refactor AI orchestration and assignment-brief handling into more explicit service boundaries before adding broader orchestration complexity.
- Avoid rewriting any stable workflow that already works and has test coverage.

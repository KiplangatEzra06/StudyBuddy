# Phase 0 System Audit

## Purpose

This document records the verified state of the StudyBuddy repository as of the current audit. It is grounded in the actual codebase and runtime structure rather than assumptions from earlier design notes.

## Verified technology stack

- Runtime: Node.js 22+
- Application server: Express 4.x
- Session management: `express-session` + `connect-pg-simple`
- Database: PostgreSQL via `pg` with a pooled `Pool`
- Authentication: cookie-based app sessions and bcrypt password hashing via `bcryptjs`
- AI: OpenAI-compatible provider abstraction using the OpenAI SDK (`openai`)
- Storage: PostgreSQL for server-backed records; browser-native IndexedDB API for local records (`margin-db`/`kv`); `localStorage` for UI preferences
- Frontend: native JavaScript ES modules served by Express without a build step
- Tests: Node.js built-in test runner plus `supertest`
- Deployment: Render instructions in README; production operation not independently verified
- ORM: none found; SQL is issued through `pg`
- Frontend framework/state library: none; native ES modules and a shared mutable state object/event bus
- Frontend styling: plain CSS; no styling framework or bundler identified
- File/object storage and vector database: none identified

## Repository structure

- `server.js` — app bootstrap and process entry point
- `backend/` — API, middleware, routes, controllers, services, repositories, and config
- `db/` — database connection, migration, schema
- `frontend/` — modular browser app
- `public/` — static app shell and stylesheet assets
- `test/` — regression suite
- `scripts/` — operational scripts, including password hashing
- `docs/` — project docs and blueprints
- `.env.example` — absent; backend documentation currently tells contributors to configure one

## Frontend architecture

The frontend is organized as a modular native JS application served from `/frontend/` and `/`:

- `frontend/app/` — bootstrapping, auth flow, navigation
- `frontend/features/` — domain UI modules such as flashcards, notes, documents, classes, assignments, calendar, tutor, quiz, timer
- `frontend/services/` — same-origin backend client and IndexedDB storage
- `frontend/shared/` — shared state, formatting, DOM utilities, markdown support, undo helpers, event bus, and pure data helpers

Key facts:

- The app shell is served from `public/index.html`.
- The browser uses same-origin `/api/...` requests with cookie-based auth.
- UI preferences are stored in `localStorage`.
- Local application data remains in IndexedDB.
- `frontend/services/storage.js` uses the browser IndexedDB API directly; the `idb` package is not a dependency.

## Backend architecture

The backend follows a standard route/controller/service structure:

- `backend/routes/` — route registration
- `backend/controllers/` — request validation and response coordination
- `backend/services/` — reusable validation, AI helpers, SM-2 logic, assignment-brief processing
- `backend/repositories/` — database-specific persistence and query logic
- `backend/middleware/` — auth and request validation guards
- `backend/config/` — AI prompts and config helpers

Important runtime composition points:

- `server.js` exports the Express app for tests.
- `backend/app/index.js` composes the app, sessions, routers, static files, and error handling.
- `db/pool.js` owns the PostgreSQL pool and query helpers.

## Current architecture diagram

```text
Browser
  public/index.html + frontend/app + frontend/features
       | same-origin /api/* (session cookie + request header)
       v
  frontend/services/api.js
       |
       v
Express app (server.js -> backend/app/index.js)
  auth/session + request guards + rate limits
       |
       +--> routes -> controllers -> services -> repositories -> PostgreSQL
       |       |           |            |             |
       |       |           |            |             +-- decks/cards/reviews,
       |       |           |            |                 assignment_workspaces
       |       |           |            +-- AI provider (OpenAI-compatible API)
       |       |           +-- validation and response handling
       |       +-- auth, cards, review, AI, assignment briefs
       |
       +--> serves public assets and /frontend modules

Browser-local persistence:
  feature modules -> frontend/services/storage.js -> IndexedDB (margin-db/kv)
  UI preferences -> localStorage
```

## Existing functionality

### Authentication and access control

- Single-user admin login with cookie sessions
- `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me` routes
- Session persistence in PostgreSQL via `connect-pg-simple`
- Same-origin API requests require the app's JSON/CSRF header check; protected application API routes require a session
- Auth routes are mounted before the protected API middleware; login is rate-limited, while `/api/auth/me` reports session state and logout can be called without an authenticated session
- This is a single-admin model, not multi-user authorization. Cards/decks are not scoped to multiple users; assignment workspace records use an owner key derived from the configured username.

### Study data and review engine

- Flashcards and review scheduling are server-backed
- Review logic reuses the SM-2 calculation in `backend/services/sm2.js`
- Card generation and review pathways are implemented across backend controllers and frontend learning modules

### Scheduling and school planning

- Calendar data logic derives events from classes and assignments
- Classes and ordinary assignment records are stored in IndexedDB
- Assignment-brief routes persist a workspace snapshot and brief metadata/text in PostgreSQL; this is not a general classes/assignments CRUD API

### AI features

- OpenAI-compatible AI provider abstraction is implemented in `backend/services/ai/index.js`
- Tutor, notes, flashcards, and quiz generation paths exist in the AI controller layer
- Model fallback handling and provider-level cooldown/rate-limit protection are implemented
- The Tutor browser builds a local study-material index and selects references before sending them with a request; there is no server-managed retrieval/vector pipeline.
- There is no explicit model gateway, prompt manager, context manager, memory manager, tool registry, or evaluation engine as separate logical modules.
- One general Tutor prompt and an assignment-specific prompt are present. The general instructions prohibit direct answers even when requested; this conflicts with the approved adaptive direct-first/guided-first behavior. No backend-enforced Test Mode policy was found.
- No examination-prediction workflow or three-verified-paper gate was found.
- Conversations and uploaded materials are not declared training data; no fine-tuning pipeline was found.

### Data import/export and backup

- Browser backup/restore utilities exist for local app data
- Import/merge logic includes validation and collision handling

## Database and storage findings

### PostgreSQL

The app expects `DATABASE_URL` on startup and fails fast if missing. The `pg` pool is configured in `db/pool.js` and is the authoritative durable database connection for session and app records.

The schema currently defines `session`, `decks`, `cards`, `reviews`, and `assignment_workspaces`. The latter stores an owner-scoped assignment JSON snapshot alongside brief metadata and extracted text. The original uploaded file bytes are validated in the request but are not retained as a database blob or external object-store object. AI-generated content is not generally persisted by the AI endpoints; cards are persisted when the user saves/imports them.

`npm run migrate` executes the complete idempotent `db/schema.sql`. There are no numbered/versioned migration files or migration ledger. `npm start` does not run migrations. Backup and restore automation was not found or verified; do not infer a production backup schedule from Neon usage.

### IndexedDB

The browser stores many local records in IndexedDB, including:

- documents
- notes
- classes
- assignments
- quiz history
- timer sessions
- tutor history
- local backup data

The store is a single key/value object store (`margin-db`, `kv`) rather than a normalized per-domain schema. Failed IndexedDB operations are logged and surfaced to callers as `false` or `undefined` in the storage helper; callers need to check write results. The actual feature-file sizes verified in this checkout are `notes.js` 1,132 lines, `tutor.js` 746 lines, and `flashcards.js` 656 lines, which suggests internal decomposition may help but is not itself proof of a defect.

### Clear boundary

The repository explicitly maintains a mixed-storage model:

- PostgreSQL for durable server-backed records
- IndexedDB for local/offline/cached user workspace data

This is consistent with the approved architecture direction and should be treated as a first-class design boundary, not an accident.

## API inventory summary

| Methods | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Basic liveness route |
| `POST` | `/api/auth/login` | No | Session creation |
| `POST` | `/api/auth/logout` | No | Destroys session if present |
| `GET` | `/api/auth/me` | No | Reports current session state |
| `GET` | `/api/ai/health` | Yes | Validates AI provider connectivity |
| `POST` | `/api/ai` | Yes | Tutor interaction |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/decks[/:id]` | Yes | Deck list/create/rename/delete |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/cards[/:id]` | Yes | Card list/create/update/delete; `POST /:id/restore`, `/import`, and `/save` also exist |
| `POST` | `/api/cards/generate` | Yes | Generate topic cards |
| `POST` | `/api/generate-flashcards` | Yes | Generate flashcards |
| `POST` | `/api/generate-notes` | Yes | Generate notes |
| `POST` | `/api/generate-quiz` | Yes | Generate quiz |
| `GET` | `/api/review/next` | Yes | Fetch next due card |
| `POST` | `/api/review/grade` | Yes | Grade review result |
| `GET` | `/api/stats/topics` | Yes | Topic statistics |
| `GET` | `/api/assignments/briefs` | Yes | List saved assignment briefs |
| `PUT` | `/api/assignments/:assignmentId/brief/validate` | Yes | Validate uploaded brief bytes; body is raw octet-stream |
| `PUT` | `/api/assignments/:assignmentId/brief` | Yes | Save assignment snapshot and brief metadata/text |
| `DELETE` | `/api/assignments/:assignmentId/brief` | Yes | Remove saved brief |

## Deployment findings

- The root `README.md` documents a Render deployment recipe (`npm install`, `npm start`) and the required environment variables, including `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `DATABASE_URL`, and session settings.
- No deployment manifest, Dockerfile, Procfile, or CI workflow was found in the repository inventory.
- `.env.example` is absent, although `backend/README.md` refers to it.
- The database migration is a manual `npm run migrate` step; startup does not migrate automatically.
- No CI workflow, backup procedure, or production monitoring/error-reporting integration was identified in the repository.
- The production Render service itself was not inspected as part of this repository audit; deployed configuration and runtime behavior remain unverified.
- Same-origin cookie auth is configured for production, and startup validates some required production settings. This does not establish production readiness.

## Test evidence and limitations

The current `npm test` run reported 24 passing tests, 0 failing tests, and 1 skipped database integration test. The tests use Node's test runner; route/auth coverage uses Supertest, AI route behavior uses a local mock HTTP provider, and service/pure-data tests exercise helpers.

| Test layer | Evidence | Limitation |
| --- | --- | --- |
| Unit/pure helper tests | `sm2.test.js`, `services.test.js`, calendar and backup tests | Cover selected helpers, not the whole product |
| Request-level tests | `auth.test.js`, `routes.test.js` | In-process app tests; AI provider is mocked |
| Database integration | `db.routes.test.js` | Skipped without a dedicated `TEST_DATABASE_URL` |
| Browser end-to-end | No browser E2E suite identified | Real IndexedDB/UI workflows not validated |
| Production smoke | Not performed | Live deployment, provider credentials, database and backups remain unverified |

These results do not prove actual PostgreSQL integration, browser persistence behavior, offline synchronization, migration reliability, or production operation.

## Approved product and architecture constraints

The user-provided approved blueprint requires an incremental modular monolith, feature-based frontend, PostgreSQL authority for server-backed data, IndexedDB for approved offline/local queued operations, and no premature microservices. Tutor principles include adaptive teaching, explicit source grounding, six distinct modes (Learn, Practice, Revise, Test, Explain, Apply), and backend enforcement for Test Mode. OCR is deferred beyond v1 but document processing should remain extensible. Examination predictions require at least three verified papers; below that threshold only descriptive analysis is allowed. Activity alone must not establish mastery, broader learning changes remain reviewable, and conversations/materials are not automatically training data. The implementation is not yet evidence of these constraints being fully enforced.

The exact twelve blueprint source documents were not present in the repository inventory. The constraints above are retained from the user-provided Phase 0 blueprint; stage-specific details not included there remain unverified.

## Summary assessment

The application has a modular-monolith shape and meaningful domain features. Selected tests pass, but production and database integration are not verified. Several target blueprint capabilities are absent or only partially implemented; a full rewrite is not supported by current evidence.

## Recommended Phase 0 conclusion

Preserve working behavior and refactor progressively by:

1. Clarifying storage ownership boundaries
2. Strengthening module accountability
3. Formalizing AI orchestration and validation boundaries
4. Cleaning stale migration copy and product wording
5. Preparing a safer Phase 1 backlog around architecture hardening

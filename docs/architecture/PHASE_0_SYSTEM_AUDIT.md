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
- Storage: PostgreSQL for durable app data, IndexedDB for local/browser-only data
- Frontend: native JavaScript ES modules served by Express without a build step
- Tests: Node.js built-in test runner plus `supertest`
- Deployment: Render-oriented environment configuration with `.env` and Dockerless startup

## Repository structure

- `server.js` — app bootstrap and process entry point
- `backend/` — API, middleware, routes, controllers, services, repositories, and config
- `db/` — database connection, migration, schema
- `frontend/` — modular browser app
- `public/` — static app shell and stylesheet assets
- `test/` — regression suite
- `scripts/` — operational scripts, including password hashing
- `docs/` — project docs and blueprints

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

## Existing functionality

### Authentication and access control

- Single-user admin login with cookie sessions
- `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me` routes
- Session persistence in PostgreSQL via `connect-pg-simple`
- Same-origin API requests require session auth and JSON CSRF header enforcement

### Study data and review engine

- Flashcards and review scheduling are server-backed
- Review logic reuses the SM-2 calculation in `backend/services/sm2.js`
- Card generation and review pathways are implemented across backend controllers and frontend learning modules

### Scheduling and school planning

- Calendar data logic derives events from classes and assignments
- Assignment and class workflows exist in both frontend modules and backend persistence

### AI features

- OpenAI-compatible AI provider abstraction is implemented in `backend/services/ai/index.js`
- Tutor, notes, flashcards, and quiz generation paths exist in the AI controller layer
- Model fallback handling and provider-level cooldown/rate-limit protection are implemented

### Data import/export and backup

- Browser backup/restore utilities exist for local app data
- Import/merge logic includes validation and collision handling

## Database and storage findings

### PostgreSQL

The app expects `DATABASE_URL` on startup and fails fast if missing. The `pg` pool is configured in `db/pool.js` and is the authoritative durable database connection for session and app records.

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

### Clear boundary

The repository explicitly maintains a mixed-storage model:

- PostgreSQL for durable server-backed records
- IndexedDB for local/offline/cached user workspace data

This is consistent with the approved architecture direction and should be treated as a first-class design boundary, not an accident.

## API inventory summary

| Area | Endpoint concept | Auth | Notes |
| --- | --- | --- | --- |
| health | `/health` | No | Basic liveness route |
| auth | `/api/auth/login` | No | Session creation |
| auth | `/api/auth/logout` | Yes | Session invalidation |
| auth | `/api/auth/me` | Yes | Session status |
| AI health | `/api/ai/health` | Yes | Validates AI provider connectivity |
| tutor | `/api/ai` | Yes | Tutor interaction |
| cards | `/api/cards/generate` | Yes | AI card generation |
| notes | `/api/generate-notes` | Yes | AI notes generation |
| quiz | `/api/generate-quiz` | Yes | AI quiz generation |
| review | `/api/review/next` | Yes | Fetch next due card |
| review | `/api/review/grade` | Yes | Grade review result |
| assignment briefs | `/api/assignments/...` | Yes | Assignment brief workflow |

## Deployment findings

- The repository is structured for Render-style deployment.
- The root `README.md` documents required environment variables, including `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `DATABASE_URL`, and session settings.
- Same-origin cookie auth is expected in production.
- The app is designed to fail fast on missing required environment settings.

## Summary assessment

The application is already a working modular monolith with clear general boundaries and meaningful domain features. It does not yet fully formalize every approved blueprint module, but it has a viable base for incremental architectural refactoring without a full rewrite.

## Recommended Phase 0 conclusion

Preserve working behavior and refactor progressively by:

1. Clarifying storage ownership boundaries
2. Strengthening module accountability
3. Formalizing AI orchestration and validation boundaries
4. Cleaning stale migration copy and product wording
5. Preparing a safer Phase 1 backlog around architecture hardening

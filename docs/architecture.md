# StudyBuddy repository architecture

Stage B separates the application entrypoints and infrastructure responsibilities without changing data or API contracts. Stage C establishes a dedicated design-token and shared-component layer. Stage D groups navigation around the existing features and adds a collapsible desktop sidebar while retaining the mobile drawer.

## Frontend

- `public/index.html` remains the page shell.
- `public/design-tokens.css` is the single source for light, dark, and system theme variables, including color, spacing, radius, typography, and layering tokens.
- `public/styles.css` contains page and feature-specific layout and presentation rules.
- `public/components.css`, loaded after feature styles, contains shared button, form-control, and panel primitives so common states are consistent across the app.
- `public/app.js` is the native ES-module entrypoint. It imports `frontend/app/main.js`.
- `frontend/app/main.js` loads `frontend/app/runtime.js`, which currently holds the pre-existing feature logic and initialization.
- `frontend/shared/state.js` exports one `state` object with every shared mutable value the runtime previously kept as top-level `let`/`const` bindings.
- `frontend/shared/constants.js` holds storage keys and `WEEKDAY_NAMES`.
- `frontend/shared/bus.js` is a small `emit` / `on` / `off` pub/sub for later cross-feature wiring without feature-to-feature imports.
- `frontend/shared/dom.js`, `format.js`, `custom-select.js`, `fit-paginator.js`, `undo.js`, and `files.js` hold generic helpers moved out of `runtime.js` with identical bodies.
- `frontend/services/api.js` owns same-origin API requests, cookies, timeout, and unauthorized-session callback behavior.
- `frontend/services/assignment-briefs-api.js` owns `/api/assignments` brief HTTP helpers used by the assignment-brief feature.
- `frontend/services/storage.js` owns the existing IndexedDB `margin-db` database and `kv` store helpers.
- `frontend/features/calendar-data.js` owns calendar date keys, event derivation, and next-event selection without DOM access.
- `frontend/features/calendar.js` owns calendar DOM rendering, navigation, and day/agenda dialogs; cross-feature assignment helpers arrive through `init(deps)`.
- `frontend/features/classes.js` owns course cards/forms and the classes↔assignments panel toggle; it emits `classes:changed` after saves.
- `frontend/features/assignments.js` owns assignment markup/list/forms and reminder badge/controls/interval; it emits `assignments:changed` after saves and completion toggles.
- `frontend/features/assignment-brief.js` owns assignment brief upload/replace/remove UI and server hydration of brief metadata onto local assignments; it emits `assignment-brief:changed`.
- `frontend/features/documents.js` owns document upload/extraction, library and reader UI, and course/unit taxonomy fills; it emits `documents:changed` after uploads so dependent source dropdowns refresh.
- `frontend/features/quiz.js` owns document/note quiz generation, grading, and mistake review UI; results stay in IndexedDB `quizResults`, and mistake-to-flashcard requests use `flashcards:create-from-mistakes` on the shared bus.
- `frontend/features/backup-data.js` owns backup schema validation and ID-preserving collection merges; browser storage and import/export interactions remain in the runtime.
- `frontend/features/tutor-markdown.js` owns safe Tutor Markdown rendering, including streamable code/table markup and source citation chips; it does not modify conversation history.
- `frontend/features/timer.js` owns the focus timer ring, controls, sound/notification settings, and writing completed sessions to `state.timerSessions`; it emits `timer:session-logged` on the shared bus instead of calling progress code directly.
- Express serves `frontend/` from `/frontend`; there is no build step.

The runtime remains the coordinator for DOM rendering and cross-feature interactions; shared mutable data lives on `state`. The Assignments navigation view reuses the existing course/assignment panel and records; Study Sessions reuses the existing timer-session history and progress data. Neither creates a new data model or placeholder page. The dashboard aggregates existing local document, class, assignment, quiz, and focus-session data plus server-backed flashcard due counts, and each dashboard section exposes loading, empty, and error states.

## Backend

- Root `server.js` remains the `npm start` and test-compatible entrypoint.
- `backend/app/index.js` builds the Express application, configures sessions and global middleware, mounts the route modules, and serves health and static routes. It does not build a shared route context.
- `backend/routes/auth.js` owns login, logout, and session-status endpoints.
- `backend/routes/ai.js`, `backend/routes/assignment-briefs.js`, `backend/routes/cards.js`, and `backend/routes/review.js` only map a method and path to a controller function.
- `backend/controllers/ai.js`, `backend/controllers/assignment-briefs.js`, `backend/controllers/cards.js`, and `backend/controllers/review.js` parse and validate input, call services or repositories, and send the response. Each controller requires the services, repositories, prompts, and database helpers it needs.
- `backend/repositories/` holds the assignment-brief, deck, card, and review SQL. Repository functions take the shared `query` or `transaction` helper and return the rows the controllers send.
- `backend/middleware/request.js` owns JSON/CSRF checks and authenticated-session enforcement.
- `backend/services/ai-content.js` owns AI response parsing, prompt input validation, and generation error handling.
- `backend/services/cards.js` owns card/deck normalization, validation, and shared card query data.
- `backend/services/database-errors.js` owns consistent database failure responses.
- `backend/services/ollama.js` and `backend/services/sm2.js` contain Ollama integration and spaced-repetition logic; `backend/config/prompts.js` contains prompt configuration.
- `db/` stays at the repository root so existing migration tooling and the `npm run migrate` command remain unchanged.

Requests flow from routes to controllers, then to services and repositories. No database or API-contract changes were made. `POST /api/ai` still streams server-sent events when `stream` is true, including aborting the upstream request when the client disconnects.

## Feature presentation and data boundaries

Stage F refinements complete the Flashcards, Notes, Calendar, AI Tutor, Documents, Quiz, Courses/Assignments, Focus Timer, Progress/Study Sessions, and Settings views. These are presentation-only refinements over the existing shared design tokens and components; feature behavior and storage/API contracts remain unchanged. Calendar continues to use the user's confirmed Sunday-first weekday preference.

Browser-local records use the `margin-db` IndexedDB database and its `kv` store. The main keys are `documents`, `notes`, `quizResults`, `timerSessions`, `classes`, `assignments`, and `tutorConversations`; flashcards are server-backed. Theme and other small UI preferences use `localStorage`. See the frontend and backend READMEs for the storage key list and HTTP API inventory.

## Deployment and compatibility

`npm start` still invokes `server.js`, `npm run migrate` still targets `db/migrate.js`, and `npm test` runs the existing regression suite plus focused route, service, and calendar-data tests. The frontend module files are served same-origin with JavaScript revalidation; existing API and static asset paths are retained.

## Stage G verification record

- The configured Node test command passed all 21 tests.
- `frontend/app/runtime.js` passed Node's syntax check.
- Signed-in browser navigation was smoke-checked on desktop for the feature destinations and at 390px wide for Documents, Quiz, Progress, and Settings; these views had no horizontal page overflow.
- Read-only API checks returned success for `/health`, `/api/auth/me`, `/api/decks`, `/api/cards`, `/api/review/next`, and `/api/stats/topics`.
- The preview contained server-backed flashcards but no documents, assignments, or recorded study sessions. To preserve user data and avoid sending their material to an AI provider, manual upload/import, AI generation, quiz submission, deletion, and timer-completion workflows were not exercised. Automated tests cover validation and selected services, not full end-to-end workflows for those actions.
- No live service was changed or deployed.

# StudyBuddy repository architecture

Stage B separates the application entrypoints and infrastructure responsibilities without changing data or API contracts. Stage C establishes a dedicated design-token and shared-component layer while retaining the existing page structure and interactions.

## Frontend

- `public/index.html` remains the page shell.
- `public/design-tokens.css` is the single source for light, dark, and system theme variables, including color, spacing, radius, typography, and layering tokens.
- `public/styles.css` contains page and feature-specific layout and presentation rules.
- `public/components.css`, loaded after feature styles, contains shared button, form-control, and panel primitives so common states are consistent across the app.
- `public/app.js` is the native ES-module entrypoint. It imports `frontend/app/main.js`.
- `frontend/app/main.js` loads `frontend/app/runtime.js`, which currently holds the pre-existing feature logic and initialization.
- `frontend/services/api.js` owns same-origin API requests, cookies, timeout, and unauthorized-session callback behavior.
- `frontend/services/storage.js` owns the existing IndexedDB `margin-db` database and `kv` store helpers.
- `frontend/features/calendar-data.js` owns calendar date keys, event derivation, and next-event selection; the DOM rendering and interactions remain in the runtime.
- `frontend/features/backup-data.js` owns backup schema validation and ID-preserving collection merges; browser storage and import/export interactions remain in the runtime.
- Express serves `frontend/` from `/frontend`; there is no build step.

The runtime remains the coordinator for shared state, DOM rendering, and cross-feature interactions. Stage C preserves those boundaries and standardizes shared styling primitives without changing markup contracts or app behavior.

## Backend

- Root `server.js` remains the `npm start` and test-compatible entrypoint.
- `backend/app/index.js` builds the Express application, configures sessions and global middleware, composes API routers, and serves health and static routes.
- `backend/routes/auth.js` owns login, logout, and session-status endpoints.
- `backend/routes/ai.js` owns tutor, generation, and document-powered AI endpoints.
- `backend/routes/cards.js` owns deck and flashcard CRUD and import endpoints.
- `backend/routes/review.js` owns flashcard review and topic-statistics endpoints.
- `backend/middleware/request.js` owns JSON/CSRF checks and authenticated-session enforcement.
- `backend/services/ai-content.js` owns AI response parsing, prompt input validation, and generation error handling.
- `backend/services/cards.js` owns card/deck normalization, validation, and shared card query data.
- `backend/services/database-errors.js` owns consistent database failure responses.
- `backend/services/ollama.js` and `backend/services/sm2.js` contain Ollama integration and spaced-repetition logic; `backend/config/prompts.js` contains prompt configuration.
- `db/` stays at the repository root so existing migration tooling and the `npm run migrate` command remain unchanged.

The app composer passes the extracted shared helpers and database dependencies to each route family. No database or API-contract changes were made.

## Deployment and compatibility

`npm start` still invokes `server.js`, `npm run migrate` still targets `db/migrate.js`, and `npm test` runs the existing regression suite plus focused route, service, and calendar-data tests. The frontend module files are served same-origin with JavaScript revalidation; existing API and static asset paths are retained.

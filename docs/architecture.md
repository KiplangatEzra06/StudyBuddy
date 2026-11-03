# StudyBuddy repository architecture

Stage B separates the application entrypoints and several infrastructure responsibilities without changing the user-facing interface, data model, or API contracts.

## Frontend

- `public/index.html` and `public/styles.css` remain the page shell and stylesheet.
- `public/app.js` is the native ES-module entrypoint. It imports `frontend/app/main.js`.
- `frontend/app/main.js` loads `frontend/app/runtime.js`, which currently holds the pre-existing feature logic and initialization.
- `frontend/services/api.js` owns same-origin API requests, cookies, timeout, and unauthorized-session callback behavior.
- `frontend/services/storage.js` owns the existing IndexedDB `margin-db` database and `kv` store helpers.
- Express serves `frontend/` from `/frontend`; there is no build step.

Feature-specific modules, shared UI components, and feature styles have not yet been extracted. The runtime remains a single file to avoid combining structural work with page behavior changes.

## Backend

- Root `server.js` remains the `npm start` and test-compatible entrypoint.
- `backend/app/index.js` builds the Express application and configures sessions, global middleware, remaining API routes, health, and static files.
- `backend/routes/auth.js` owns login, logout, and session-status endpoints.
- `backend/middleware/request.js` owns JSON/CSRF checks and authenticated-session enforcement.
- `backend/services/` contains Ollama and SM-2 logic; `backend/config/prompts.js` contains prompt configuration.
- `db/` stays at the repository root so existing migration tooling and the `npm run migrate` command remain unchanged.

Most AI, deck/card, review, and generated-content route handlers still reside in `backend/app/index.js`; further extraction into routes/controllers/services/repositories remains outstanding. No database or API-contract changes were made.

## Deployment and compatibility

`npm start` still invokes `server.js`, `npm run migrate` still targets `db/migrate.js`, and `npm test` remains unchanged. The frontend module files are served same-origin with JavaScript revalidation; existing API and static asset paths are retained.

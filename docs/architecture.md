# StudyBuddy architecture

StudyBuddy is a single-user study application served by Express. Its browser UI is native JavaScript modules; server-backed flashcards, reviews, assignment briefs, authentication, and AI requests use the same-origin API. Documents, notes, classes, assignments, quizzes, timer sessions, and Tutor history are stored in the browser.

## Runtime entrypoints

- `server.js` loads environment configuration, starts the HTTP listener when run directly, and exports the Express app for tests.
- `backend/app/index.js` composes middleware, sessions, API routers, static files, and error handling.
- `public/index.html` is the served app shell. The repository-root `index.html` redirects static-host visits to `public/index.html`.
- `public/app.js` loads the frontend entrypoint in `frontend/app/main.js`; `main.js` imports `app/bootstrap.js`.
- Express serves browser modules at `/frontend/` and public assets at `/`.

## Backend

The usual request path is **routes → controllers → services and repositories**:

1. `backend/routes/` maps HTTP methods and paths to controller handlers.
2. `backend/controllers/` validates requests, coordinates the domain work, and writes responses.
3. `backend/services/` holds reusable validation, normalization, AI-provider, database-error, ownership, assignment-brief, and SM-2 behavior.
4. `backend/repositories/` contains SQL operations for decks, cards, and reviews; controllers pass the database query helpers to those operations.

`backend/routes/auth.js` owns the small session login/logout/status handlers directly. The assignment-brief router also contains its request-specific upload and persistence flow while using the assignment-brief service for file and text validation. Middleware in `backend/middleware/request.js` enforces authentication and JSON/CSRF requirements. `backend/config/prompts.js` contains AI prompts.

`db/pool.js` owns the PostgreSQL pool and query helpers; `db/schema.sql` and `db/migrate.js` define and apply the database schema. `scripts/hash-password.js` creates the configured password hash. `backend/services/sm2.js` is the sole SM-2 implementation and is imported directly by the review controller and tests.

## Frontend

Frontend responsibilities are organized into `app/`, `features/`, `services/`, and `shared/`:

- `frontend/app/` contains the entrypoint, bootstrap, authentication flow, and page navigation. The bootstrap loads data into shared state, initializes modules, and coordinates whole-app rendering.
- `frontend/features/` contains the UI and interaction modules: assignment briefs, assignments, calendar, classes, dashboard, documents, flashcards, learning/review, notes, progress, quiz, settings, timer, and Tutor. Tutor source indexing and Tutor Markdown rendering live in `tutor-sources.js` and `tutor-markdown.js`.
- `frontend/services/` provides the authenticated API client, IndexedDB access, and assignment-brief API adapter.
- `frontend/shared/` contains shared state, the cross-feature event bus, and reusable data, DOM, formatting, file, Markdown, select, pagination, constants, and undo helpers.

Features communicate through the shared event bus or callbacks supplied by the bootstrap; feature modules do not import other feature modules. `features/backup-data.js` and `features/calendar-data.js` are compatibility wrappers around the corresponding shared modules.

## Public assets and styling

- `public/design-tokens.css` defines theme tokens.
- `public/styles/base.css` contains shared page styles; `public/styles/layout.css` contains the app shell, sidebar, and mobile drawer.
- `public/styles/` contains the ordered Dashboard, Flashcards, Notes, Calendar, Classes, Documents, Quiz, Timer, Progress, Tutor, Settings, and assignment-workspace stylesheets.
- `public/components.css` loads last for shared component styles.

The repository-root `index.html` is only a static-host redirect; the Express server serves `public/index.html` directly at `/`.

## Tests

Run `npm test` for the Node test suite. PostgreSQL integration tests run when `TEST_DATABASE_URL` points to a dedicated test database; otherwise they are skipped.

# Frontend

The frontend is a native JavaScript ES-module application with no build step. Express serves the app shell from `public/index.html` and modules from `/frontend/`. The public shell uses the same-origin API and cookie-based authentication.

## Module structure

- `app/` contains `main.js`, the bootstrap, authentication, and navigation. The bootstrap loads persisted data into shared state, initializes modules, and coordinates application rendering.
- `features/` contains the application UI and interactions:
  - `documents.js`, `notes.js`, `classes.js`, `assignments.js`, `calendar.js`, and `assignment-brief.js` own their study and planning workflows.
  - `flashcards.js` owns cards, decks, server synchronization, and import; `learning.js` owns card generation previews, due-card review, grading, and statistics.
  - `quiz.js`, `timer.js`, `dashboard.js`, `progress.js`, `settings.js`, and `tutor.js` own their respective workflows.
  - `tutor-sources.js` handles study-material indexing and retrieval; `tutor-markdown.js` renders safe Tutor replies.
  - `backup-data.js` and `calendar-data.js` are compatibility wrappers around shared pure-data helpers.
- `services/` contains the same-origin API client, IndexedDB storage, and assignment-brief API adapter.
- `shared/` contains the single mutable application state object, event bus, shared data helpers, DOM/format/file utilities, Markdown rendering, common controls, pagination, constants, and undo behavior.

Features do not import other features. Cross-feature requests use `shared/bus.js` or callbacks passed by the bootstrap. Shared helpers belong in `shared/`.

## Data and API

`services/storage.js` stores local documents, notes, quiz results, timer sessions, classes, assignments, Tutor conversations, and undo snapshots in IndexedDB (`margin-db`, `kv`). Current flashcard data and review statistics come from the authenticated backend API; legacy browser card keys are read only for migration/import. UI preferences use `localStorage`.

The backend owns authentication, flashcard/deck CRUD, review scheduling/statistics, assignment-brief persistence, and AI endpoints. Documents and other local records are not exposed as server CRUD APIs. See [the architecture overview](../docs/architecture.md) for the module boundaries and [the backend guide](../backend/README.md) for server responsibilities.

## Styling

`public/index.html` loads `design-tokens.css`, then `styles/base.css`, `styles/layout.css`, the ordered feature stylesheets in `public/styles/`, and `components.css` last. The feature stylesheets are `dashboard.css`, `flashcards.css`, `notes.css`, `calendar.css`, `classes.css`, `documents.css`, `quiz.css`, `timer.css`, `progress.css`, `tutor.css`, `settings.css`, and `assignment-workspace.css`.

## Verification

Run `npm test` from the repository root. Tests that require PostgreSQL need `TEST_DATABASE_URL` set to a dedicated test database.

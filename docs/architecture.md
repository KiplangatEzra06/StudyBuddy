# StudyBuddy repository architecture

This repository is organized around keeping the existing app behavior stable while separating responsibilities for the Phase 1 redesign.

## Frontend responsibilities

- `public/index.html`: application shell and static page structure
- `public/styles.css`: shared visual language and existing layout styling
- `public/app.js`: current feature logic, view switching, data loading, and inter-feature coordination
- `public/`: browser assets and user-facing files served directly by Express

## Backend responsibilities

- `server.js`: application bootstrap, session configuration, auth middleware, API wiring, and top-level error handling
- `db/`: database connection setup and migration tooling
- `services/`: external service integrations such as Ollama
- `config/`: prompt and runtime configuration
- `scripts/`: maintenance utilities (for example hash generation)

## Structural intent for Phase 1

The current codebase is intentionally kept functionally equivalent during Stage B. The architecture is mapped so the redesign in later stages can move toward clearer module boundaries without changing the live app behavior.

### Target module boundaries

- Core app bootstrap
- Shared UI components
- Shared utilities
- Feature modules
- Services and storage adapters
- Design-system tokens and styles

### Why this is the safest Stage B

- The live app remains unchanged during the repository reorganization
- The backend and browser contract remain intact
- Existing routes, session behavior, and data models are preserved
- Later stages can split files into modular boundaries without risking a broken deployment

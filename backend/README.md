# Backend module map

This folder documents the intended backend organization for the redesign without changing the runtime behavior of the current app.

## Existing runtime files

- `../server.js` — Express bootstrap, auth, session management, routes
- `../db/` — PostgreSQL pooling and migrations
- `../services/ollama.js` — AI proxy service
- `../config/prompts.js` — prompt configuration

## Target split for later stages

- `app/` — Express initialization, middleware, and app-level setup
- `routes/` — API route definitions
- `controllers/` — request handling logic
- `services/` — business logic and integrations
- `repositories/` — database access and persistence logic
- `middleware/` — auth, validation, rate limiting, and request checking
- `config/` — environment and prompt configuration
- `utils/` — shared helper functions

The current backend remains the source of truth in Stage B, preserving every route, response shape, and contract.

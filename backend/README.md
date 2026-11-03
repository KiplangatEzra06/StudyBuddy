# Backend

The root `server.js` remains the Render-compatible entrypoint and test import. It loads `.env`, starts the app when run directly, and exports the Express instance.

## Runtime modules

- `app/index.js` configures Express, sessions, rate limits, API routes, and static serving.
- `routes/auth.js` owns login, logout, and session-status routes.
- `middleware/request.js` owns JSON/CSRF validation and authenticated-session enforcement.
- `services/ollama.js` and `services/sm2.js` contain the AI integration and spaced-repetition logic.
- `config/prompts.js` contains AI prompts.
- The existing PostgreSQL pool and migration tooling remain in `../db/`.

The other API route families and their business logic remain in `app/index.js`; extracting those without altering contracts remains outstanding. The `controllers/`, `repositories/`, and `utils/` folders do not yet contain runtime modules.

# Backend

The root `server.js` remains the Render-compatible entrypoint and test import. It loads `.env`, starts the app when run directly, and exports the Express instance.

## Runtime modules

- `app/index.js` composes Express middleware, route families, and static serving.
- `routes/auth.js` owns login, logout, and session-status routes.
- `routes/ai.js`, `routes/cards.js`, and `routes/review.js` own the AI, deck/card, and review API families.
- `middleware/request.js` owns JSON/CSRF validation and authenticated-session enforcement.
- `services/ai-content.js`, `services/cards.js`, and `services/database-errors.js` own shared route-family validation, parsing, normalization, and error responses.
- `services/ollama.js` and `services/sm2.js` contain the AI integration and spaced-repetition logic.
- `config/prompts.js` contains AI prompts.
- The existing PostgreSQL pool and migration tooling remain in `../db/`.

No API or database contracts changed during extraction. The existing PostgreSQL pool remains shared by the route family modules through the app composition context.

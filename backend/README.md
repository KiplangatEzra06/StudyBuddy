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

## Repositories

SQL for decks, cards, and reviews lives in `repositories/`. Each function receives the shared `query` or `transaction` helper from `db/pool.js` and returns the same rows the handlers used before. Route handlers still parse requests, choose status codes, and report database failures.

- `repositories/decks.js`: `listDecks`, `createDeck`, `renameDeck`, `deleteDeck`
- `repositories/cards.js`: `listCards`, `createCard`, `updateCard`, `softDeleteCard`, `purgeCard`, `restoreCard`, `importCards`, `saveCards`
- `repositories/reviews.js`: `listDueCards`, `countDueCards`, `findCardForGrading`, `saveReviewGrade`, `listDeckStatistics`, `listReviewActivity`

No API or database contracts changed during extraction. The existing PostgreSQL pool remains shared by the route family modules through the app composition context.

## HTTP API inventory

All state-changing `/api` requests must use `application/json` and the `X-Requested-With: StudyBuddy` header. Login, logout, and session-status routes are mounted before authenticated API middleware; the remaining `/api` routes require a signed-in session. AI routes also use the shared 20-requests-per-minute limiter. `GET /health` is the public process health check and returns `{ "status": "ok" }`.

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/login` | Authenticate and establish the session cookie. |
| `POST /api/auth/logout` | Destroy the current session. |
| `GET /api/auth/me` | Return whether the current session is authenticated. |
| `POST /api/ai` | Send a Tutor question and conversation context for an AI response. |
| `POST /api/cards/generate` | Generate flashcards from a topic/source prompt. |
| `POST /api/generate-notes` | Generate notes from supplied document content. |
| `POST /api/generate-flashcards` | Generate flashcards from supplied document content. |
| `POST /api/generate-quiz` | Generate a quiz from supplied document content. |
| `GET /api/decks`, `POST /api/decks` | List decks or create a deck. |
| `PATCH /api/decks/:id`, `DELETE /api/decks/:id` | Rename or delete a deck. |
| `GET /api/cards`, `POST /api/cards` | List cards or create a card. |
| `PATCH /api/cards/:id`, `DELETE /api/cards/:id` | Update or delete a card; card deletion is soft by default, with an explicit purge option. |
| `POST /api/cards/:id/restore` | Restore a soft-deleted card. |
| `POST /api/cards/import` | Import a batch of cards. |
| `POST /api/cards/save` | Save selected generated cards. |
| `GET /api/review/next` | Read due cards and their total count; accepts optional `limit` and `deck_id`. |
| `POST /api/review/grade` | Grade an answer and persist its review and next spaced-repetition schedule. |
| `GET /api/stats/topics` | Read deck/topic statistics and 14-day review activity. |

AI generation and Tutor routes receive content included in the caller's request and can contact the configured AI provider. Local document, note, course, assignment, quiz, and timer records are not exposed as server CRUD APIs; their persistence is managed in browser IndexedDB.

## Validation

Run the focused project regression suite with `npm test`. It covers authentication/session behavior, route mounting and input validation, service parsing/validation, spaced repetition, calendar derivation, and backup validation/merge behavior. Browser checks that use real signed-in data should remain read-only unless isolated disposable data is available.

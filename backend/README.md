# Backend

The Node.js/Express backend serves the StudyBuddy browser app and provides its authenticated API. `server.js` is the process entrypoint and exports the Express app for tests; `backend/app/index.js` composes the middleware, routes, static hosting, and error handling.

## Request structure

Most API requests follow **routes → controllers → services and repositories**:

- `routes/` maps API paths to controller functions.
- `controllers/` validates inputs, coordinates services and repositories, and sends responses. Assignment-brief request handling lives here.
- `services/` contains shared AI parsing and validation, the provider-agnostic AI service, card normalization, assignment-brief validation, database error handling, owner IDs, and SM-2 scheduling.
- `repositories/` contains SQL-backed operations for assignment briefs, decks, cards, and reviews.
- `middleware/request.js` enforces authentication and JSON/CSRF requirements.

Authentication routes handle session login, logout, and status directly. The assignment-brief router maps paths to its controller, which uses the assignment-brief repository for persistence and the assignment-brief service for upload and extracted-text validation. The app wiring and remaining exceptions are described in [the architecture overview](../docs/architecture.md).

## Supporting modules

- `backend/config/prompts.js` stores AI prompts.
- `db/pool.js` owns the PostgreSQL pool and query helpers; `db/schema.sql` and `db/migrate.js` define and apply the schema.
- `scripts/hash-password.js` generates a bcrypt password hash.
- `backend/services/sm2.js` is the canonical spaced-repetition implementation; backend code and tests import it directly.
- The repository root contains `server.js`, `package.json`, and the root `index.html` static-host redirect. Express serves the actual app shell from `public/index.html`.

## Development

Install dependencies, configure `.env` from `.env.example`, apply migrations, then start the server:

```bash
npm install
npm run migrate
npm start
```

Run `npm test` for the regression suite. Database integration tests require `TEST_DATABASE_URL` to reference a dedicated test database.

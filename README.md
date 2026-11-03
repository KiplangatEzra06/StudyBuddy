# Margin - Study Desk

Margin is a single-user study app with local browser features and a Neon-backed flashcard/review system.

## Frontend and backend

- The app is served from the same Express origin (`public/`), so browser requests use relative `/api/...` URLs and cookie-based auth instead of tokens.
- The backend proxies AI requests to Ollama, validates JSON responses, and stores flashcard data in Neon Postgres.
- Local-only app data such as documents, notes, classes, assignments, quiz history, and timer sessions remain in IndexedDB.
- The frontend entrypoint and shared API/storage services are native modules under `frontend/`; backend application code is under `backend/`. See [docs/architecture.md](./docs/architecture.md).

## Local setup

```bash
npm install
cp .env.example .env
npm run migrate
npm start
```

Open `http://localhost:3000`.

## Required environment variables

Copy `.env.example` to `.env` and fill in these values:

- `ADMIN_USERNAME`: the single admin username
- `ADMIN_PASSWORD_HASH`: a bcrypt hash generated with `npm run hash-password`
- `SESSION_SECRET`: a long random string (32+ chars in production)
- `OLLAMA_API_KEY`: Ollama Cloud API key
- `OLLAMA_BASE_URL`: typically `https://ollama.com`
- `OLLAMA_MODEL`: default is `gpt-oss:20b`
- `DATABASE_URL`: Neon pooled PostgreSQL connection string with `sslmode=require`
- `PORT`: optional, defaults to `3000`

Do not expose secrets in frontend code.

## Create a bcrypt password hash

```bash
npm run hash-password -- "your password here"
```

If you want to avoid putting the password in your shell history, run the command without the password argument if your shell supports it, or use a prompt-based approach.

## Auth model

- The app uses a single-user login (`/api/auth/login`) with cookie sessions.
- Sessions are stored in Neon via `connect-pg-simple` and use a custom cookie name.
- All protected `/api/*` routes require a valid session.
- The browser never stores passwords or tokens in localStorage.

## API and database notes

- The app requires `DATABASE_URL` at startup; the server fails fast with a clear message if it is missing.
- The migration script is idempotent and creates the required database tables and indexes.
- The session table is created by the same migration flow.
- Protected state-changing routes require JSON content and the `X-Requested-With: StudyBuddy` header.

## Migration

```bash
npm run migrate
```

This is safe to rerun; it creates the schema and indexes if missing.

## Render deployment

Set the Render root directory to the repository root and use:

- Build: `npm install`
- Start: `npm start`

Add these environment variables in Render:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`
- `OLLAMA_API_KEY`
- `OLLAMA_BASE_URL=https://ollama.com`
- `OLLAMA_MODEL=gpt-oss:20b`
- `DATABASE_URL=<Neon pooled PostgreSQL connection string with sslmode=require>`

Render provides `PORT` automatically.

Only after you confirm the login works in production should you remove any old `ACCESS_TOKEN` env var from Render.

## Legacy data import

The app includes a temporary browser export/import flow for migrating existing local data from the old GitHub Pages origin:

1. Open the old site and use the export button to download a JSON backup file.
2. Open the Render app and use the import flow in Settings.
3. The import deduplicates flashcards by deck + front + back and keeps the backup locally in the browser.

## Security notes

- Passwords are never logged.
- Session IDs and cookies are never logged.
- AI and database failures are logged server-side, but request content is kept minimal and secrets are redacted.

## Key routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /health`
- `POST /api/cards/generate`
- `POST /api/cards/save`
- `GET /api/review/next`
- `POST /api/review/grade`
- `GET /api/stats/topics`

On first app load, existing browser flashcards are imported into Neon and deduplicated by deck name, front, and back. A copy of the pre-import local cards is kept in IndexedDB as `flashcards-local-backup`; the import completion marker is stored in this browser so it is only attempted once. If the import fails, the marker is not written, allowing a retry without losing the backup.

Open Settings to export all documents, classes, assignments, flashcards, notes, quiz history, and timer sessions to a JSON backup, or import a backup. Imports merge by record ID and keep existing records when IDs collide. Backups created before classes and assignments were added remain supported. Tutor access tokens and notification permissions are not included.

Flashcards and notes also retain their individual export/import controls.

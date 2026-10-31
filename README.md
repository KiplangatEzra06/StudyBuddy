# Margin - Study Desk

Margin is a local-first study web app with documents, AI notes, AI flashcards, quiz generation, a focus timer, manual notes, and progress tracking.

## Navigation and appearance

The app uses a responsive sidebar for its study pages, with a mobile menu on smaller screens. Choose Light, Dark, or System in Settings; the top-bar theme button quickly switches between light and dark. Theme choice is saved in this browser.

## Setup

### Frontend

The frontend is served by Express from `public/` (`public/index.html`, `public/app.js`, `public/styles.css`, and the icons/manifest). There is no frontend build step. Run the server and open `http://localhost:3000`; do not open the HTML file directly. Documents, classes, assignments, notes, quiz results, and timer sessions are stored in IndexedDB; flashcards and review history are stored in Neon.

The repository-root `index.html` is a temporary GitHub Pages transition page. It exports the old origin's local data and then redirects to the Render app. The actual app entry point is `public/index.html`.

PDF parsing uses pdf.js from a CDN. TXT files work with the browser File API.

### Backend

The Tutor tab and AI generation features call the Express backend, which proxies requests to Ollama Cloud.

```bash
npm install
```

Copy `.env.example` to `.env` and set `OLLAMA_API_KEY`, `ACCESS_TOKEN`, and `DATABASE_URL`. Use the Neon pooled PostgreSQL connection string with `sslmode=require`. The frontend and API are same-origin; no CORS origin setting is required or enabled.

Run `npm run migrate` once to create or update the database tables, then run `npm start` and open the app at `http://localhost:3000`. The migration is idempotent and upgrades existing Study Loop cards into named decks. The Tutor panel saves the access token in this browser and sends it only to the backend.

The token is a solo-use gate, not a way to secure a public frontend: anyone with access to the site can inspect requests and use the token. Keep the frontend private and rotate the token if access changes.

## Backend Routes

- `POST /api/ai` with `{ "input": "...", "history": [] }`, returns `{ "reply": "..." }`
- `POST /api/generate-notes`
- `POST /api/generate-flashcards`
- `POST /api/generate-quiz`
- `POST /api/cards/generate` with `{ "notes": "...", "topic": "...", "count": 5 }` to generate an editable card preview without saving it
- `GET /api/decks`, `POST /api/decks`, `PATCH /api/decks/:id`, and `DELETE /api/decks/:id` for deck management
- `GET /api/cards`, `POST /api/cards`, `PATCH /api/cards/:id`, and `DELETE /api/cards/:id` for card CRUD; card deletes are soft-deleted briefly so the app's Undo action can restore them
- `POST /api/cards/import` to import/dedupe cards by deck, front, and back
- `POST /api/cards/save` with `{ "deck_id": "...", "cards": [{ "front": "...", "back": "..." }] }` to save selected generated cards to Neon
- `GET /api/review/next?limit=10&deck_id=...` to fetch due cards and the due count, optionally scoped to a deck
- `POST /api/review/grade` with `{ "card_id": "...", "user_answer": "...", "response_ms": 12000 }` to AI-grade an answer and schedule the next review using SM-2
- `GET /api/stats/topics` for deck mastery and the last 14 days of review activity
- `GET /health`

The document generation routes expect a document payload with extracted text and return validated JSON that the frontend can render and store. Every `/api` request requires the `x-access-token` header. Flashcards, decks, and reviews are stored in Neon. Documents, notes, classes, assignments, quiz history, and timer sessions remain in browser IndexedDB.

## Features

- Documents: upload PDF/TXT, extract text, store raw file plus text, organize by course and unit, favorite, search, sort, track reading progress.
- AI Notes: generate structured notes from a document, visually tag them as AI generated, and edit them afterward.
- AI Flashcards: generate source-grounded basic, definition, and fill-in-the-blank cards; review and edit generated cards before studying.
- Quiz: generate and grade distinct multiple choice, true/false, fill-in-the-blank, and short-answer questions with explanations. Invalid or duplicate generated items are discarded.
- Classes and calendar: save course details and recurring weekly meeting times, create and track assignments, and view meetings and due dates by week.
- Assignment reminders: opt into browser notifications and set a reminder time per assignment. Notifications are local to this browser and require StudyBuddy to remain open.
- Timer: Pomodoro-style work/break timer that logs completed work sessions against a course/unit.
- Dashboard: see today's recurring classes, assignments due soon, focus time, completed assignments, and flashcards to review, with a shortcut to continue reading or study.
- Progress: review study time, completed documents, quiz accuracy, flashcard mastery, sessions this week, and course/unit breakdowns.

## Deployment Note

Express serves the complete app and API from the same Render origin. API calls use relative `/api/...` paths. CORS is disabled; only same-origin browser requests are supported. There is no service worker or offline asset cache, so the app shell must be loaded online. Data remains stored in IndexedDB while offline, but API-backed flashcards and AI features require a connection.

In Render, set the Root Directory to the repository root, Build Command to `npm install`, and Start Command to `npm start`. There is no `render.yaml` or frontend build command. Add these environment variables in Render's dashboard: `OLLAMA_API_KEY`, `OLLAMA_BASE_URL` (`https://ollama.com`), `OLLAMA_MODEL` (`gpt-oss:20b`), `ACCESS_TOKEN` (a long random value), and `DATABASE_URL` (the Neon pooled connection string with `sslmode=require`). Render supplies `PORT` automatically.

Before deploying the Flashcards/Study Loop endpoints, set `DATABASE_URL` in the Render service and run `npm run migrate` against that same Neon database. Run this migration once for each database/environment; it is safe to rerun. It creates the decks table, adds `cards.deck_id`, and migrates existing free-text card topics into decks. The server fails at startup with a clear message if `DATABASE_URL` is missing. Do not put database or Ollama credentials in frontend code.

## Moving from GitHub Pages

The root `index.html` is the replacement page for the old GitHub Pages origin. If Pages is configured from this repository, publish it there; if the old site uses a separate repository, copy this root `index.html` into that site's root. Preserve the old site's origin so the page can still read that origin's IndexedDB. Its **Export data** button downloads `studybuddy-origin-transfer.json` in the same `studybuddy-data` version 1 format used by StudyBuddy backups. The file contains the local collections (including flashcards) plus allowlisted preferences; credentials are never exported. On the new Render app, use **Settings → Import from file**. The app sends flashcards through the existing authenticated `/api/cards/import` endpoint, which deduplicates by deck and front/back text; other local collections merge by ID.

Migration order:

1. Configure Render environment variables and run `npm run migrate` against the intended Neon database.
2. Deploy the Render service and confirm its app opens at `https://studybuddy2-r2i6.onrender.com`.
3. Publish the repository-root `index.html` as the old GitHub Pages site's entry page. Open that old origin, click **Export data**, and keep the downloaded JSON file.
4. On the Render site, enter the same `ACCESS_TOKEN` in Settings, then choose **Import from file** and select the downloaded JSON.
5. Confirm the flashcards and other data are present before clearing browser data or removing the old transition page.

`FRONTEND_ORIGIN` is no longer used and can be removed from the Render environment.

## Data

Documents, notes, classes, assignments, quiz history, timer sessions, and tutor conversations are stored locally in the browser through IndexedDB. Flashcards, decks, and review history are stored in Neon and are shared across browsers using the same backend.

On the first app load after this change, existing browser flashcards are imported into Neon and deduplicated by deck name, front, and back. A copy of the pre-import local cards is kept in IndexedDB as `flashcards-local-backup`; the import completion marker is stored in this browser so it is only attempted once. If the import fails, the marker is not written, allowing a retry without losing the backup.

Open Settings to export all documents, classes, assignments, flashcards, notes, quiz history, and timer sessions to a JSON backup, or import a backup. Imports merge by record ID and keep existing records when IDs collide. Backups created before classes and assignments were added remain supported. Tutor access tokens and notification permissions are not included.

Flashcards and notes also retain their individual export/import controls.

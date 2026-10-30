# Margin - Study Desk

Margin is a local-first study web app with documents, AI notes, AI flashcards, quiz generation, a focus timer, manual notes, and progress tracking.

## Setup

### Frontend

Open `index.html` in a modern browser. Keep `styles.css` and `app.js` alongside it: the stylesheet contains the app's presentation, and the JavaScript file contains its existing app behavior and integrations. The app stores local data in IndexedDB, so documents, notes, flashcards, quiz results, and timer sessions survive page reloads in the same browser.

PDF parsing uses pdf.js from a CDN. TXT files work with the browser File API.

### Backend

The Tutor tab and AI generation features call the Express backend, which proxies requests to Ollama Cloud.

```bash
npm install
```

Copy `.env.example` to `.env` and set `OLLAMA_API_KEY`, `ACCESS_TOKEN`, and `FRONTEND_ORIGIN`. For local use, `FRONTEND_ORIGIN` is `http://localhost:3000`; run `npm start` and open the app at that address. The Tutor panel saves the access token in this browser and sends it only to the backend.

The token is a solo-use gate, not a way to secure a public frontend: anyone with access to the site can inspect requests and use the token. Keep the frontend private and rotate the token if access changes.

## Backend Routes

- `POST /api/ai` with `{ "input": "...", "history": [] }`, returns `{ "reply": "..." }`
- `POST /api/generate-notes`
- `POST /api/generate-flashcards`
- `POST /api/generate-quiz`
- `GET /health`

The document generation routes expect a document payload with extracted text and return validated JSON that the frontend can render and store. Every `/api` request requires the `x-access-token` header.

## Features

- Documents: upload PDF/TXT, extract text, store raw file plus text, organize by course and unit, favorite, search, sort, track reading progress.
- AI Notes: generate structured notes from a document, visually tag them as AI generated, and edit them afterward.
- AI Flashcards: generate editable basic, definition, and fill-in-the-blank cards from documents.
- Quiz: generate and grade multiple choice, true/false, fill-in-the-blank, and short-answer questions with explanations.
- Timer: Pomodoro-style work/break timer that logs completed work sessions against a course/unit.
- Progress: dashboard for study time, completed documents, quiz accuracy, flashcard mastery, sessions this week, and course/unit breakdowns.

## Deployment Note

`index.html` loads `app.js` from the same directory. The app's default backend URL is configured at the start of `app.js`; update `window.MARGIN_API_BASE` if the frontend is hosted separately from the backend. Set `FRONTEND_ORIGIN` in Render to the exact browser origin, without a trailing slash.

Add these environment variables in Render's dashboard: `OLLAMA_API_KEY`, `OLLAMA_BASE_URL` (`https://ollama.com`), `OLLAMA_MODEL` (`gpt-oss:20b`), `ACCESS_TOKEN` (a long random value), and `FRONTEND_ORIGIN` (the exact frontend origin). Render supplies `PORT` automatically.

## Data

All study data is stored locally in the browser through IndexedDB. There is no backend database in this MVP.

Use export/import for flashcards and notes if you want a portable backup.

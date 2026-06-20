# Margin - Study Desk

Margin is a local-first study web app with documents, AI notes, AI flashcards, quiz generation, a focus timer, manual notes, and progress tracking.

## Setup

### Frontend

Open `StudyBuddy.html` in a modern browser. The app stores local data in IndexedDB, so documents, notes, flashcards, quiz results, and timer sessions survive page reloads in the same browser.

PDF parsing uses pdf.js from a CDN. TXT files work with the browser File API.

### Backend

The Tutor tab and AI generation features require the Express backend so the Anthropic API key stays server-side.

```bash
npm install
cp .env.example .env
npm start
```

Create `.env` with:

```text
ANTHROPIC_API_KEY=sk-ant-...your-key-here...
PORT=3000
CORS_ORIGIN=*
```

Optional:

```text
ANTHROPIC_MODEL=claude-opus-4-1
```

## Backend Routes

- `POST /api/tutor`
- `POST /api/generate-notes`
- `POST /api/generate-flashcards`
- `POST /api/generate-quiz`
- `GET /health`

The AI generation routes expect a document payload with extracted text and return JSON that the frontend can render and store.

## Features

- Documents: upload PDF/TXT, extract text, store raw file plus text, organize by course and unit, favorite, search, sort, track reading progress.
- AI Notes: generate structured notes from a document, visually tag them as AI generated, and edit them afterward.
- AI Flashcards: generate editable basic, definition, and fill-in-the-blank cards from documents.
- Quiz: generate and grade multiple choice, true/false, fill-in-the-blank, and short-answer questions with explanations.
- Timer: Pomodoro-style work/break timer that logs completed work sessions against a course/unit.
- Progress: dashboard for study time, completed documents, quiz accuracy, flashcard mastery, sessions this week, and course/unit breakdowns.

## Deployment Note

`StudyBuddy.html` uses `http://localhost:3000` when opened locally. For GitHub Pages, set `window.MARGIN_API_BASE` before the main script or replace `https://YOUR-BACKEND-URL-HERE` with the deployed backend URL.

## Data

All study data is stored locally in the browser through IndexedDB. There is no backend database in this MVP.

Use export/import for flashcards and notes if you want a portable backup.

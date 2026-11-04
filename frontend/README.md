# Frontend

`public/index.html` remains the served application shell. Its stylesheet order is `design-tokens.css`, `styles.css`, then `components.css`, so shared variables are available to page styles and shared primitives provide the final common control states. `public/app.js` is the browser-module entrypoint; it imports `app/main.js`, which loads the current runtime.

## Design system

- `public/design-tokens.css` is the source of truth for theme colors, spacing, radii, typography, shadows, focus rings, and layer levels.
- `public/components.css` defines shared button, form-control, and panel behavior. Button hover states retain their base colors and rely on focus, shadow, and motion cues rather than color changes.
- `public/styles.css` retains app-shell and feature-specific layout rules.
- The sidebar groups existing destinations by workspace, planner, library, learning, productivity, and insights. Assignments reuses the existing assignment view; Study Sessions focuses the existing timer-session history. Desktop sidebar collapse state is stored in local storage, and narrow layouts retain the keyboard-operable mobile drawer.
- The dashboard is a read-only summary of existing schedule, activity, document, quiz, focus-session, and flashcard data. Its sections expose loading, empty, and error states; quick actions route to existing features.

## Runtime modules

- `app/runtime.js` coordinates shared state, DOM rendering, and cross-feature interactions.
- `services/api.js` owns same-origin, cookie-authenticated API requests, timeout handling, and unauthorized-session callbacks.
- `services/storage.js` owns the existing IndexedDB `margin-db` / `kv` access functions.
- `features/calendar-data.js` owns calendar date keys, schedule event derivation, and next-event selection without DOM access.
- `features/backup-data.js` owns backup schema validation and ID-preserving collection merges.
- `features/tutor-markdown.js` renders sanitized Tutor Markdown, scrollable tables, code blocks, and source citations without changing stored conversation text.

Express serves this directory at `/frontend`. There is no frontend build step, and the page continues to use the same-origin API and existing local data. Calendar event derivation and backup validation/merging are separate feature modules; their DOM, storage, and interaction flows remain coordinated by the runtime.

## Browser data and feature boundaries

`services/storage.js` stores values in IndexedDB database `margin-db` (version 1), in the single `kv` object store (`keyPath: "key"`). Current application keys are:

| Key | Used by |
| --- | --- |
| `documents` | Local document metadata and extracted text |
| `notes` | Notes and notebooks |
| `quizResults` | Quiz attempts |
| `timerSessions` | Completed focus sessions |
| `classes`, `assignments` | Course schedule and deadlines |
| `tutorConversations` | Tutor chat history |
| `deletedRecords` | Short-lived undo snapshots |
| `studybuddy-note-cleanup-version` | One-time note migration marker |

`cards` and `flashcards-local-backup` are legacy local flashcard migration keys. Current decks and cards are server-backed through the authenticated API; the application no longer treats those legacy values as the active card store.

Small UI preferences are kept in `localStorage`: `studybuddy-theme`, `studybuddy-tutor-material`, `studybuddy-assignment-reminders`, `studybuddy-timer-sound`, `studybuddy-timer-notification`, `studybuddy-sidebar-collapsed`, and `studybuddy-active-conversation`. The active flashcard view is session-only. Backup export includes the supported local collections and a restricted allowlist of user preferences; credentials and server session data are excluded.

| Feature | Data relationship |
| --- | --- |
| Courses, assignments, Calendar | Calendar events are derived from local `classes` and `assignments`; editing those views changes the same records. |
| Documents, Notes, Quiz | Documents and extracted text stay in browser storage. Notes and quiz results are local; AI-assisted generation requires an explicit action. |
| AI Tutor | Conversation history is local. When study material is enabled and a question is sent, relevant excerpts are sent to the configured backend AI provider. |
| Focus Timer, Study Sessions, Progress | Completed timer sessions are local; Study Sessions and Progress read them alongside quiz, document, course, and server-backed flashcard statistics. |
| Settings | Backup/restore works across the supported local collections and preferences; clear-history actions affect only their named collections. |

The automated regression command is `npm test`. Manual browser smoke checks should use existing records and avoid upload/import, deletion, AI generation, quiz submission, and timer completion unless disposable test data is explicitly available.

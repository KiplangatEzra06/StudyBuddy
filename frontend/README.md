# Frontend

`public/index.html` remains the served application shell. Its stylesheet order is `design-tokens.css`, `styles.css`, then `components.css`, so shared variables are available to page styles and shared primitives provide the final common control states. `public/app.js` is the browser-module entrypoint; it imports `app/main.js`, which loads the current runtime.

## Design system

- `public/design-tokens.css` is the source of truth for theme colors, spacing, radii, typography, shadows, focus rings, and layer levels.
- `public/components.css` defines shared button, form-control, and panel behavior. Button hover states retain their base colors and rely on focus, shadow, and motion cues rather than color changes.
- `public/styles.css` retains app-shell and feature-specific layout rules.
- The sidebar groups existing destinations by workspace, planner, library, learning, productivity, and insights. Assignments reuses the existing assignment view; Study Sessions focuses the existing timer-session history. Desktop sidebar collapse state is stored in local storage, and narrow layouts retain the keyboard-operable mobile drawer.
- The dashboard is a read-only summary of existing schedule, activity, document, quiz, focus-session, and flashcard data. Its sections expose loading, empty, and error states; quick actions route to existing features.

## Runtime modules

- `app/runtime.js` coordinates DOM rendering and cross-feature interactions. Shared mutable data lives in `shared/state.js`.
- `shared/state.js` exports one `state` object holding documents, cards, decks, notes, tutor/chat, timer, calendar, and related UI session fields.
- `shared/constants.js` holds storage keys and `WEEKDAY_NAMES`.
- `shared/bus.js` provides a tiny `emit` / `on` / `off` pub/sub for cross-feature calls (no feature-to-feature imports).
- `shared/dom.js` — `$`, `escapeHtml`, `setStatus`, `createSvgElement`, `selectAccessibleName`.
- `shared/format.js` — `uid`, date/size/text helpers, `shuffle`, `slugify`, and related pure formatters.
- `shared/custom-select.js` — custom select enhancement and keyboard handling (`initializeCustomControls`).
- `shared/fit-paginator.js` — container-fitting list pagination helpers.
- `shared/undo.js` — deletion confirmations, soft-delete snapshots, and undo toast flow (`initUndo` wires flashcard/render callbacks).
- `shared/files.js` — `downloadJSON`, `readJSONFile`, `downloadText`.
- `services/api.js` owns same-origin, cookie-authenticated API requests, timeout handling, and unauthorized-session callbacks.
- `services/assignment-briefs-api.js` wraps `/api/assignments` brief list/validate/save/remove calls through `createApiClient`, plus shared size/type constants.
- `services/storage.js` owns the existing IndexedDB `margin-db` / `kv` access functions.
- `features/calendar-data.js` owns calendar date keys, schedule event derivation, and next-event selection without DOM access.
- `features/calendar.js` owns calendar DOM rendering, period navigation, day dialog, and agenda wiring; exports `init` and `renderCalendar`. Assignment markup/actions and reminder sync arrive through `init(deps)`.
- `features/classes.js` owns course list/forms and the classes/assignments panel toggle; exports `init`, `renderClasses`, and `formatMeetingDays`. Mutations emit `classes:changed`.
- `features/assignments.js` owns assignment list/forms, markup/actions, and browser reminder controls (including the 30s check interval); exports `init`, list/form helpers, and reminder helpers. Mutations emit `assignments:changed`.
- `features/assignment-brief.js` owns the assignment brief dialog (file/paste upload, validate-then-save, remove) and hydrates `briefDocumentId` from the server on load; mutations emit `assignment-brief:changed`.
- `features/documents.js` owns document upload/parsing, library list, reader paging, taxonomy datalists, and document source selects; mutations emit `documents:changed` so tutor/notes/quiz/flashcard source dropdowns refresh.
- `features/quiz.js` owns quiz generation, answering, grading into `quizResults`, and mistake review; flashcard creation from mistakes goes through `bus.emit('flashcards:create-from-mistakes', ...)`.
- `features/backup-data.js` owns backup schema validation and ID-preserving collection merges.
- `features/tutor-markdown.js` renders sanitized Tutor Markdown, scrollable tables, code blocks, and source citations without changing stored conversation text.
- `features/timer.js` owns the focus timer UI, tick loop, sound/notification preferences, and session logging; exports `init` and `renderTimer`. Logged sessions notify other features via `bus.emit('timer:session-logged')`.

Express serves this directory at `/frontend`. There is no frontend build step, and the page continues to use the same-origin API and existing local data. Calendar event derivation stays in `calendar-data.js`; calendar/classes/assignments DOM flows live in their feature modules and re-render peers through the shared bus. Backup validation/merging remains a separate feature module coordinated by the runtime.

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

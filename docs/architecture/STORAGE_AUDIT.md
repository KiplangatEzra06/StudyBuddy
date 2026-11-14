# Storage Audit

## Executive summary

StudyBuddy uses a hybrid storage model:

- PostgreSQL as the durable, authoritative application database
- IndexedDB as the local browser workspace for app-specific offline and local-only data

This hybrid model is consistent with the approved architecture and should be treated as a deliberate boundary, not a temporary accident.

## PostgreSQL storage

### Current implementation

PostgreSQL is configured in `db/pool.js` and requires `DATABASE_URL` at startup. The database connection is created via `new Pool({ connectionString: process.env.DATABASE_URL, ... })`.

### Database tables and records currently stored in PostgreSQL

The schema defines:

- `session` — server-side session records
- `decks`, `cards`, and `reviews` — server-backed flashcard and review state
- `assignment_workspaces` — owner-scoped assignment JSON snapshot, brief identifiers/metadata, extracted text, and status

The AI generation endpoints do not generally persist generated notes, quizzes, or tutor messages. Generated cards enter PostgreSQL when explicitly saved/imported. Assignment brief upload bytes are validated but are not persisted as file blobs in PostgreSQL or an object store.

### Gap analysis

PostgreSQL is authoritative for server-backed sessions, cards/decks/reviews, and saved assignment workspaces. There is no general PostgreSQL CRUD API for documents, notes, classes, assignments, quizzes, timer sessions, or tutor conversations. A feature-to-table ownership map should be maintained as server persistence expands.

## IndexedDB storage

### Current implementation

The frontend storage service stores values in one IndexedDB database (`margin-db`) with one key/value object store (`kv`). Current keys include:

- `documents`, `notes`, `classes`, `assignments`
- `quizResults`, `timerSessions`, `tutorConversations`
- `deletedRecords` and note/notebook metadata keys
- `flashcards-local-backup` and migration-related values

UI preferences also use `localStorage`; they are not stored in IndexedDB.

### Strengths

- Well suited for a single-user desktop-style study app
- Provides browser-local persistence and permits local feature use without a server CRUD endpoint
- Keeps user workspace data close to the browser without forcing server CRUD for every ephemeral action

### Risks and concerns

- The helper catches IndexedDB failures and returns `false`/`undefined`, so callers must check results to avoid treating failed writes as successful.
- The flashcard migration/import path has separate local backup and server save behavior that must preserve its retry guarantees.
- There is no general synchronization protocol between IndexedDB records and PostgreSQL; the stores mostly own distinct records rather than acting as replicas.
- A future feature expansion may need a stronger local-to-cloud reconciliation model

## File and document storage

The app includes file handling and study materials, but the repository still treats these as mostly browser-local features rather than full server-managed document stores.

Observed reality:

- Local document workflows are in `frontend/features/documents.js`
- Browser storage reads and writes are handled in `frontend/services/storage.js`
- Assignment-brief bytes are sent to the server for validation, but the schema persists extracted text and metadata rather than original file bytes.
- The app provides browser import/export and local backup workflows.

This is reasonable for a single-user local workspace but should be treated as a deliberate local authority boundary.

## Offline synchronization concerns

The current architecture is suitable for desktop-style offline usage, but several considerations remain:

1. There is no formal protocol for synchronizing the same records across IndexedDB and PostgreSQL; current data is mostly partitioned by feature.
2. Flashcard import/migration and assignment snapshots have cross-store behavior that should keep explicit merge/retry rules.
3. If additional features become server-backed, IDs, conflict handling, retries, and deletions/tombstones will need a defined contract.

## Migration risks

The biggest migration risks are not in the existence of PostgreSQL; they are in:

- moving browser-owned records to PostgreSQL without a verified export/import and reconciliation plan
- loss or duplication during the existing browser flashcard migration/import flow
- assignment brief metadata/text being mistaken for retained original files
- stale references to previous provider implementations or older data flows

## Recommended storage strategy

1. Define PostgreSQL as authoritative for durable server domain data.
2. Define IndexedDB as authoritative for local workspace, offline, and browser-specific state.
3. Keep backups and import/export flows as local browser features unless a clear server-owned need emerges.
4. Add explicit reconciliation rules before broadening the app beyond single-user workflows.
5. Treat data ownership as a first-class architectural contract, not a side effect of implementation convenience.

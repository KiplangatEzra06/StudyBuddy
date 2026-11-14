# Storage Audit

## Executive summary

StudyBuddy uses a hybrid storage model:

- PostgreSQL as the durable, authoritative application database
- IndexedDB as the local browser workspace for app-specific offline and local-only data

This hybrid model is consistent with the approved architecture and should be treated as a deliberate boundary, not a temporary accident.

## PostgreSQL storage

### Current implementation

PostgreSQL is configured in `db/pool.js` and requires `DATABASE_URL` at startup. The database connection is created via `new Pool({ connectionString: process.env.DATABASE_URL, ... })`.

### Durable records currently associated with PostgreSQL

Based on code and documentation, PostgreSQL is used for:

- auth sessions
- flashcards and decks
- card review state and scheduling data
- assignment brief metadata and storage-related processing
- user-facing server-backed application data
- AI-backed generated learning records where durable persistence is required

### Gap analysis

The current system is generally aligned with the approved architecture; however, a formal schema ownership map is still useful to prevent future drift. The major data ownership question is not whether PostgreSQL is used, but exactly which features are allowed to become authoritative in the server tier.

## IndexedDB storage

### Current implementation

The frontend service layer stores local app data in IndexedDB. This is the primary path for:

- documents
- notes
- classes
- assignments
- quiz history
- timer sessions
- tutor history
- import/export backup data
- local UI preferences and undo snapshots

### Strengths

- Well suited for a single-user desktop-style study app
- Supports offline behavior and local working copies
- Keeps user workspace data close to the browser without forcing server CRUD for every ephemeral action

### Risks and concerns

- Local data can drift away from PostgreSQL-backed records if ownership is not explicit
- Synchronization is not yet fully formalized across local and server stores
- A future feature expansion may need a stronger local-to-cloud reconciliation model

## File and document storage

The app includes file handling and study materials, but the repository still treats these as mostly browser-local features rather than full server-managed document stores.

Observed reality:

- Local document workflows are in `frontend/features/documents.js`
- Browser storage reads and writes are handled in `frontend/services/storage.js`
- The app plans for import/export and local data backup within the browser

This is reasonable for a single-user local workspace but should be treated as a deliberate local authority boundary.

## Offline synchronization concerns

The current architecture is suitable for desktop-style offline usage, but several considerations remain:

1. There is no formal synchronization protocol for reconciling local IndexedDB changes with server-backed PostgreSQL data.
2. Mixed local/server ownership increases the importance of explicit merge rules.
3. Duplicate records and stale revision states are a risk if the system later expands beyond single-user use.

## Migration risks

The biggest migration risks are not in the existence of PostgreSQL; they are in:

- unclear ownership of records created in the browser versus those created on the server
- partial migration of older browser data into the server-side flow
- stale references to previous provider implementations or older data flows

## Recommended storage strategy

1. Define PostgreSQL as authoritative for durable server domain data.
2. Define IndexedDB as authoritative for local workspace, offline, and browser-specific state.
3. Keep backups and import/export flows as local browser features unless a clear server-owned need emerges.
4. Add explicit reconciliation rules before broadening the app beyond single-user workflows.
5. Treat data ownership as a first-class architectural contract, not a side effect of implementation convenience.

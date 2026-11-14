# Storage Audit

## Executive summary

The approved direction is PostgreSQL as the authoritative store for server-backed records and IndexedDB for approved offline functionality, local caching, and queued local operations. The current implementation is a transitional hybrid: several important workspace domains are local-only, and a general synchronization queue/protocol was not identified. Do not treat all IndexedDB records as replicas or move them without an approved migration plan.

## Current PostgreSQL implementation

`db/pool.js` creates a `pg.Pool` using `DATABASE_URL`; startup requires the URL. No ORM was identified. `db/schema.sql` currently creates or updates:

| Table | Current contents / relationship |
|---|---|
| `session` | `connect-pg-simple` session store |
| `decks` | Deck names; no user ownership column |
| `cards` | Card content, schedule/review fields and metadata; `deck_id` references `decks` with cascade delete |
| `reviews` | Review events referencing cards with cascade delete |
| `assignment_workspaces` | Composite key `(owner_id, assignment_id)`; JSON assignment snapshot, brief metadata, extracted text/status |

Other observed database facts:

- Indexes cover due dates, topic/deck, soft deletion, review card/time, session expiry, and assignment owner/update time.
- Assignment brief requests validate file bytes, but original bytes are not retained in PostgreSQL or identified external object storage.
- AI output is not generally persisted by generation endpoints; cards are persisted when explicitly saved/imported.
- Cards/decks/reviews are not multi-user scoped; assignment workspaces use an owner key derived from the configured username.

## Migration and recovery

- `npm run migrate` reads and executes the complete `db/schema.sql`.
- The schema uses `IF NOT EXISTS`, conditional `ALTER`, and guarded constraints, so rerunning is intended to be idempotent.
- There are no ordered/versioned migration files or migration ledger.
- `npm start` does not run migrations; deployment instructions do not establish an automatically verified migration stage.
- No backup schedule, restore runbook, point-in-time recovery setting, or restore test was verified.
- The choice of migration framework and production backup approach remains unresolved. Do not change production data during planning.

Risks: schema order/history is difficult to audit; schema changes may be safe to rerun but are not necessarily reversible; recovery capability is unknown without an independently verified backup and restore test.

## Current IndexedDB and localStorage implementation

`frontend/services/storage.js` uses the browser-native IndexedDB API (there is no `idb` package dependency). It opens one database, `margin-db`, with one object store, `kv`, and stores whole values by string key. Keys include:

- `documents`, `notes`, `classes`, `assignments`
- `quizResults`, `timerSessions`, `tutorConversations`
- `deletedRecords`, note/notebook metadata
- `flashcards-local-backup` and migration-related values

UI preferences use `localStorage`. This is not a normalized domain schema and no general offline operation queue/sync protocol was found. Approved future use of IndexedDB includes local caches and queued operations; queues, replay, conflict handling and idempotency are not established in the current code.

Storage helper behavior is significant: `idbSet`/`idbSetMany` catch failures, log a warning and return `false`; `idbGet` returns `undefined` on failure as well as for a missing key. Callers must inspect save outcomes and, where needed, distinguish unavailable storage from a missing record.

## Ownership matrix

| Data | Current store | Current authority / concern |
|---|---|---|
| Login sessions | PostgreSQL | Server authoritative |
| Decks, cards, review scheduling/history | PostgreSQL | Server authoritative for current app flow; records not multi-user scoped |
| Classes and ordinary assignments | IndexedDB | Browser-local only; no general server CRUD |
| Assignment brief workspace | PostgreSQL snapshot plus local assignment record | Dual representation; explicit source-of-truth/update/delete behavior must be retained |
| Documents and notes | IndexedDB | Browser-local; AI generation may consume selected content but does not generally persist generated output server-side |
| Quiz history, timer sessions, Tutor conversations | IndexedDB | Browser-local, not server-synced |
| UI preferences | localStorage | Browser-specific |
| Original assignment brief file bytes | Not retained by server | Only validated in request; decide whether durable file retrieval is required |
| Embeddings/vector index | Not present | No vector database or embedding schema identified |

## Documents, retrieval, OCR and files

- Document UI/data handling is in `frontend/features/documents.js` and `frontend/services/storage.js`.
- Tutor material chunking, indexing and retrieval currently occur in `frontend/features/tutor-sources.js` in the browser. Selected references are included with the Tutor request; this is not server-managed retrieval or a vector database.
- Assignment brief upload validation is a server request; `assignment_workspaces` stores metadata and extracted/pasted text, not original bytes.
- OCR is not implemented and is explicitly deferred beyond v1. Keep document processing extensible for OCR later; do not introduce it as Phase 1 work without approval.
- Ownership links between original files, extracted text, metadata, chunks and future embeddings are not yet represented as a server-side model.

## Migration and offline-sync risks

1. Migrating local notes/documents/classes/assignments/quizzes/timer/Tutor data requires inventorying actual record shapes and IDs, export/backup, idempotent import, validation, count/content verification, and rollback.
2. Do not clear IndexedDB until cloud data has been verified and a rollback decision approved.
3. Ordinary assignment records are local while assignment briefs can save a PostgreSQL snapshot; update/delete conflict rules need definition before either representation changes.
4. Flashcard legacy migration needs to preserve backup and retry behavior; the completion marker must not be written before successful import.
5. Any future queued operations need stable IDs, idempotency, retry bounds, conflict policy, deletion/tombstone semantics, and user-visible failure/recovery.
6. If multi-user access is introduced, add ownership to all relevant records and enforce it on every read/write before exposing cross-account access.
7. File retention/deletion must propagate to extracted text, chunks, indexes, caches and backups if those stores are later added.

## Recommendations and unresolved choices

- Preserve the approved principle: PostgreSQL is authoritative for server-backed records; IndexedDB provides approved offline/local caching and queued operations.
- Keep current local-only features local until a domain-level migration is approved and tested.
- Create an explicit ownership/lifecycle contract for every feature, including whether IndexedDB is authoritative, a cache, a queue, or a draft store.
- Decide on versioned migrations and backup/recovery verification before adding production schema expansion.
- Resolve whether uploaded assignment files must be retrievable, then choose retention/storage accordingly.
- Define offline queue and conflict behavior only when a specific synchronization feature is approved.

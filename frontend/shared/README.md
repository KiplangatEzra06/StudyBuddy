# Shared frontend modules

- `state.js` — single exported `state` object for all shared mutable application data. Feature modules and `app/runtime.js` read and write `state.*` instead of module-level `let` copies.
- `constants.js` — storage keys (`studybuddy-*`) and `WEEKDAY_NAMES`.
- `bus.js` — `on` / `off` / `emit` pub/sub for cross-feature communication without feature-to-feature imports.
- `dom.js` — `$`, `escapeHtml`, `setStatus`, `createSvgElement`, `selectAccessibleName`.
- `format.js` — `uid`, `formatBytes`, `truncateText`, `formatDueDate`, `pluralizeCount`, `formatStudyDuration`, `safeFileName`, `normalizeAnswer`, `courseUnitKey`, `shuffle`, `slugify`.
- `custom-select.js` — custom `<select>` enhancement from `syncCustomSelect` through `initializeCustomControls`.
- `fit-paginator.js` — `paginateToFit`, `refreshFitPaginators`, `showFitItem`, `releaseFitPaginator`.
- `undo.js` — `confirmDeletion`, soft-delete / undo helpers; call `initUndo({ flashcardApi, refreshFlashcardData, renderEverything })` from the runtime.
- `files.js` — `downloadJSON`, `readJSONFile`, `downloadText`.

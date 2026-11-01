# Frontend module map

This folder documents the intended frontend organization for the redesign without changing the runtime behavior of the current app.

## Existing runtime files

- `../public/index.html` — shell markup
- `../public/styles.css` — existing styling layer
- `../public/app.js` — current app logic and feature wiring

## Target split for later stages

- `app/` — bootstrap, routing/view switching, app lifecycle, and global state
- `shared/` — buttons, forms, modals, toasts, cards, utility UI pieces
- `services/` — API client, IndexedDB wrapper, local persistence adapters
- `features/` — dashboard, calendar, classes, documents, notes, tutor, flashcards, quiz, timer, progress, settings
- `styles/` — design tokens and feature-specific styles
- `utils/` — shared helper functions

The app is intentionally left as-is in Stage B so the redesign can proceed later without an accidental UI change.

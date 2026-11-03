# Frontend

`public/index.html` and `public/styles.css` remain the served application shell and visual layer. `public/app.js` is the browser-module entrypoint; it imports `app/main.js`, which loads the current runtime.

## Runtime modules

- `app/runtime.js` coordinates shared state, DOM rendering, and cross-feature interactions.
- `services/api.js` owns same-origin, cookie-authenticated API requests, timeout handling, and unauthorized-session callbacks.
- `services/storage.js` owns the existing IndexedDB `margin-db` / `kv` access functions.
- `features/calendar-data.js` owns calendar date keys, schedule event derivation, and next-event selection without DOM access.
- `features/backup-data.js` owns backup schema validation and ID-preserving collection merges.

Express serves this directory at `/frontend`. There is no frontend build step, and the page continues to use the same-origin API and existing local data. Calendar event derivation and backup validation/merging are separate feature modules; their DOM, storage, and interaction flows remain coordinated by the runtime.

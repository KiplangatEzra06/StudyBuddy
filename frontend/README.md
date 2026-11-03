# Frontend

`public/index.html` and `public/styles.css` remain the served application shell and visual layer. `public/app.js` is the browser-module entrypoint; it imports `app/main.js`, which loads the current runtime.

## Runtime modules

- `app/runtime.js` contains the existing feature logic and initialization. It remains cohesive for this no-visible-change stage; page-level feature extraction is still outstanding.
- `services/api.js` owns same-origin, cookie-authenticated API requests, timeout handling, and unauthorized-session callbacks.
- `services/storage.js` owns the existing IndexedDB `margin-db` / `kv` access functions.

Express serves this directory at `/frontend`. There is no frontend build step, and the page continues to use the same-origin API and existing local data. The folders for feature modules, shared UI, styles, and utilities are not yet runtime modules.

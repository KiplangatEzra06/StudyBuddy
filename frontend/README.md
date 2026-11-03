# Frontend

`public/index.html` remains the served application shell. Its stylesheet order is `design-tokens.css`, `styles.css`, then `components.css`, so shared variables are available to page styles and shared primitives provide the final common control states. `public/app.js` is the browser-module entrypoint; it imports `app/main.js`, which loads the current runtime.

## Design system

- `public/design-tokens.css` is the source of truth for theme colors, spacing, radii, typography, shadows, focus rings, and layer levels.
- `public/components.css` defines shared button, form-control, and panel behavior. Button hover states retain their base colors and rely on focus, shadow, and motion cues rather than color changes.
- `public/styles.css` retains app-shell and feature-specific layout rules.

## Runtime modules

- `app/runtime.js` coordinates shared state, DOM rendering, and cross-feature interactions.
- `services/api.js` owns same-origin, cookie-authenticated API requests, timeout handling, and unauthorized-session callbacks.
- `services/storage.js` owns the existing IndexedDB `margin-db` / `kv` access functions.
- `features/calendar-data.js` owns calendar date keys, schedule event derivation, and next-event selection without DOM access.
- `features/backup-data.js` owns backup schema validation and ID-preserving collection merges.

Express serves this directory at `/frontend`. There is no frontend build step, and the page continues to use the same-origin API and existing local data. Calendar event derivation and backup validation/merging are separate feature modules; their DOM, storage, and interaction flows remain coordinated by the runtime.

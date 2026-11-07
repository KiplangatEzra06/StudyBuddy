# Refactor rules (apply to every task)

- Pure refactor: no behavior, UI, API, database or storage-format change. No new dependencies.
- No build step. Frontend files are native ES modules served from /frontend. Keep it that way.
- Frontend modules must not import each other (no feature -> feature imports). Shared
  things go in frontend/shared/. Cross-feature calls go through frontend/shared/bus.js
  (emit/on) or through callbacks passed into the feature's init().
- Each feature module exports init(deps) and any render functions other code needs.
  It owns its own DOM lookups and event listeners.
- All shared mutable data lives in frontend/shared/state.js as one exported `state`
  object. No module-level `let` copies of shared data.
- Check index.html and public/index.html for inline handlers (onclick=, etc.) and any
  function used from window; keep them working.
- After every change: `npm test` and `node --check` on every file touched.
- Move code by cutting and pasting exact function bodies. Do not rewrite or "improve" logic.
- Update frontend/README.md and docs/architecture.md for every module added.
- Work in small steps and report a summary of what moved where. If something is
  ambiguous, stop and ask instead of guessing.
  - Each feature stage must also move that feature's top-level event listeners (the many
  $('...').addEventListener(...) calls near the end of runtime.js, roughly lines
  5540-6140) into the feature's init(). When a stage finishes, no listener for that
  feature may remain in runtime.js.
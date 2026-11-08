# Instructions for AI coding assistants (Cursor, Claude, Copilot)

Read these before you start any task, in this order:

0. `docs/README.md` - how the documentation set works and the status words to use.
1. `docs/DEVELOPMENT_LOG.md` - what has been done, what is broken, and what was
   already investigated.
   Do not re-investigate anything already recorded there.
2. `docs/TECHNICAL_ROADMAP.md` - current priorities and the order of work.
3. `docs/architecture.md` - how the code is laid out today.
4. `REFACTOR_RULES.md` - rules that apply to every refactor.

## Working rules

- No build step. Frontend files are native ES modules served from `/frontend`.
- Feature modules must not import each other. Use `frontend/shared/bus.js` or
  callbacks passed into `init(deps)`.
- No new dependencies and no database schema changes unless the task says so.
  If you think one is needed, stop and ask.
- AI prompts live in `backend/config/prompts.js`. Keep the API request and
  response shapes unchanged unless the task says otherwise.
- After every change run `npm test` and `node --check` on each touched file.
- Never commit secrets (`.env`, API keys, password hashes).
- If something is ambiguous, stop and ask instead of guessing.
- Work in small steps and report: files changed, behaviour preserved, issues
  found, tests run.

## When you finish a task

Add an entry at the top of `docs/DEVELOPMENT_LOG.md` (newest first) with the date,
what changed, why, status, and anything left open. If you made or changed a
decision, record it with its rationale in `docs/TECHNICAL_ROADMAP.md` (technical) or
`docs/PRODUCT_BLUEPRINT.md` (product). Use the status words Implemented, Partially
implemented, Planned and Unverified, and only say Implemented when it was verified.

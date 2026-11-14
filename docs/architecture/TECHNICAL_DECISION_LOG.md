# Technical Decision Log

## Purpose

This log records the decisions that are already evidenced in the codebase, decisions that should be proposed for the next phase, and open questions that still require a technical answer before broader refactoring.

## Approved decisions already evidenced by the codebase

| Decision | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Single-user app with session-based auth | Approved / implemented | `backend/app/index.js`, `backend/routes/auth.js` | Works as a secure local app model |
| Express + Node modular monolith | Approved / implemented | `server.js`, `backend/app/index.js` | Fits the current architecture |
| PostgreSQL as durable data store | Approved / implemented | `db/pool.js`, `db/schema.sql`, `db/migrate.js` | Proper authoritative backend storage |
| IndexedDB for local browser data | Approved / implemented | `frontend/services/storage.js` | Fits single-user local workflow |
| Same-origin API pattern with cookies | Approved / implemented | `frontend/services/api.js`, backend middleware | Strongly aligned to current app design |
| OpenAI-compatible AI provider abstraction | Approved / implemented | `backend/services/ai/index.js` | Flexible integration strategy |
| Incremental refactor over full rewrite | Approved / evidenced by repo structure | Current codebase and docs | Best fit for Phase 1 |

## Proposed decisions for Phase 1

| Decision | Status | Rationale | Evidence or alternatives |
| --- | --- | --- | --- |
| Create explicit ownership map for local vs server data | Proposed | Reduces drift and supports architectural clarity | Current implementation is mixed but workable |
| Add a dedicated AI orchestration layer | Proposed | AI flows are scattered and should become service-oriented | Current controller/service split is incomplete |
| Normalize assignment-brief component ownership | Proposed | Feature works but is still multi-layer and less clean than core review flows | Existing route/controller/service code |
| Remove stale migration copy and product wording | Proposed | Prevents confusion and future misalignment | `public/index.html` still references Ollama wording |
| Keep `IndexedDB` for local workspaces unless domain requirements justify server storage | Proposed | Fits the single-user app strategy and approved blueprint | Already reflected in docs and implementation |

## Unresolved technical questions

1. Which records should eventually become fully server-managed versus intentionally browser-only?
2. What exact reconciliation model should be used when local workspace data needs synchronization to PostgreSQL?
3. Should AI tutor memories/history be browser-local or server-backed in the long term?
4. Should assignment-brief documents remain browser-local uploads or move to server-managed storage once feature requirements expand?
5. How much of the local record lifecycle should become a formal repository/service contract during Phase 1?

## Decision status summary

- Approved and in place: server structure, hybrid storage design, single-user auth model, AI provider abstraction, modular frontend layout
- Proposed and pending: stronger domain ownership, AI orchestration cleanup, assignment-brief normalization, stale copy removal
- Open: synchronization/reconciliation contracts and long-term data ownership decisions for advanced workflows

## Decision principles

- Preserve working features whenever practical
- Refactor in dependency order rather than rewriting from scratch
- Prefer explicit contracts over implicit assumptions
- Keep the architecture incremental and reversible

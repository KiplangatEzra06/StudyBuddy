# Phase 1 Backlog

## Goal

Prepare the repository for the next incremental architecture phase by hardening boundaries, clarifying ownership, and reducing drift before larger feature work expands.

## Priority tasks

### P1 — Formalize data ownership and boundaries

- Define authoritative data stores for each major domain
- Document which records live in PostgreSQL vs IndexedDB
- Establish a simple ownership matrix for each feature
- Acceptance criteria: every feature has a documented owner and persistence boundary
- Complexity: Medium
- Risk: Medium

### P2 — Clean AI orchestration boundaries

- Separate provider logic from prompt orchestration and validation
- Standardize AI request flows through a service-ready contract
- Acceptance criteria: AI controllers do not embed provider-specific logic across multiple features
- Complexity: Medium
- Risk: Medium

### P3 — Normalize assignment-brief ownership

- Clarify browser-local upload flow versus durable server-backed storage
- Tighten validation and service boundaries
- Acceptance criteria: assignment-brief workflow has a clear persistence contract and validation seam
- Complexity: Medium
- Risk: Low to Medium

### P4 — Remove stale product copy and migration mismatches

- Replace outdated Ollama wording with current Groq/OpenAI-compatible terminology
- Update docs and UI hints where text drift remains
- Acceptance criteria: no user-facing copy refers to the old implementation without a clear migration note
- Complexity: Low
- Risk: Low

### P5 — Reduce feature coupling in frontend bootstrap and state flow

- Identify shared state dependencies that can be grouped into better boundaries
- Preserve single-user app behavior while improving clarity
- Acceptance criteria: fewer implicit dependencies across feature modules
- Complexity: Medium
- Risk: Medium

### P6 — Add architecture guardrails to the project workflow

- Document expected module responsibilities
- Add lightweight review checks for ownership drift
- Acceptance criteria: contributors can identify whether a change belongs in frontend, backend, or shared utilities
- Complexity: Low
- Risk: Low

## Dependencies

- Phase 0 audit and ownership map
- Storage boundary decisions
- AI provider contract decision
- Review of stale documentation and UI copy

## Risks

- Unclear ownership could lead to duplicate storage or silent drift
- AI orchestration refactors may affect tutor/notes generation if done too broadly
- Moving assignment-brief persistence without a clear strategy could disrupt a working feature

## Suggested sequencing

1. Data ownership map
2. AI orchestration cleanup
3. Assignment-brief normalization
4. UI copy cleanup
5. Frontend dependency cleanup
6. Governance guardrails

## Phase 1 exit criteria

- Architecture boundaries are clear and reviewed
- No major feature has ambiguous ownership
- AI flows have a stable service contract
- Local/server persistence rules are documented and consistent with implementation
- Remaining refactors are small and reversible

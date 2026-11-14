# Refactoring Plan

## Objective

Refactor the StudyBuddy application incrementally to achieve clearer domain boundaries without destabilizing the already working features.

## Refactoring principles

- Preserve working behavior first
- Make domain ownership explicit
- Avoid full rewrites while the app remains functional
- Refactor in dependency order
- Keep rollback paths simple

## Recommended order

### 1. Ownership and storage boundaries

Focus:

- define authoritative storage for each domain
- confirm PostgreSQL vs IndexedDB ownership for each feature
- document the rules and keep them stable

Why first:

This is the foundation for all later refactoring. Without clear ownership, other refactors may create duplicate or conflicting data paths.

### 2. AI service boundary hardening

Focus:

- isolate provider configuration and rate-limit logic
- standardize request/response validation
- consolidate fallback behavior into a single domain contract

Why second:

AI flows are central to the product and should be stabilized before more advanced orchestration and memory features are added.

### 3. Assignment-brief normalization

Focus:

- clean service boundaries for upload, validation, and persistence
- decide whether the feature stays browser-first or becomes stronger server-backed

Why third:

The feature is present and useful, but it is one of the clearest examples of a workflow that still needs ownership clarity.

### 4. Frontend state and feature dependency cleanup

Focus:

- reduce direct coupling between feature modules
- keep the single-user app model but standardize and document shared-state conventions

Why fourth:

This improves maintainability without changing product behavior.

### 5. User-facing documentation and migration copy cleanup

Focus:

- remove stale wording from the app shell
- align docs with the actual provider stack

Why fifth:

This reduces confusion and makes the architecture easier to explain and maintain.

## Features to preserve during refactoring

- Authentication and session flow
- Review engine and SM-2 behavior
- Flashcard generation and persistence
- Assignment and class workflows
- Notes and document local workspace support
- Tutor and AI flows
- Backup and import capabilities

## Migration strategy

1. Start with the strongest documented boundaries and add explicit ownership rules.
2. Introduce or adjust service contracts where logic currently crosses boundaries too freely.
3. Keep feature-level tests passing before and after each refactor stage.
4. Avoid changing storage models until ownership is documented and validated.
5. Use small, sequential refactor steps with rollback ready at each phase.

## Rollback considerations

- Prefer staged refactors with reversible changes.
- Keep existing feature tests as guardrails.
- Make any storage convention changes explicit and reversible.
- Do not combine unrelated refactors in the same commit when the ownership boundary is uncertain.

## Final recommendation

The safest path is not a rewrite. The safest path is a measured refactor that preserves the working app while formalizing ownership, AI orchestration, and storage boundaries in the order above.

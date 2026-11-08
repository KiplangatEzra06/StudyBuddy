# StudyBuddy Technical Roadmap

**Version:** 0.1  
**Planning baseline:** November 2026

## 1. Purpose

This document records the technical baseline, target architecture, implementation sequence, and quality requirements for StudyBuddy. Verify all baseline details against the current repository before making changes; documentation and deployed behavior can drift.

## 2. Known repository baseline

The repository documentation describes the following stack and structure:

- Node.js and Express backend.
- Native JavaScript ES modules on the frontend; no frontend build step is documented.
- Neon PostgreSQL accessed through `pg`.
- `express-session` with `connect-pg-simple` for server-side sessions.
- Render deployment.
- Ollama Cloud integration for AI functionality.
- Backend organization around routes, controllers, services, and repositories.
- Frontend feature modules with shared services and an event bus.

Documented PostgreSQL data includes flashcard decks/cards, review records, and login sessions. Browser IndexedDB (`margin-db`, `kv` store) is documented for documents, notes, quiz results, timer sessions, classes, assignments, and tutor conversations.

The README has described a single-user login configuration using `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`. Treat multi-user authorization as a target capability until verified in code and tested.

## 3. Architecture goals

1. Establish clear ownership of data and business rules.
2. Keep HTTP concerns out of business logic.
3. Make persistence replaceable behind repository interfaces.
4. Enforce user-level data isolation on the server.
5. Provide explicit validation and consistent error handling.
6. Keep frontend feature modules independent where possible.
7. Make migrations reversible or safely recoverable.
8. Preserve existing workflows while moving data and responsibilities.

## 4. Target logical architecture

```text
Browser
  ├── Application shell and navigation
  ├── Feature modules
  │    ├── Notes
  │    ├── Documents
  │    ├── Courses and assignments
  │    ├── Flashcards
  │    ├── Quiz
  │    ├── AI Tutor
  │    ├── Calendar
  │    └── Focus and progress
  └── API client
          |
          v
Express API
  ├── Routes and middleware
  ├── Controllers (HTTP translation)
  ├── Services (business rules)
  ├── Repositories (data access)
  └── Integrations (AI and external services)
          |
          v
PostgreSQL
```

This is a logical target, not a mandate to introduce new infrastructure. A modular monolith is appropriate until real scale or operational needs justify more.

## 5. Storage strategy

### 5.1 Target direction

Move durable, user-owned learning data toward cloud persistence in PostgreSQL. Browser storage can remain useful for caches, drafts, offline work, or temporary state, but it should not silently become the only copy of important user data.

### 5.2 Suggested data domains

- Users and authentication
- Courses and course membership/ownership
- Notes
- Documents and document metadata
- Assignments and deadlines
- Flashcard decks, cards, and review events
- Quizzes, questions, attempts, and results
- Tutor conversations and messages
- Study sessions and timer records
- User preferences

Use stable IDs, timestamps, ownership fields, and explicit relationships. Avoid duplicating the same source of truth across unrelated tables.

### 5.3 Multi-user isolation

Every user-owned record must be scoped to an authenticated user, directly or through a parent record with verified ownership.

For every read, update, and delete:
- derive the user identity from the authenticated server session;
- enforce ownership in the service/repository query;
- do not trust a client-supplied `user_id`;
- return a safe not-found or forbidden response without leaking another user's data;
- test cross-user access attempts.

### 5.4 Migration approach

1. Inventory IndexedDB stores and actual record shapes.
2. Identify canonical entities and relationships.
3. Add database schema and migrations.
4. Implement server repositories and validated API endpoints.
5. Build an import path for existing browser records.
6. Make imports idempotent using stable identifiers or migration keys.
7. Verify record counts and representative content.
8. Keep a recovery/export path until migration is proven.
9. Switch reads/writes in controlled stages.
10. Remove obsolete local persistence only after verification and a documented rollback decision.

Do not clear IndexedDB as part of a migration until the cloud copy has been verified.

## 6. November implementation roadmap

### Nov 9–15: audit and design
- Map every feature to its frontend module, API route, service, repository, and storage location.
- Verify the live app's critical workflows.
- Identify duplicate business logic and direct database/browser-storage access.
- Document current schemas and data shapes.
- Prioritize storage and module separation.
- Write migration and rollback plans.

**Exit criteria:** an evidence-based architecture map, prioritized defect list, and approved migration sequence.

### Nov 16–22: architecture and storage
- Establish consistent module boundaries.
- Move one low-risk domain (Notes was proposed as a pilot) through the cloud persistence path.
- Add validation, ownership checks, error handling, and tests.
- Add migration/import tooling and verification.
- Confirm session and user ownership behavior.

**Exit criteria:** the pilot survives refresh and a new session, data is correctly scoped, and migration can be repeated safely.

### Nov 23–29: AI tutor and connected learning
- Separate provider integration from tutor business logic.
- Add context selection and clear context boundaries.
- Implement or refine tutor modes where feasible.
- Explore quiz and flashcard generation from selected materials.
- Persist tutor conversations reliably.
- Add safeguards for timeouts, malformed model output, and provider failure.

**Exit criteria:** tutor workflows are predictable, errors are handled, and generated study content can be reviewed before saving.

### Nov 30: stabilization
- Run regression tests.
- Verify production workflows.
- Review logs and known defects.
- Record release notes and December redesign prerequisites.

## 7. AI integration architecture

Keep the AI provider behind a service interface. The application should not make provider-specific assumptions throughout feature code.

Recommended flow:

1. Feature requests assistance with a selected task.
2. Context service gathers only authorized, relevant material.
3. Prompt builder assembles instructions and context.
4. Provider adapter sends the request.
5. Response parser validates the output shape.
6. Tutor service returns a normalized response.
7. Conversation repository persists the interaction.

Handle rate limits, timeouts, provider errors, empty responses, and malformed structured output. Never treat model output as trusted executable code or as authoritative application data.

## 8. Security and privacy baseline

- Hash passwords using a suitable password-hashing algorithm.
- Keep secrets in environment variables; never commit credentials.
- Use secure session cookie settings appropriate to deployment.
- Validate and normalize all input on the server.
- Apply authorization checks to every user-owned resource.
- Use parameterized SQL.
- Limit upload types and sizes; validate actual file content where possible.
- Avoid logging passwords, session tokens, or private learning content unnecessarily.
- Apply sensible rate limits to authentication and expensive AI endpoints.
- Provide data export and deletion behavior consistent with the product's policy.

## 9. Testing strategy

- Unit tests for services and domain rules.
- Repository tests against a test database.
- API tests for validation, authorization, and error handling.
- Migration tests using representative old records.
- Frontend tests for critical interactions.
- End-to-end checks for sign-in, create/edit/delete, refresh persistence, and cross-feature workflows.
- Production smoke tests after deployment.

The developer may be the only short-term tester, but tests must simulate multiple users to validate isolation.

## 10. Definition of done

A change is complete only when:
- expected behavior is specified;
- validation and failure states are handled;
- data ownership and persistence are correct;
- existing relevant workflows still work;
- tests cover the critical path and important edge cases;
- documentation is updated;
- production behavior is checked after deployment where applicable.

## 11. Technical decision register

For each major decision, record: date, decision, alternatives considered, rationale, consequences, migration impact, and status. Do not silently change the storage model, authentication model, or module boundaries.

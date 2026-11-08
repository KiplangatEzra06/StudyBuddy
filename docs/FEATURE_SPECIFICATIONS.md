# StudyBuddy Feature Specifications

**Version:** 0.1  
**Status note:** This is a working specification. Verify each implementation status against the current code and live application.

## 1. Status convention

- **Implemented:** verified in code and through a relevant workflow.
- **Partially implemented:** core pieces exist but the workflow has gaps.
- **Planned:** target behavior, not yet verified as implemented.
- **Unverified:** current evidence is insufficient.

Do not mark a feature implemented solely because a navigation item or screen exists.

## 2. Feature inventory

The repository documentation identifies these feature areas:
- Flashcards
- Notes
- Calendar
- AI Tutor
- Documents
- Quiz
- Courses and Assignments
- Focus Timer
- Progress / Study Sessions
- Settings

The exact production status of each workflow must be checked during the audit.

## 3. Shared requirements

All features that create or manage user data should:
- provide clear loading, empty, success, and error states;
- validate user input;
- persist changes reliably;
- support refresh and session restoration;
- scope data to the authenticated user;
- provide confirmation for destructive actions;
- avoid silent data loss;
- use consistent timestamps and timezone handling;
- expose accessible labels and keyboard-friendly controls.

## 4. Notes

**Purpose:** Capture, organize, edit, and retrieve learning notes.

Target behavior:
- Create, view, edit, and delete notes.
- Associate notes with a course or subject when relevant.
- Support search and useful sorting.
- Preserve edits across refreshes and sessions.
- Provide clear save state and conflict/error feedback.
- Allow tutor assistance using a note only after the learner selects or authorizes that context.

Acceptance criteria:
- A saved note can be retrieved in a new session.
- Editing a note does not create accidental duplicates.
- One user cannot access another user's notes.
- Migration from existing IndexedDB records preserves content and identifiers where possible.

## 5. Documents

**Purpose:** Keep learning documents accessible and usable as study context.

Target behavior:
- Upload or add supported documents.
- Display metadata and processing status.
- Open, rename, and delete documents.
- Associate documents with courses where useful.
- Make document content available to AI features only when extraction succeeds and access is authorized.

Acceptance criteria:
- Unsupported or oversized files receive clear feedback.
- Failed processing is visible and recoverable.
- Deleting metadata does not leave confusing orphaned records.
- Document content is not exposed across users.

## 6. Courses and assignments

**Purpose:** Organize academic work by course and deadline.

Target behavior:
- Create, edit, and archive courses.
- Create assignments associated with a course.
- Track due dates, status, and priority.
- Show upcoming work in relevant dashboard and calendar views.
- Filter assignments by course, status, and date.

Acceptance criteria:
- Assignment-course relationships remain valid.
- Date and timezone behavior is consistent.
- Completing or editing an assignment updates all relevant views.
- User ownership is enforced for courses and assignments.

## 7. Calendar

**Purpose:** Provide a time-based view of academic commitments.

Target behavior:
- Display assignments and planned study sessions.
- Navigate dates and useful calendar ranges.
- Open an event to its source record.
- Distinguish event types without relying on color alone.

Acceptance criteria:
- Calendar events match their source records.
- Date changes and timezone boundaries are handled consistently.
- Empty calendar states explain how to add items.

## 8. Flashcards

**Purpose:** Support active recall and spaced review.

Target behavior:
- Create and manage decks and cards.
- Review cards and record outcomes.
- Track due cards and review history.
- Support course/topic association.
- Generate draft cards from selected learning material, subject to user review.

Acceptance criteria:
- Review outcomes persist.
- Repeated reviews create distinct review events.
- Scheduling logic is deterministic and testable.
- Generated cards can be edited or rejected before being added.

## 9. Quiz

**Purpose:** Let learners practise and evaluate understanding.

Target behavior:
- Create or generate quizzes.
- Support clear question and answer formats.
- Record attempts and results.
- Provide feedback and explanations.
- Connect quiz results to relevant topics where possible.

Acceptance criteria:
- Scoring rules are explicit and tested.
- Results persist and can be reviewed.
- A failed generation or submission does not corrupt an existing quiz.
- Generated questions are reviewable before use.

## 10. AI Tutor

**Purpose:** Provide context-aware learning assistance.

Target modes:
- **Learn:** progressive explanation and understanding checks.
- **Explain:** focused clarification of a selected concept.
- **Practice:** practice questions and feedback.
- **Revise:** concise reinforcement of selected material.
- **Test:** structured self-assessment.

Target behavior:
- Maintain conversation history.
- Allow the learner to select relevant course, note, or document context.
- Indicate when context is being used.
- Handle unavailable AI services gracefully.
- Avoid claiming to have read material that was not successfully provided.
- Allow users to review generated content before saving it elsewhere.

Acceptance criteria:
- Conversations persist across sessions.
- Context is authorized and limited to the selected material.
- Provider failures do not lose the user's prompt or prior conversation.
- Structured outputs are validated before being used by other features.

## 11. Focus timer and study sessions

**Purpose:** Help learners structure focused study and record activity.

Target behavior:
- Start, pause, resume, and finish a focus session.
- Record duration and optional course/topic association.
- Recover safely from refresh or interrupted sessions.
- Display completed sessions in history and progress views.

Acceptance criteria:
- Timer state does not depend solely on a continuously running browser interval.
- Recorded duration is calculated and validated reliably.
- Duplicate sessions are not created by repeated submissions.

## 12. Progress

**Purpose:** Turn learning activity into useful reflection.

Target behavior:
- Summarize study sessions, quiz attempts, and flashcard reviews.
- Provide date-range and course-level views where data supports them.
- Distinguish actual recorded activity from estimates.
- Offer actionable next steps without overstating what the data proves.

Acceptance criteria:
- Every metric has a documented calculation.
- Empty or incomplete data is represented honestly.
- Progress totals reconcile with underlying records.

## 13. Settings

**Purpose:** Give users control over account and product preferences.

Target behavior:
- Manage profile and preferences supported by the product.
- Provide session and sign-out controls.
- Explain data and personalization settings.
- Avoid exposing secrets or internal configuration.

Acceptance criteria:
- Changes persist and are reflected across the app.
- Sensitive account actions require appropriate confirmation.
- Settings are scoped to the signed-in user.

## 14. Cross-feature integrations

Prioritize integrations that remove repeated work:
- Course → notes, documents, assignments, calendar, tutor context.
- Notes/documents → tutor explanations, quiz drafts, flashcard drafts.
- Quiz/flashcard results → progress and suggested revision.
- Focus sessions → progress and course activity.
- Assignments → dashboard and calendar.

Each integration must define its source of truth. Avoid duplicating content merely to display it in another feature.

## 15. Priority guide

| Priority | Work |
|---|---|
| P0 | Data integrity, authentication, ownership, reliable persistence, critical workflow defects |
| P1 | Core feature completeness and cross-feature consistency |
| P2 | Adaptive tutor improvements and study-material generation |
| P3 | Advanced personalization and nonessential enhancements |

## 16. Feature change template

For each new or changed feature, document:
- Problem being solved
- Intended user
- Entry point and workflow
- Data model and ownership
- Validation and error states
- Dependencies and integrations
- Acceptance criteria
- Tests
- Rollout and migration considerations

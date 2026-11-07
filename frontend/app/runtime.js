import { createApiClient } from '../services/api.js';
import { idbGet, idbSet, openDB, STORE } from '../services/storage.js';
import {
  init as initCalendar,
  renderCalendar
} from '../features/calendar.js';
import {
  init as initClasses,
  renderClasses,
  formatMeetingDays
} from '../features/classes.js';
import {
  init as initAssignments,
  assignmentMarkup,
  bindAssignmentActions,
  renderAssignmentList,
  openAssignmentForm,
  classForAssignment,
  renderReminderBadge,
  syncReminderControls,
  checkAssignmentReminders
} from '../features/assignments.js';
import {
  init as initAssignmentBrief,
  openAssignmentBriefDialog,
  loadAssignmentBriefs
} from '../features/assignment-brief.js';
import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_LOCAL_SETTINGS,
  BACKUP_VERSION,
  mergeRecords,
  validateBackup
} from '../features/backup-data.js';
import { renderTutorMarkdown } from '../features/tutor-markdown.js';
import {
  init as initNotes,
  renderNotes,
  noteNotebookKey,
  persistNotesReaderPosition,
  cleanupStoredNotes
} from '../features/notes.js';
import { state } from '../shared/state.js';
import {
  bindMarkdownCodeButtons,
  cleanNoteBody,
  init as initMarkdown,
  normalizeTutorReply,
  renderMathInElementSafe
} from '../shared/markdown.js';
import {
  TUTOR_MATERIAL_KEY,
  FLASHCARD_IMPORT_DONE_KEY,
  FLASHCARD_VIEW_KEY,
  THEME_KEY,
  SIDEBAR_COLLAPSE_KEY
} from '../shared/constants.js';
import { $, escapeHtml, setStatus, createSvgElement } from '../shared/dom.js';
import {
  uid,
  formatBytes,
  truncateText,
  pluralizeCount,
  formatStudyDuration,
  normalizeAnswer,
  courseUnitKey,
  shuffle
} from '../shared/format.js';
import {
  syncCustomSelect,
  initializeCustomControls
} from '../shared/custom-select.js';
import {
  paginateToFit,
  refreshFitPaginators,
  showFitItem
} from '../shared/fit-paginator.js';
import {
  initUndo,
  confirmDeletion,
  softDeleteRecords,
  showUndoToast,
  purgeUndoSnapshot,
  undoDelete,
  confirmBulkDeletion
} from '../shared/undo.js';
import { downloadJSON } from '../shared/files.js';
import { on } from '../shared/bus.js';
import { init as initTimer, renderTimer } from '../features/timer.js';
import {
  init as initDocuments,
  renderDocuments,
  renderTaxonomy,
  previewDocument
} from '../features/documents.js';
import {
  init as initQuiz
} from '../features/quiz.js';
import { createAssignmentBriefsApi } from '../services/assignment-briefs-api.js';


const apiFetch = createApiClient({
  onUnauthorized: () => showLoginScreen('Session expired, please sign in again')
});

window.addEventListener('resize', () => {
  refreshFitPaginators();
  if (!$('panel-calendar').classList.contains('hidden')) renderCalendar();
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
    || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  const active = document.activeElement;
  const activeContainer = active?.closest('[data-fit-paginate]')
    || (active?.classList.contains('fit-page-controls') ? active.previousElementSibling : null);
  const paginator = activeContainer?.nextElementSibling;
  if (!paginator?.classList.contains('fit-page-controls')) return;
  const next = ['ArrowRight', 'PageDown'].includes(event.key);
  const previous = ['ArrowLeft', 'PageUp'].includes(event.key);
  if (!next && !previous) return;
  const button = paginator.querySelector(next ? '[data-fit-next]' : '[data-fit-prev]');
  if (!button.disabled) {
    event.preventDefault();
    button.click();
  }
});
async function apiErrorMessage(response, fallback) {
  const body = await response.text();
  try {
    const data = JSON.parse(body);
    if (typeof data.error === 'string' && data.error) return data.error;
  } catch { }
  const plainText = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plainText && plainText.length <= 240
    ? plainText
    : `${fallback} (${response.status}). Please try again.`;
}

const assignmentBriefsApi = createAssignmentBriefsApi(apiFetch, apiErrorMessage);

function showLoginScreen(message = '') {
  $('app-shell').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('login-error').textContent = message;
  $('login-password').value = '';
  if (message) $('login-username').focus();
}

function showAuthenticatedApp() {
  $('auth-screen').classList.add('hidden');
  $('app-shell').classList.remove('hidden');
}

function initializeAuthenticatedApp() {
  showAuthenticatedApp();
  if (!state.appInitialization) {
    state.appInitialization = init().catch(error => {
      state.appInitialization = null;
      console.error('StudyBuddy could not initialize after sign-in.', error);
      showLoginScreen('Could not load your study desk. Please sign in again.');
    });
  }
  return state.appInitialization;
}

async function checkAuthentication() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not check the sign-in session.');
    const result = await response.json();
    if (result.authenticated === true) {
      await initializeAuthenticatedApp();
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen('Could not reach StudyBuddy. Check your connection and try again.');
  }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.loginPending) return;
  state.loginPending = true;
  const submit = $('login-submit');
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  $('login-error').textContent = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'StudyBuddy'
      },
      body: JSON.stringify({
        username: $('login-username').value,
        password: $('login-password').value
      })
    });
    const result = await response.json();
    if (!response.ok) {
      $('login-error').textContent = response.status === 429
        ? result.error || 'Too many sign-in attempts. Please wait and try again.'
        : response.status === 401
          ? 'Incorrect username or password'
          : result.error || 'Could not sign in right now. Please try again.';
      return;
    }
    $('login-password').value = '';
    await initializeAuthenticatedApp();
  } catch {
    $('login-error').textContent = 'Could not reach StudyBuddy. Check your connection and try again.';
  } finally {
    state.loginPending = false;
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});

$('toggle-login-password').addEventListener('click', () => {
  const password = $('login-password');
  const visible = password.type === 'text';
  password.type = visible ? 'password' : 'text';
  $('toggle-login-password').textContent = visible ? 'Show' : 'Hide';
  $('toggle-login-password').setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
  $('toggle-login-password').setAttribute('aria-pressed', String(!visible));
});

function persistAll() {
  idbSet('documents', state.documents);
  idbSet('notes', state.notes);
  idbSet('quizResults', state.quizResults);
  idbSet('timerSessions', state.timerSessions);
}

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  classes: 'Courses',
  assignments: 'Assignments',
  documents: 'Documents',
  tutor: 'AI Tutor',
  cards: 'Flashcards',
  quiz: 'Quiz',
  timer: 'Focus Timer',
  sessions: 'Study Sessions',
  notes: 'Notes',
  progress: 'Progress',
  settings: 'Settings'
};
const PAGE_PANEL_IDS = {
  assignments: 'classes',
  sessions: 'progress'
};
const MOBILE_MENU_QUERY = window.matchMedia('(max-width: 768px)');

function effectiveTheme() {
  const selected = document.documentElement.dataset.theme || 'system';
  return selected === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : selected;
}

function setTheme(theme) {
  const selected = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = selected;
  localStorage.setItem(THEME_KEY, selected);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', selected === 'dark'
    || (selected === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? '#151927'
    : '#4c2bd1');
  $('theme-select').value = selected;
  const dark = effectiveTheme() === 'dark';
  $('theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  $('theme-toggle').innerHTML = dark
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg><span>Theme</span>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5z" /></svg><span>Theme</span>';
}

function updatePageDate() {
  $('page-date').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());
}

function renderDashboardSection(name, renderContent) {
  const section = $(`dashboard-${name}`);
  const loading = $(`dashboard-${name}-loading`);
  const content = $(`dashboard-${name}-content`);
  const empty = $(`dashboard-${name}-empty`);
  const errorState = $(`dashboard-${name}-error`);
  section.setAttribute('aria-busy', 'false');
  loading.classList.add('hidden');
  content.classList.add('hidden');
  empty.classList.add('hidden');
  errorState.classList.add('hidden');
  try {
    const result = renderContent();
    if (result.state === 'loading') {
      section.setAttribute('aria-busy', 'true');
      loading.textContent = result.message || 'Loading…';
      loading.classList.remove('hidden');
    } else if (result.state === 'error') {
      errorState.textContent = result.message;
      errorState.classList.remove('hidden');
    } else if (result.state === 'empty') {
      empty.textContent = result.message || empty.textContent;
      empty.classList.remove('hidden');
    } else {
      content.innerHTML = result.html;
      content.classList.remove('hidden');
    }
  } catch (error) {
    console.error(`Could not render dashboard ${name}.`, error);
    errorState.textContent = 'This section could not be loaded. Please try again.';
    errorState.classList.remove('hidden');
  }
}

function dashboardProgressRow(label, value, detail) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return `<div class="dashboard-progress-row">
    <div class="dashboard-progress-heading"><span>${escapeHtml(label)}</span><strong>${percent}%</strong></div>
    <div class="dashboard-progress-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
    <small>${escapeHtml(detail)}</small>
  </div>`;
}

function dashboardDateTime(timestamp, options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

function renderDashboard() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextWeek = new Date(todayStart);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const hour = now.getHours();
  $('dashboard-greeting').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('dashboard-summary').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(now);

  renderDashboardSection('priorities', () => {
    const priorities = [];
    state.classes.filter(item => Array.isArray(item.meetingDays)
      && item.meetingDays.some(day => Number(day) === now.getDay()))
      .forEach(item => priorities.push({
        kind: 'Class',
        time: item.startTime || 'Today',
        title: item.name || 'Class meeting',
        detail: item.location || item.instructor || 'Class meeting',
        sortKey: item.startTime || '99:99'
      }));
    state.assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
      && Number(assignment.dueAt) < todayStart.getTime())
      .forEach(assignment => priorities.push({
        kind: 'Overdue',
        time: 'Overdue',
        title: assignment.title || 'Untitled assignment',
        detail: classForAssignment(assignment)?.name || 'General',
        assignmentId: assignment.id,
        sortKey: '00:00'
      }));
    state.assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
      && new Date(Number(assignment.dueAt)).toDateString() === now.toDateString())
      .forEach(assignment => priorities.push({
        kind: 'Due today',
        time: 'Due today',
        title: assignment.title || 'Untitled assignment',
        detail: classForAssignment(assignment)?.name || 'General',
        assignmentId: assignment.id,
        sortKey: `${String(new Date(Number(assignment.dueAt)).getHours()).padStart(2, '0')}:${String(new Date(Number(assignment.dueAt)).getMinutes()).padStart(2, '0')}`
      }));
    priorities.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (!priorities.length) return { state: 'empty' };
    return {
      html: priorities.slice(0, 5).map(item => `
        <article class="dashboard-list-row">
          ${item.assignmentId
            ? `<button class="dashboard-complete-btn" type="button" data-toggle-assignment="${escapeHtml(item.assignmentId)}" aria-label="Mark ${escapeHtml(item.title)} complete">○</button>`
            : '<span class="dashboard-event-time" aria-hidden="true">Today</span>'}
          <div><span class="dashboard-item-kind">${escapeHtml(item.kind)} · ${escapeHtml(item.time)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div>
        </article>
      `).join('')
    };
  });
  bindAssignmentActions($('dashboard-priorities-content'));

  renderDashboardSection('upcoming', () => {
    const upcoming = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(todayStart);
      date.setDate(date.getDate() + offset);
      state.classes.filter(item => Array.isArray(item.meetingDays)
        && item.meetingDays.some(day => Number(day) === date.getDay()))
        .forEach(item => {
          const timeParts = /^(\d{1,2}):(\d{2})$/.exec(item.startTime || '');
          const eventDate = new Date(date);
          if (timeParts) eventDate.setHours(Number(timeParts[1]), Number(timeParts[2]), 0, 0);
          else eventDate.setHours(23, 59, 0, 0);
          if (eventDate < now) return;
          upcoming.push({
            timestamp: eventDate.getTime(),
            kind: 'Class',
            title: item.name || 'Class meeting',
            detail: `${dashboardDateTime(date.getTime(), { weekday: 'short', month: 'short', day: 'numeric' })}${item.startTime ? ` · ${item.startTime}${item.endTime ? `–${item.endTime}` : ''}` : ''}`
          });
        });
    }
    state.assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
      && Number(assignment.dueAt) >= now.getTime() && Number(assignment.dueAt) < nextWeek.getTime())
      .forEach(assignment => upcoming.push({
        timestamp: Number(assignment.dueAt),
        kind: 'Assignment',
        title: assignment.title || 'Untitled assignment',
        detail: `${dashboardDateTime(Number(assignment.dueAt))} · ${classForAssignment(assignment)?.name || 'General'}`,
        assignmentId: assignment.id
      }));
    upcoming.sort((a, b) => a.timestamp - b.timestamp);
    if (!upcoming.length) return { state: 'empty' };
    return {
      html: upcoming.slice(0, 6).map(item => `
        <article class="dashboard-list-row dashboard-upcoming-row">
          ${item.assignmentId
            ? `<button class="dashboard-complete-btn" type="button" data-toggle-assignment="${escapeHtml(item.assignmentId)}" aria-label="Mark ${escapeHtml(item.title)} complete">○</button>`
            : '<span class="dashboard-upcoming-dot" aria-hidden="true"></span>'}
          <div><span class="dashboard-item-kind">${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div>
        </article>
      `).join('')
    };
  });
  bindAssignmentActions($('dashboard-upcoming-content'));

  renderDashboardSection('activity', () => {
    const activity = [
      ...state.timerSessions.map(session => ({
        timestamp: Number(session.completedAt),
        title: `${session.course || 'General'}${session.unit ? ` · ${session.unit}` : ''}`,
        detail: `${Math.max(1, Math.round((Number(session.seconds) || 0) / 60))} min focus session`,
        kind: 'Focus'
      })),
      ...state.documents.filter(documentItem => Number(documentItem.lastOpened) > 0).map(documentItem => ({
        timestamp: Number(documentItem.lastOpened),
        title: documentItem.title || 'Untitled document',
        detail: `${documentItem.course || 'General'} · opened document`,
        kind: 'Reading'
      })),
      ...state.quizResults.map(result => ({
        timestamp: Number(result.takenAt),
        title: result.documentTitle || 'Quiz',
        detail: `Quiz score · ${Math.round(Number(result.score) || 0)}%`,
        kind: 'Quiz'
      }))
    ].filter(item => Number.isFinite(item.timestamp) && item.timestamp > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
    if (!activity.length) return { state: 'empty' };
    return {
      html: activity.map(item => `
        <article class="dashboard-list-row dashboard-activity-row">
          <span class="dashboard-activity-kind">${escapeHtml(item.kind)}</span>
          <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)} · ${escapeHtml(dashboardDateTime(item.timestamp))}</small></div>
        </article>
      `).join('')
    };
  });

  renderDashboardSection('continue', () => {
    const latestDocument = state.documents.filter(item => Number(item.readingProgress) < 100)
      .sort((a, b) => (Number(b.lastOpened) || Number(b.uploadedAt) || 0) - (Number(a.lastOpened) || Number(a.uploadedAt) || 0))[0];
    if (latestDocument) {
      const progress = Math.max(0, Math.min(100, Number(latestDocument.readingProgress) || 0));
      return {
        html: `<article class="dashboard-continue-card">
          <span class="dashboard-item-kind">Document · ${escapeHtml(latestDocument.course || 'General')}</span>
          <h3>${escapeHtml(latestDocument.title || 'Untitled document')}</h3>
          <div class="dashboard-progress-track" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
          <small>${progress}% read</small>
          <button class="btn btn-primary" type="button" id="dashboard-continue-button" data-document-id="${escapeHtml(latestDocument.id)}">Continue reading</button>
        </article>`
      };
    }
    if (state.dashboardFlashcardStatus === 'loading') return { state: 'loading', message: 'Checking what is ready to study…' };
    if (state.dashboardFlashcardStatus === 'error') return { state: 'error', message: `Learning recommendations are unavailable: ${state.dashboardFlashcardError}` };
    if (state.flashcardDueCount > 0) {
      return {
        html: `<article class="dashboard-continue-card">
          <span class="dashboard-item-kind">Flashcards</span>
          <h3>Keep your knowledge fresh</h3>
          <p>${state.flashcardDueCount} ${state.flashcardDueCount === 1 ? 'card is' : 'cards are'} ready to review.</p>
          <button class="btn btn-primary" type="button" id="dashboard-continue-button" data-review-cards>Review flashcards</button>
        </article>`
      };
    }
    return { state: 'empty' };
  });

  renderDashboardSection('progress', () => {
    const rows = [];
    if (state.documents.length) {
      const average = state.documents.reduce((sum, item) => sum + Math.max(0, Math.min(100, Number(item.readingProgress) || 0)), 0) / state.documents.length;
      rows.push(dashboardProgressRow('Reading', average, `${state.documents.filter(item => Number(item.readingProgress) >= 100).length} of ${state.documents.length} documents completed`));
    }
    if (state.cards.length) {
      const mastered = state.cards.filter(card => card.mastered).length;
      rows.push(dashboardProgressRow('Flashcards', mastered / state.cards.length * 100, `${mastered} of ${state.cards.length} cards mastered`));
    }
    if (state.quizResults.length) {
      const average = state.quizResults.reduce((sum, result) => sum + (Number(result.score) || 0), 0) / state.quizResults.length;
      rows.push(dashboardProgressRow('Quiz average', average, `${state.quizResults.length} ${state.quizResults.length === 1 ? 'attempt' : 'attempts'}`));
    }
    if (!rows.length) return { state: 'empty' };
    return { html: rows.join('') };
  });

  renderDashboardSection('revision', () => {
    if (state.dashboardFlashcardStatus === 'loading') return { state: 'loading' };
    if (state.dashboardFlashcardStatus === 'error') return { state: 'error', message: `Flashcard reminders are unavailable: ${state.dashboardFlashcardError}` };
    if (!state.flashcardDueCount) return { state: 'empty' };
    return {
      html: `<div class="dashboard-reminder-count">${state.flashcardDueCount}</div>
        <p>${state.flashcardDueCount === 1 ? 'flashcard is' : 'flashcards are'} due for review.</p>
        <button class="btn btn-primary" type="button" data-review-cards>Review due cards</button>`
    };
  });

  renderDashboardSection('actions', () => ({
    html: `<div class="dashboard-actions-grid">
      <button class="dashboard-action" type="button" data-dashboard-go="documents"><strong>Open documents</strong><span>Read and organize study materials</span></button>
      <button class="dashboard-action" type="button" data-dashboard-go="notes"><strong>Open notes</strong><span>Write or revisit your notes</span></button>
      <button class="dashboard-action" type="button" data-dashboard-go="tutor"><strong>Ask AI Tutor</strong><span>Explore a study question</span></button>
      <button class="dashboard-action" type="button" data-dashboard-go="timer"><strong>Start focus timer</strong><span>Begin a focused study session</span></button>
    </div>`
  }));
}

$('panel-dashboard').addEventListener('click', event => {
  const continueButton = event.target.closest('#dashboard-continue-button');
  if (continueButton) {
    if (continueButton.dataset.documentId) {
      activatePage('documents');
      previewDocument(continueButton.dataset.documentId);
    } else if (continueButton.hasAttribute('data-review-cards')) {
      activatePage('cards');
      setFlashcardsView('review');
    }
    return;
  }
  const action = event.target.closest('[data-dashboard-go], [data-review-cards]');
  if (!action) return;
  if (action.dataset.dashboardGo) activatePage(action.dataset.dashboardGo);
  if (action.hasAttribute('data-review-cards')) {
    activatePage('cards');
    setFlashcardsView('review');
  }
});

function closeMobileMenu(restoreFocus = true) {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
  $('sidebar-overlay').setAttribute('aria-hidden', 'true');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
  if (restoreFocus && MOBILE_MENU_QUERY.matches) $('menu-toggle').focus();
}

function activatePage(page) {
  const panelId = PAGE_PANEL_IDS[page] || page;
  if (!PAGE_TITLES[page] || !$(`panel-${panelId}`)) return;
  document.querySelectorAll('.tab').forEach(button => {
    const active = button.dataset.tab === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `panel-${panelId}`));
  $('page-title').textContent = PAGE_TITLES[page];
  $('topbar-page-title').textContent = PAGE_TITLES[page];
  $('page-layout').classList.toggle('tutor-active', page === 'tutor');
  $('panel-progress').classList.toggle('sessions-view', page === 'sessions');
  $('panel-classes').classList.toggle('assignments-view', page === 'assignments');
  $('progress-panel-title').textContent = page === 'sessions' ? 'Study Sessions' : 'Progress';
  $('progress-panel-description').textContent = page === 'sessions'
    ? 'Review your recent focus sessions and time spent studying.'
    : 'A plain dashboard for reading progress, flashcard mastery, quiz accuracy, study time, and recent study sessions.';
  $('progress-sessions-title').textContent = page === 'sessions' ? 'Session history' : 'Recent sessions';
  $('classes-panel-title').textContent = page === 'assignments' ? 'Assignments' : 'Courses';
  $('classes-panel-description').textContent = page === 'assignments'
    ? 'Track the deadlines already linked to your courses.'
    : 'Keep course details, weekly meeting times, and assignment deadlines together. Your information stays in this browser.';
  if (panelId === 'classes') {
    state.classesView = page === 'assignments' ? 'assignments' : 'classes';
    renderClasses();
  }
  if (page === 'dashboard') renderDashboard();
  if (panelId === 'progress') {
    renderProgress();
    loadProgressDeckStats();
  }
  if (page === 'tutor') renderTutorOverview();
  if (page === 'calendar') renderCalendar();
  if (page === 'classes') renderClasses();
}

$('reminders-bell').addEventListener('click', () => activatePage('calendar'));
$('tutor-use-material').checked = localStorage.getItem(TUTOR_MATERIAL_KEY) !== 'false';
$('settings-tutor-material').checked = $('tutor-use-material').checked;
$('tutor-use-material').addEventListener('change', event => {
  localStorage.setItem(TUTOR_MATERIAL_KEY, String(event.target.checked));
  $('settings-tutor-material').checked = event.target.checked;
  renderTutorChatPage();
});
$('settings-tutor-material').addEventListener('change', event => {
  localStorage.setItem(TUTOR_MATERIAL_KEY, String(event.target.checked));
  $('tutor-use-material').checked = event.target.checked;
  renderTutorChatPage();
});

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  activatePage(tab.dataset.tab);
  closeMobileMenu();
}));
$('sidebar').querySelector('.brand').addEventListener('click', event => {
  event.preventDefault();
  activatePage('dashboard');
  closeMobileMenu();
});

$('app-shell').classList.toggle('sidebar-collapsed', localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === 'true');
function syncSidebarCollapseButton() {
  const collapsed = $('app-shell').classList.contains('sidebar-collapsed');
  $('sidebar-collapse-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('sidebar-collapse-toggle').setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} navigation`);
  $('sidebar-collapse-toggle').title = `${collapsed ? 'Expand' : 'Collapse'} navigation`;
  document.querySelectorAll('.tab').forEach(button => {
    const label = button.querySelector(':scope > span:not(.tab-badge)')?.textContent.trim();
    if (collapsed && label) button.title = label;
    else button.removeAttribute('title');
  });
}
syncSidebarCollapseButton();
$('sidebar-collapse-toggle').addEventListener('click', () => {
  const collapsed = $('app-shell').classList.toggle('sidebar-collapsed');
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(collapsed));
  syncSidebarCollapseButton();
});

$('menu-toggle').addEventListener('click', () => {
  const isOpen = $('sidebar').classList.contains('open');
  if (isOpen) {
    closeMobileMenu();
    return;
  }
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('open');
  $('sidebar-overlay').setAttribute('aria-hidden', 'false');
  $('menu-toggle').setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
  $('sidebar').querySelector('.tab[aria-current="page"]')?.focus();
});
$('sidebar-overlay').addEventListener('click', () => closeMobileMenu());
MOBILE_MENU_QUERY.addEventListener('change', event => {
  if (!event.matches) closeMobileMenu(false);
});
document.addEventListener('keydown', event => {
  if (!$('sidebar').classList.contains('open') || !MOBILE_MENU_QUERY.matches) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMobileMenu();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...$('sidebar').querySelectorAll('a[href], button:not([disabled])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  document.querySelector(`.tab[data-tab="${button.dataset.go}"]`)?.click();
}));
document.querySelectorAll('[data-go-flashcards]').forEach(button => button.addEventListener('click', () => {
  activatePage('cards');
  setFlashcardsView(button.dataset.goFlashcards);
}));
$('theme-select').value = document.documentElement.dataset.theme || localStorage.getItem(THEME_KEY) || 'system';
setTheme($('theme-select').value);
$('theme-select').addEventListener('change', event => setTheme(event.target.value));
$('theme-toggle').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((document.documentElement.dataset.theme || 'system') === 'system') setTheme('system');
});
updatePageDate();
activatePage('dashboard');

document.addEventListener('click', event => {
  const prompt = event.target instanceof Element ? event.target.closest('.quick-prompt') : null;
  if (!prompt) return;
  $('chat-input').value = prompt.dataset.prompt;
  $('chat-input').dispatchEvent(new Event('input', { bubbles: true }));
  $('chat-input').focus();
});

function cardFontSize(text) {
  return `${Math.max(12, Math.min(20, 20 - Math.floor(String(text || '').length / 90)))}px`;
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
}

function renderTutorScopeOptions() {
  const select = $('tutor-study-scope');
  if (!select) return;
  const current = select.value || 'all';
  const options = ['<option value="all">All material</option>'];
  const courses = [...new Set([
    ...state.documents.map(item => item.course),
    ...state.notes.map(item => item.tag),
    ...state.cards.map(item => item.subject),
    ...state.classes.map(item => item.name)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  courses.forEach(course => options.push(`<option value="course:${escapeHtml(course)}">Course: ${escapeHtml(course)}</option>`));
  state.documents.forEach(item => options.push(`<option value="document:${escapeHtml(item.id)}">Document: ${escapeHtml(item.title)}</option>`));
  select.innerHTML = options.join('');
  select.value = [...select.options].some(option => option.value === current) ? current : 'all';
  document.querySelectorAll('select').forEach(syncCustomSelect);
}

function splitStudyText(text, chunkSize = 650) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks = [];
  let chunk = '';
  words.forEach(word => {
    if (chunk && chunk.length + word.length + 1 > chunkSize) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += `${chunk ? ' ' : ''}${word}`;
  });
  if (chunk) chunks.push(chunk);
  return chunks;
}

function indexStudyMaterial(type, records) {
  const activeIds = new Set();
  records.forEach(record => {
    const key = `${type}:${record.id}`;
    activeIds.add(key);
    const signature = JSON.stringify([
      record.updatedAt || record.createdAt || record.takenAt || record.completedAt || '',
      record.title || record.name || record.front || '',
      record.body || record.extractedText || record.back || record.text || '',
      record.score ?? '',
      record.dueAt || ''
    ]);
    if (state.studyMaterialIndex.get(key)?.signature === signature) return;
    const text = record.body || record.extractedText || record.text
      || (type === 'card' ? `${record.front || ''}\n${record.back || ''}` : '');
    const chunks = type === 'document' || type === 'note' ? splitStudyText(text) : [String(text || '')];
    state.studyMaterialIndex.set(key, {
      signature,
      chunks: chunks.map((excerpt, index) => ({
        type,
        title: record.title || record.name || (type === 'card' ? 'Flashcard' : type === 'quiz' ? 'Quiz result' : type),
        course: record.course || record.tag || record.subject || '',
        sourceId: record.id,
        text: type === 'quiz'
          ? `Quiz score ${record.score}% (${record.correct}/${record.total}) in ${record.course || 'General'} ${Array.isArray(record.mistakes) && record.mistakes.length
            ? `Mistakes: ${record.mistakes.map(mistake => `${mistake.question} Your answer: ${mistake.answer || 'blank'}; correct answer: ${mistake.correctAnswer || 'not recorded'}`).join('; ')}`
            : ''}`
          : excerpt,
        chunkIndex: index
      })).filter(chunk => chunk.text.trim())
    });
  });
  [...state.studyMaterialIndex.keys()].forEach(key => {
    if (key.startsWith(`${type}:`) && !activeIds.has(key)) state.studyMaterialIndex.delete(key);
  });
}

function updateStudyMaterialIndex() {
  indexStudyMaterial('document', state.documents.map(item => ({
    ...item, title: item.title, course: item.course, extractedText: item.extractedText
  })));
  indexStudyMaterial('note', state.notes.map(item => ({
    ...item, title: item.title || 'Untitled note', course: item.tag, body: item.body
  })));
  indexStudyMaterial('card', state.cards);
  indexStudyMaterial('quiz', state.quizResults);
  indexStudyMaterial('assignment', state.assignments.map(item => ({
    ...item, title: item.title, course: classForAssignment(item)?.name || 'General',
    text: `${item.title || 'Assignment'} ${item.details || ''} due ${new Date(Number(item.dueAt)).toLocaleString()} ${item.completed ? 'completed' : 'open'}`
  })));
  indexStudyMaterial('class', state.classes.map(item => ({
    ...item, course: item.name, text: `${item.name} ${item.instructor || ''} ${item.location || ''} ${formatMeetingDays(item.meetingDays)} ${item.startTime || ''} ${item.endTime || ''}`
  })));
  indexStudyMaterial('session', state.timerSessions.map(item => ({
    ...item, title: `${item.course || 'General'} study session`,
    text: `${Math.round((Number(item.seconds) || 0) / 60)} minutes ${item.unit || ''} ${new Date(Number(item.completedAt)).toLocaleString()}`
  })));
  indexStudyMaterial('progress', [{
    id: 'aggregate',
    title: 'Study progress',
    text: `${state.documents.filter(item => (item.readingProgress || 0) >= 100).length} documents completed. `
      + `${state.cards.filter(item => item.mastered).length} of ${state.cards.length} flashcards mastered. `
      + `${state.quizResults.length ? Math.round(state.quizResults.reduce((total, item) => total + item.score, 0) / state.quizResults.length) : 0}% average quiz accuracy. `
      + `${Math.round(state.timerSessions.reduce((total, item) => total + (Number(item.seconds) || 0), 0) / 60)} minutes total focus time.`
  }]);
}

function tokenizeStudyText(text) {
  return String(text || '').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function retrieveStudyReferences(question) {
  updateStudyMaterialIndex();
  const queryTerms = [...new Set(tokenizeStudyText(question))];
  if (!queryTerms.length) return [];
  const query = $('tutor-study-scope').value;
  const includePlanning = /\b(class|classes|course|schedule|assignment|assignments|deadline|due|progress|timer|focus|study time|session)\b/i.test(question);
  const candidates = [...state.studyMaterialIndex.values()].flatMap(entry => entry.chunks)
    .filter(chunk => {
      if (query.startsWith('course:') && chunk.course !== query.slice(7)) return false;
      if (query.startsWith('document:')) {
        const documentId = query.slice(9);
        return (chunk.type === 'document' && chunk.sourceId === documentId)
          || (chunk.type === 'note' && state.notes.find(item => item.id === chunk.sourceId)?.sourceDocumentId === documentId)
          || (chunk.type === 'card' && state.cards.find(item => item.id === chunk.sourceId)?.sourceDocumentId === documentId);
      }
      if (!includePlanning && ['assignment', 'class', 'session'].includes(chunk.type)) return false;
      return true;
    });
  const documentFrequency = new Map();
  candidates.forEach(chunk => {
    const terms = new Set(tokenizeStudyText(`${chunk.title} ${chunk.course} ${chunk.text}`));
    terms.forEach(term => documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1));
  });
  const averageLength = candidates.length
    ? candidates.reduce((sum, chunk) => sum + tokenizeStudyText(chunk.text).length, 0) / candidates.length
    : 0;
  const ranked = candidates.map(chunk => {
    const terms = tokenizeStudyText(`${chunk.title} ${chunk.course} ${chunk.text}`);
    const frequencies = new Map();
    terms.forEach(term => frequencies.set(term, (frequencies.get(term) || 0) + 1));
    const score = queryTerms.reduce((total, term) => {
      const frequency = frequencies.get(term) || 0;
      if (!frequency) return total;
      const idf = Math.log(1 + (candidates.length - (documentFrequency.get(term) || 0) + .5)
        / ((documentFrequency.get(term) || 0) + .5));
      const denominator = frequency + 1.2 * (.25 + .75 * terms.length / Math.max(1, averageLength));
      return total + idf * frequency * 2.2 / denominator;
    }, 0);
    return { chunk, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const references = [];
  const seen = new Set();
  let usedCharacters = 0;
  for (const { chunk } of ranked) {
    const key = `${chunk.type}:${chunk.sourceId}`;
    const text = chunk.text.slice(0, 900);
    if (seen.has(key) || usedCharacters + text.length > 7000) continue;
    seen.add(key);
    references.push({
      type: chunk.type,
      title: chunk.title,
      course: chunk.course,
      ...(chunk.type === 'progress' ? {} : { sourceId: chunk.sourceId }),
      text
    });
    usedCharacters += text.length;
    if (references.length >= 8) break;
  }
  return references;
}

function addMsg(role, text, container = $('chat-log'), messageData = {}) {
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'user') {
    const content = document.createElement('div');
    content.className = 'user-content';
    content.textContent = text;
    div.appendChild(content);
  } else {
    const avatar = document.createElement('span');
    avatar.className = 'msg-avatar tutor-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const avatarImage = document.createElement('img');
    avatarImage.src = '/brand/logo-mark.png';
    avatarImage.alt = '';
    avatar.appendChild(avatarImage);
    div.appendChild(avatar);
    if (text) {
      const content = document.createElement('div');
      content.className = 'assistant-content';
      content.innerHTML = renderTutorMarkdown(text, messageData.sources || []);
      div.appendChild(content);
      bindMarkdownCodeButtons(content, { truncateLongCode: false });
      renderMathInElementSafe(content);
    }
  }
  const timestamp = document.createElement('time');
  timestamp.className = 'msg-time';
  const sentAt = Number(messageData.timestamp) || Date.now();
  timestamp.dateTime = new Date(sentAt).toISOString();
  timestamp.textContent = new Date(sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  div.appendChild(timestamp);
  container.appendChild(div);
  return div;
}

function addAssistantMsg(text, sources = [], container = $('chat-log'), messageData = {}) {
  const message = addMsg('assistant', text, container, messageData);
  if (sources.length) {
    const details = document.createElement('details');
    details.className = 'message-sources';
    const summary = document.createElement('summary');
    summary.textContent = `Sources used (${sources.length})`;
    const list = document.createElement('ul');
    sources.forEach(source => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'source-open';
      button.dataset.sourceType = source.type === 'doc' ? 'document' : source.type;
      button.dataset.sourceId = source.sourceId || '';
      const label = source.type === 'document' || source.type === 'doc' ? 'Doc'
        : source.type === 'card' ? 'Card'
          : source.type.charAt(0).toUpperCase() + source.type.slice(1);
      button.textContent = source.title ? `[${label}: ${source.title}]` : `[${label}]`;
      item.appendChild(button);
      list.appendChild(item);
    });
    details.append(summary, list);
    message.appendChild(details);
  }
  if (messageData.retry) {
    const retryRow = document.createElement('div');
    retryRow.className = 'tutor-error-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-secondary btn-sm';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => sendChat(messageData.retry, messageData.timestamp));
    retryRow.append(retry);
    message.append(retryRow);
    return message;
  }
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  [
    ['Copy reply', '⧉', async () => {
      try {
        await navigator.clipboard.writeText(text);
        setChatRequestStatus('Reply copied.');
      } catch {
        setChatRequestStatus('Clipboard access is unavailable in this browser.');
      }
    }],
    ['Save to notes', '＋', async () => {
      const now = Date.now();
      state.notes.push({
        id: uid(),
        title: (messageData.question || 'Tutor reply').slice(0, 60),
        tag: '',
        unit: '',
        tags: ['Tutor'],
        body: cleanNoteBody(text),
        aiGenerated: false,
        createdAt: now,
        updatedAt: now
      });
      state.selectedNoteId = state.notes.at(-1).id;
      state.activeNotebookKey = noteNotebookKey(state.notes.at(-1));
      persistNotesReaderPosition();
      await idbSet('notes', state.notes);
      renderEverything();
      setChatRequestStatus('Saved to notes.');
    }],
    ['Make flashcard', '▤', async () => {
      await saveFlashcardRecord({
        front: messageData.question || 'What is the key idea?',
        back: text,
        subject: 'General',
        unit: '',
        format: 'basic',
        aiGenerated: false,
      });
      await refreshFlashcardData();
      setChatRequestStatus('Flashcard added.');
    }],
    ['Explain simpler', '↓', () => sendChat(`Explain this more simply, in a few clear sentences:\n\n${text}`)],
    ['Regenerate reply', '↻', () => sendChat(messageData.question || 'Please repeat your last answer.')],
    ['Helpful', '👍', async () => {
      const saved = state.chatHistory.find(item => item.timestamp === messageData.timestamp);
      if (saved) saved.feedback = saved.feedback === 'up' ? '' : 'up';
      await persistTutorConversations();
      renderTutorChatPage();
    }],
    ['Not helpful', '👎', async () => {
      const saved = state.chatHistory.find(item => item.timestamp === messageData.timestamp);
      if (saved) saved.feedback = saved.feedback === 'down' ? '' : 'down';
      await persistTutorConversations();
      renderTutorChatPage();
    }]
  ].forEach(([label, icon, callback]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn tutor-action-btn';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = icon;
    if ((label === 'Helpful' && messageData.feedback === 'up')
      || (label === 'Not helpful' && messageData.feedback === 'down')) {
      button.setAttribute('aria-pressed', 'true');
    } else if (label === 'Helpful' || label === 'Not helpful') {
      button.setAttribute('aria-pressed', 'false');
    }
    button.addEventListener('click', callback);
    actions.appendChild(button);
  });
  message.appendChild(actions);

  if (messageData.isLatest) {
    const followups = document.createElement('div');
    followups.className = 'chat-followups';
    ['Give me an example', 'Quiz me on this', 'Explain the key idea'].forEach(prompt => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-btn';
      button.textContent = prompt;
      button.addEventListener('click', () => sendChat(`${prompt}: ${messageData.question || text}`));
      followups.appendChild(button);
    });
    message.appendChild(followups);
  }
  return message;
}

function renderTutorChatPage() {
  const log = $('chat-log');
  const previousScrollTop = log.scrollTop;
  log.replaceChildren();
  state.chatStreamingMessageElement = null;
  const latestAssistantIndex = state.chatHistory.reduce((latest, message, index) =>
    message.role === 'assistant' && !message.retry ? index : latest, -1);
  state.chatHistory.forEach((message, index) => {
    if (message.role === 'assistant') {
      addAssistantMsg(message.content, message.sources || [], log, {
        ...message,
        isLatest: index === latestAssistantIndex
      });
    } else {
      addMsg('user', message.content, log, message);
    }
  });
  if (!state.chatHistory.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.id = 'chat-empty';
    empty.innerHTML = `<h2>What would you like to work on?</h2>
      <p>Ask a question, explore your study material, or plan your next study session.</p>
      <div class="chat-suggestions">
        <button type="button" class="quick-prompt" data-prompt="Explain a concept from my document simply.">Explain a concept from my document simply</button>
        <button type="button" class="quick-prompt" data-prompt="Quiz me on my latest notes.">Quiz me on my latest notes</button>
        <button type="button" class="quick-prompt" data-prompt="Help me plan this week's study.">Help me plan this week's study</button>
        <button type="button" class="quick-prompt" data-prompt="Summarise my document in 5 points.">Summarise my document in 5 points</button>
      </div>
      <p class="chat-material-note"></p>`;
    log.appendChild(empty);
  }
  if (state.chatPending && state.chatHistory.at(-1)?.role === 'user') {
    const loading = addMsg('assistant', state.chatStreamingReply, log);
    state.chatStreamingMessageElement = loading;
    if (!state.chatStreamingReply) loading.classList.add('loading');
    if (!state.chatStreamingReply) {
      const indicator = document.createElement('div');
      indicator.className = 'assistant-content loading-content';
      indicator.innerHTML = '<span class="typing-indicator" aria-label="Tutor is thinking"><i></i><i></i><i></i></span>';
      loading.insertBefore(indicator, loading.querySelector('.msg-time'));
    }
    if (state.chatWakeMessage) {
      const wakeMessage = document.createElement('span');
      wakeMessage.className = 'chat-wake-message';
      wakeMessage.textContent = state.chatWakeMessage;
      const content = loading.querySelector('.assistant-content');
      if (content) content.appendChild(wakeMessage);
      else loading.insertBefore(wakeMessage, loading.querySelector('.msg-time'));
    }
  }
  const title = state.tutorConversations.find(item => item.id === state.activeConversationId)?.title || 'New chat';
  $('tutor-conversation-title').value = title;
  const note = $('chat-log').querySelector('.chat-material-note');
  if (note) note.textContent = $('tutor-use-material').checked
    ? 'Study material is on. Relevant excerpts may be sent with your question.'
    : 'Study material is off. Your questions are sent without local excerpts.';
  updateTutorConnectionStatus();
  $('chat-jump-latest').classList.toggle('hidden', state.chatAtLatest || state.chatHistory.length === 0);
  requestAnimationFrame(() => {
    if (state.chatAtLatest) log.scrollTop = log.scrollHeight;
    else log.scrollTop = previousScrollTop;
  });
}

function updateTutorStreamingReply(text) {
  state.chatStreamingReply = text;
  if (!state.chatStreamingMessageElement?.isConnected) {
    renderTutorChatPage();
    return;
  }

  const message = state.chatStreamingMessageElement;
  const content = message.querySelector('.assistant-content');
  if (text) {
    message.classList.remove('loading');
    const renderedContent = content || document.createElement('div');
    renderedContent.className = 'assistant-content';
    renderedContent.innerHTML = renderTutorMarkdown(text);
    if (!content) message.insertBefore(renderedContent, message.querySelector('.msg-time'));
    bindMarkdownCodeButtons(renderedContent, { truncateLongCode: false });
    renderMathInElementSafe(renderedContent);
    if (state.chatWakeMessage) {
      const wakeMessage = document.createElement('span');
      wakeMessage.className = 'chat-wake-message';
      wakeMessage.textContent = state.chatWakeMessage;
      renderedContent.append(wakeMessage);
    }
  }
  requestAnimationFrame(() => {
    if (state.chatAtLatest) $('chat-log').scrollTop = $('chat-log').scrollHeight;
  });
}

function renderTutorHistory() {
  const content = $('tutor-history-content');
  const query = $('tutor-history-search').value.trim().toLocaleLowerCase();
  const filtered = state.tutorConversations.filter(conversation =>
    `${conversation.title || ''} ${conversation.messages.map(message => message.content || '').join(' ')}`
      .toLocaleLowerCase().includes(query));
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.historyPageIndex = Math.max(0, Math.min(state.historyPageIndex, pageCount - 1));
  content.replaceChildren();
  const pageConversations = filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(state.historyPageIndex * pageSize, (state.historyPageIndex + 1) * pageSize);
  pageConversations.forEach(conversation => {
    const item = document.createElement('article');
    item.className = 'conversation-item';
    const title = document.createElement('strong');
    title.textContent = conversation.title || 'New chat';
    const count = document.createElement('span');
    count.textContent = `${conversation.messages.length} messages`;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm';
    open.dataset.openConversation = conversation.id;
    open.textContent = 'Open';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'btn btn-sm';
    rename.dataset.renameConversation = conversation.id;
    rename.textContent = 'Rename';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-sm btn-danger';
    remove.dataset.deleteConversation = conversation.id;
    remove.textContent = 'Delete';
    item.append(title, count, open, rename, remove);
    content.append(item);
  });
  const controls = $('tutor-history-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-history-prev ${state.historyPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Page ${state.historyPageIndex + 1} of ${pageCount}</span><button type="button" class="btn btn-sm" data-history-next ${state.historyPageIndex >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-history-prev]').addEventListener('click', () => { state.historyPageIndex--; renderTutorHistory(); });
  controls.querySelector('[data-history-next]').addEventListener('click', () => { state.historyPageIndex++; renderTutorHistory(); });
  if (!filtered.length) {
    content.innerHTML = `<p class="hint">${state.tutorConversations.length ? 'No conversations match your search.' : 'No conversations yet. Start a new chat to begin.'}</p>`;
    controls.classList.add('hidden');
  } else {
    controls.classList.remove('hidden');
  }
}

function createTutorConversation() {
  const conversation = { id: uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  state.tutorConversations.push(conversation);
  state.activeConversationId = conversation.id;
  state.chatHistory = conversation.messages;
  localStorage.setItem('studybuddy-active-conversation', state.activeConversationId);
  persistTutorConversations();
  state.chatAtLatest = true;
  renderTutorChatPage();
  renderTutorOverview();
}

function renameTutorConversation(conversation) {
  if (!conversation) return;
  const title = prompt('Rename conversation', conversation.title || 'New chat');
  if (!title?.trim()) return;
  conversation.title = title.trim().slice(0, 80);
  persistTutorConversations().then(() => {
    $('tutor-conversation-title').value = conversation.title;
    renderTutorHistory();
  });
}

function exportTutorConversation() {
  const conversation = state.tutorConversations.find(item => item.id === state.activeConversationId);
  if (!conversation) return;
  const lines = [`# ${conversation.title || 'Tutor conversation'}`, ''];
  conversation.messages.forEach(message => {
    lines.push(message.role === 'user' ? '## You' : '## Tutor', '', normalizeTutorReply(message.content), '');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(conversation.title || 'tutor-chat').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80)}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setTutorOverviewOpen(open) {
  if (window.matchMedia('(min-width: 769px)').matches) return;
  const aside = $('tutor-aside');
  aside.classList.toggle('open', open);
  $('tutor-aside-backdrop').classList.toggle('hidden', !open);
  $('tutor-overview-open').setAttribute('aria-expanded', String(open));
  if (open) {
    aside.setAttribute('role', 'dialog');
    aside.setAttribute('aria-modal', 'true');
    $('tutor-aside-close').focus();
  } else {
    aside.removeAttribute('role');
    aside.removeAttribute('aria-modal');
    $('tutor-overview-open').focus();
  }
}
window.addEventListener('resize', () => {
  if (window.innerWidth <= 768 || !$('tutor-aside').classList.contains('open')) return;
  $('tutor-aside').classList.remove('open');
  $('tutor-aside').removeAttribute('role');
  $('tutor-aside').removeAttribute('aria-modal');
  $('tutor-aside-backdrop').classList.add('hidden');
  $('tutor-overview-open').setAttribute('aria-expanded', 'false');
});

async function persistTutorConversations() {
  const active = state.tutorConversations.find(item => item.id === state.activeConversationId);
  if (active) {
    active.messages = state.chatHistory;
    active.updatedAt = Date.now();
    const firstQuestion = state.chatHistory.find(message => message.role === 'user')?.content;
    if (active.title === 'New chat' && firstQuestion) {
      active.title = firstQuestion.trim().replace(/\s+/g, ' ').slice(0, 48) || 'New chat';
    }
  }
  await idbSet('tutorConversations', state.tutorConversations);
}


function openReplyDialog(text) {
  const content = $('reply-dialog-content');
  const pageLength = Math.max(500, Math.min(1400, Math.floor(($('reply-dialog').clientWidth || 700) * ($('reply-dialog').clientHeight || 500) / 26)));
  state.replyPages = [];
  for (let index = 0; index < text.length; index += pageLength) state.replyPages.push(text.slice(index, index + pageLength));
  state.replyPageIndex = 0;
  content.textContent = state.replyPages[0] || '';
  renderReplyControls();
  $('reply-dialog').showModal();
}

function renderReplyControls() {
  const controls = $('reply-dialog-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-reply-prev ${state.replyPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Part ${state.replyPageIndex + 1} of ${state.replyPages.length}</span><button type="button" class="btn btn-sm" data-reply-next ${state.replyPageIndex >= state.replyPages.length - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-reply-prev]').addEventListener('click', () => { state.replyPageIndex--; renderReplyPage(); });
  controls.querySelector('[data-reply-next]').addEventListener('click', () => { state.replyPageIndex++; renderReplyPage(); });
}

function renderReplyPage() {
  $('reply-dialog-content').textContent = state.replyPages[state.replyPageIndex] || '';
  renderReplyControls();
}

function openStudySource(type, id) {
  if (!id && type !== 'progress') return;
  if (type === 'document') {
    activatePage('documents');
    previewDocument(id);
  } else if (type === 'note') {
    activatePage('notes');
    selectNote(id);
  } else if (type === 'card') {
    activatePage('cards');
    $('card-course-filter').value = 'all';
    $('card-unit-filter').value = 'all';
    $('card-mastery-filter').value = 'all';
    $('card-search').value = '';
    renderCardList();
    showFitItem($('card-list'), `[data-card-id="${CSS.escape(id)}"]`);
  } else if (type === 'assignment' || type === 'class') {
    activatePage('classes');
    state.classesView = type === 'assignment' ? 'assignments' : 'classes';
    renderClasses();
    showFitItem($(type === 'assignment' ? 'classes-assignment-list' : 'class-list'), `[data-edit-${type}="${CSS.escape(id)}"]`);
  } else if (type === 'quiz' || type === 'session' || type === 'progress') {
    activatePage('progress');
  }
}

document.querySelector('#chat-log').addEventListener('click', event => {
  const source = event.target.closest('.source-open');
  if (source) openStudySource(source.dataset.sourceType, source.dataset.sourceId);
});
document.querySelector('#tutor-history-dialog').addEventListener('click', event => {
  const source = event.target.closest('.source-open');
  if (source) openStudySource(source.dataset.sourceType, source.dataset.sourceId);
});

function setChatRequestStatus(message = '') {
  $('chat-request-message').textContent = message;
}

async function readTutorStream(response, onUpdate) {
  let reply = '';
  let sources = [];
  let finished = false;
  const dispatch = block => {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('The tutor returned an invalid streaming response.');
    }
    if (event.error) {
      const error = new Error(event.error);
      error.status = Number(event.status) || 502;
      throw error;
    }
    if (typeof event.token === 'string') {
      reply += event.token;
      onUpdate(reply);
    }
    if (typeof event.reply === 'string') reply = event.reply;
    if (Array.isArray(event.sources)) sources = event.sources;
    if (event.done === true) finished = true;
  };

  if (!response.body?.getReader) {
    const text = await response.text();
    text.split(/\r?\n\r?\n/).forEach(dispatch);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = pending.split(/\r?\n\r?\n/);
        pending = blocks.pop() || '';
        blocks.forEach(dispatch);
        if (done) break;
      }
      if (pending.trim()) dispatch(pending);
    } finally {
      reader.releaseLock();
    }
  }
  if (!reply.trim()) throw new Error('The tutor did not return a response. Please try again.');
  if (!finished) throw new Error('The tutor response was interrupted. Please try again.');
  return { reply, sources };
}

async function sendChat(retryQuestion = '', retryTimestamp = 0) {
  const q = (retryQuestion || $('chat-input').value).trim();
  if (!q || state.chatPending) return;
  if (retryTimestamp) {
    const failedIndex = state.chatHistory.findIndex(message => message.timestamp === retryTimestamp && message.retry);
    if (failedIndex >= 0) {
      const start = state.chatHistory[failedIndex - 1]?.role === 'user' ? failedIndex - 1 : failedIndex;
      state.chatHistory.splice(start);
      await persistTutorConversations();
    }
  }
  if (!state.tutorConversations.some(item => item.id === state.activeConversationId)) createTutorConversation();
  state.chatPending = true;
  state.lastTutorQuestion = q;
  state.chatWakeMessage = '';
  state.chatStreamingReply = '';
  state.chatAbortController = new AbortController();
  $('chat-input').value = '';
  $('chat-input').style.height = 'auto';
  $('chat-send').disabled = true;
  $('chat-send').classList.add('hidden');
  $('chat-stop-btn').classList.remove('hidden');
  setChatRequestStatus('');
  clearTimeout(state.chatWakeTimer);
  state.chatWakeTimer = setTimeout(() => {
    if (state.chatPending) {
      state.chatWakeMessage = 'Waking up the server, this can take up to a minute...';
      renderTutorChatPage();
    }
  }, 5000);
  state.chatHistory.push({ role: 'user', content: q, timestamp: Date.now() });
  state.chatAtLatest = true;
  await persistTutorConversations();
  renderTutorChatPage();
  renderTutorOverview();
  $('chat-input').focus();
  try {
    const references = $('tutor-use-material').checked ? retrieveStudyReferences(q) : [];
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: q, history: state.chatHistory.slice(0, -1), references, stream: true }),
      signal: state.chatAbortController.signal
    });
    if (!res.ok) {
      const error = new Error(await apiErrorMessage(res, 'The AI request failed'));
      error.status = res.status;
      throw error;
    }
    let data;
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      data = await readTutorStream(res, partial => {
        updateTutorStreamingReply(partial);
      });
    } else {
      try {
        data = await res.json();
      } catch {
        throw new Error('The server returned an invalid response. Please try again.');
      }
    }
    if (data?.error) throw new Error(data.error);
    if (typeof data?.reply !== 'string' || !data.reply.trim()) {
      throw new Error('The AI did not return a response. Please try again.');
    }
    const textBlock = normalizeTutorReply(data.reply);
    state.chatHistory.push({
      role: 'assistant',
      content: textBlock,
      sources: Array.isArray(data.sources) ? data.sources : [],
      question: q,
      timestamp: Date.now()
    });
    if (state.chatHistory.length > 40) state.chatHistory = state.chatHistory.slice(-40);
    await persistTutorConversations();
    updateTutorConnectionStatus('connected');
    renderTutorChatPage();
    renderTutorOverview();
  } catch (err) {
    const stopped = state.chatAbortController?.signal.aborted;
    if (stopped) {
      if (state.chatStreamingReply.trim()) {
        state.chatHistory.push({
          role: 'assistant',
          content: state.chatStreamingReply,
          question: q,
          timestamp: Date.now()
        });
        await persistTutorConversations();
      }
      state.chatStreamingReply = '';
      state.chatPending = false;
      setChatRequestStatus('Request stopped.');
      renderTutorChatPage();
      renderTutorOverview();
    } else {
      const status = Number(err.status) || 0;
      const message = status === 401
        ? 'Session expired, please sign in again'
        : status === 403
          ? 'The request could not be verified. Reload the page and try again.'
        : status === 429
          ? 'Too many requests, wait a moment.'
          : status >= 500 || !status
            ? 'The tutor server is unavailable.'
            : err.message || 'The tutor could not answer. Please try again.';
      state.chatHistory.push({
        role: 'assistant',
        content: message,
        retry: q,
        question: q,
        timestamp: Date.now()
      });
      await persistTutorConversations();
      renderTutorChatPage();
      setChatRequestStatus(message);
    }
  } finally {
    clearTimeout(state.chatWakeTimer);
    state.chatWakeMessage = '';
    state.chatStreamingReply = '';
    state.chatPending = false;
    state.chatAbortController = null;
    $('chat-send').classList.remove('hidden');
    $('chat-stop-btn').classList.add('hidden');
    $('chat-send').disabled = !$('chat-input').value.trim();
    $('chat-input').focus();
  }
}

$('chat-stop-btn').addEventListener('click', () => state.chatAbortController?.abort());

function cardLabel(card) {
  if (card.format === 'definition') return 'Definition';
  if (card.format === 'fill_blank') return 'Fill blank';
  return 'Basic';
}

function updateFlashcardDueBadge(count = state.flashcardDueCount) {
  state.flashcardDueCount = Math.max(0, Number(count) || 0);
  const badge = $('flashcards-due-badge');
  badge.textContent = state.flashcardDueCount > 99 ? '99+' : String(state.flashcardDueCount);
  badge.classList.toggle('hidden', state.flashcardDueCount === 0);
  badge.setAttribute('aria-label', `${state.flashcardDueCount} flashcards due`);
  renderDashboard();
}

function renderDeckBar() {
  const select = $('card-course-filter');
  if (!select) return;
  const courses = [...new Set(state.cards.map(card => card.subject || 'General'))].sort((a, b) => a.localeCompare(b));
  const previous = select.value || 'all';
  select.innerHTML = `<option value="all">All courses</option>${courses.map(course => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join('')}`;
  select.value = courses.includes(previous) ? previous : 'all';
  syncCustomSelect(select);
  renderFlashcardDeckSummary();
  renderFlashcardDeckSelectors();
}

function renderFlashcardDeckSummary() {
  const container = $('flashcard-deck-summary');
  if (!container) return;
  if (state.currentFlashcardDeckFilter !== 'all'
    && !state.decks.some(deck => deck.id === state.currentFlashcardDeckFilter)) {
    state.currentFlashcardDeckFilter = 'all';
  }
  container.replaceChildren();
  const all = document.createElement('button');
  all.type = 'button';
  all.className = `flashcard-deck-pill${state.currentFlashcardDeckFilter === 'all' ? ' active' : ''}`;
  all.dataset.deckFilter = 'all';
  all.innerHTML = `<span>All decks</span><small>${state.cards.length}</small>`;
  container.appendChild(all);
  state.decks.forEach(deck => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `flashcard-deck-pill${state.currentFlashcardDeckFilter === deck.id ? ' active' : ''}`;
    item.dataset.deckFilter = deck.id;
    item.innerHTML = `<span>${escapeHtml(deck.name)}</span><small>${Number(deck.due_count) || 0} due</small>`;
    container.appendChild(item);
  });
  container.querySelectorAll('[data-deck-filter]').forEach(button => button.addEventListener('click', () => {
    state.currentFlashcardDeckFilter = button.dataset.deckFilter;
    $('card-course-filter').value = 'all';
    $('card-unit-filter').value = 'all';
    syncCustomSelect($('card-course-filter'));
    syncCustomSelect($('card-unit-filter'));
    renderFlashcardDeckSummary();
    renderCardList();
  }));
}

function renderFlashcardDeckSelectors() {
  const selectedGenerateDeck = $('learning-topic')?.value || '';
  const selectedReviewDeck = $('learning-review-deck')?.value || 'all';
  if ($('learning-topic')) {
    $('learning-topic').innerHTML = `${state.decks.map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join('')}<option value="new">New deck…</option>`;
    $('learning-topic').value = state.decks.some(deck => deck.id === selectedGenerateDeck)
      ? selectedGenerateDeck
      : state.decks[0]?.id || 'new';
    syncCustomSelect($('learning-topic'));
  }
  if ($('learning-review-deck')) {
    $('learning-review-deck').innerHTML = `<option value="all">All decks</option>${state.decks.map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join('')}`;
    $('learning-review-deck').value = selectedReviewDeck === 'all' || state.decks.some(deck => deck.id === selectedReviewDeck)
      ? selectedReviewDeck
      : 'all';
    syncCustomSelect($('learning-review-deck'));
  }
}

function filteredCards() {
  const course = $('card-course-filter').value;
  const unit = $('card-unit-filter').value;
  const mastery = $('card-mastery-filter').value;
  const query = $('card-search').value.trim().toLocaleLowerCase();
  return state.cards.filter(card =>
    (state.currentFlashcardDeckFilter === 'all' || card.deck_id === state.currentFlashcardDeckFilter)
    &&
    (course === 'all' || (card.subject || 'General') === course)
    && (unit === 'all' || (card.unit || 'General') === unit)
    && (mastery === 'all' || (mastery === 'mastered' ? card.mastered : !card.mastered))
    && (!query || `${card.front} ${card.back} ${card.subject} ${flashcardDeckName(card)} ${card.unit}`.toLocaleLowerCase().includes(query))
  );
}

function flashcardDeckKey(card) {
  return card.deck_id == null ? `name:${card.subject || 'General'}` : `id:${card.deck_id}`;
}

function flashcardDeckName(card) {
  const deck = state.decks.find(item => String(item.id) === String(card.deck_id));
  return deck?.name || card.subject || 'General';
}

function renderCardFilters() {
  const units = [...new Set(state.cards.map(card => card.unit || 'General'))].sort();
  const select = $('card-unit-filter');
  const previous = select.value || 'all';
  select.innerHTML = `<option value="all">All units</option>${units.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = units.includes(previous) ? previous : 'all';
  syncCustomSelect(select);
}

function cardMarkup(card) {
  const front = String(card.front || '');
  const back = String(card.back || '');
  return `
    <article class="card-row" data-card-id="${escapeHtml(card.id)}">
      <div class="meta-line">
        <span class="card-course-label">${escapeHtml(card.subject || 'General')}</span>
        <i class="mastery-dot ${card.mastered ? 'mastered' : ''}" role="img" aria-label="${card.mastered ? 'Mastered' : 'Still learning'}"></i>
      </div>
      <button type="button" class="card-face" data-flip-card="${escapeHtml(card.id)}" aria-pressed="false" aria-label="Show answer">
        <span class="card-front" style="font-size:${cardFontSize(front)}">${renderInlineMarkdown(front)}</span>
        <span class="card-back" style="font-size:${cardFontSize(back)}">${renderInlineMarkdown(back)}</span>
      </button>
      ${cardMoreMarkup(card)}
    </article>
  `;
}

function cardMoreMarkup(card) {
  return `<details class="card-more">
    <summary aria-label="More flashcard details">···</summary>
    <div class="card-more-menu">
      <span>Unit: ${escapeHtml(card.unit || 'General')}</span>
      <span>Type: ${escapeHtml(cardLabel(card))}</span>
      <span>${card.aiGenerated ? 'AI generated' : 'Added by you'}</span>
      ${card.sourceDocumentTitle ? `<span>Source: ${escapeHtml(card.sourceDocumentTitle)}</span>` : ''}
      <button type="button" data-edit-card="${escapeHtml(card.id)}">Edit card</button>
      <button type="button" data-delete-card="${escapeHtml(card.id)}">Delete card</button>
    </div>
  </details>`;
}

function bindCardActions(container) {
  container.querySelectorAll('[data-delete-card]').forEach(button => button.addEventListener('click', async () => {
    const card = state.cards.find(item => item.id === button.dataset.deleteCard);
    if (!card) return;
    const confirmed = await confirmDeletion({
      title: 'Delete flashcard?',
      description: `Delete the question "${card.front}" and its answer?`,
      affected: 'This card will be removed from its course deck and future study sessions.'
    });
    if (!confirmed) return;
    await softDeleteRecords([{ collection: 'cards', ids: [card.id] }], 'Flashcard deleted.');
    if (!$('cards-study').classList.contains('hidden')) {
      state.studyDeck = state.studyDeck.filter(item => item.id !== card.id);
      if (!state.studyDeck.length) {
        exitCardStudy();
      } else {
        state.studyIndex = Math.min(state.studyIndex, state.studyDeck.length - 1);
        renderStudyCard();
      }
    }
  }));
  container.querySelectorAll('[data-edit-card]').forEach(button => button.addEventListener('click', () => openCardForm(button.dataset.editCard)));
}

function renderCardList() {
  const list = $('card-list');
  const empty = $('cards-empty');
  const fc = filteredCards();
  if (fc.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  const groups = new Map();
  fc.forEach(card => {
    const key = flashcardDeckKey(card);
    if (!groups.has(key)) groups.set(key, { name: flashcardDeckName(card), cards: [] });
    groups.get(key).cards.push(card);
  });
  list.innerHTML = [...groups.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([key, group]) => {
      const due = group.cards.filter(card => {
        const dueAt = new Date(card.dueAt || card.due_at).getTime();
        return Number.isFinite(dueAt) && dueAt <= Date.now();
      }).length;
      return `<button type="button" class="deck-tile" data-study-deck="${escapeHtml(key)}">
        <span class="deck-tile-icon" aria-hidden="true">▤</span>
        <span class="deck-tile-copy"><strong>${escapeHtml(group.name)}</strong><span>${group.cards.length} ${group.cards.length === 1 ? 'card' : 'cards'}</span></span>
        <span class="deck-tile-due">${due} due</span>
        <span class="deck-tile-open">Study deck →</span>
      </button>`;
    }).join('');
  list.querySelectorAll('[data-study-deck]').forEach(button => button.addEventListener('click', () => startCardStudy(button.dataset.studyDeck)));
}
function openCardForm(id = null) {
  const card = state.cards.find(item => item.id === id);
  const activeDeck = state.decks.find(deck => deck.id === state.currentFlashcardDeckFilter);
  state.editingCardId = card ? card.id : null;
  $('card-dialog-title').textContent = card ? 'Edit flashcard' : 'Add a flashcard';
  $('add-card-btn').textContent = card ? 'Save changes' : 'Save card';
  $('card-front').value = card?.front || '';
  $('card-back').value = card?.back || '';
  $('card-subject').value = card?.subject || activeDeck?.name || '';
  $('card-unit').value = card?.unit || '';
  $('card-format').value = card?.format || 'basic';
  $('card-dialog').showModal();
  $('card-front').focus();
}
function resetCardForm() {
  state.editingCardId = null;
  $('card-dialog-title').textContent = 'Add a flashcard';
  $('add-card-btn').textContent = 'Save card';
  $('card-front').value = '';
  $('card-back').value = '';
  $('card-subject').value = '';
  $('card-unit').value = '';
  $('card-format').value = 'basic';
}
async function saveCard() {
  const front = $('card-front').value.trim();
  const back = $('card-back').value.trim();
  if (!front) {
    $('card-front').reportValidity();
    return;
  }
  if (!back) {
    $('card-back').reportValidity();
    return;
  }
  const existing = state.cards.find(item => item.id === state.editingCardId);
  const payload = {
    ...(existing || {}),
    front,
    back,
    subject: $('card-subject').value.trim() || 'General',
    unit: $('card-unit').value.trim(),
    format: $('card-format').value,
    aiGenerated: existing?.aiGenerated || false,
    mastered: existing?.mastered || false
  };
  $('add-card-btn').disabled = true;
  try {
    await saveFlashcardRecord(payload, existing?.id || null);
    await refreshFlashcardData();
    if (!$('cards-study').classList.contains('hidden')) {
      state.studyDeck = state.studyDeck.map(studyCard => state.cards.find(card => card.id === studyCard.id)).filter(Boolean);
      renderStudyCard();
    }
    $('card-dialog').close();
    resetCardForm();
    setStatus('flashcards-storage-status', existing ? 'Flashcard updated.' : 'Flashcard saved.');
  } catch (error) {
    setStatus('flashcards-storage-status', error.message || 'Could not save this flashcard.');
  } finally {
    $('add-card-btn').disabled = false;
  }
}
async function generateFlashcardsFromDocument() {
  const doc = state.documents.find(d => d.id === $('flashcard-doc-select').value);
  if (!doc) return setStatus('cards-ai-status', 'Upload a document first. (No document selected)');

  setStatus('cards-ai-status', 'Generating cards...');
  $('generate-cards-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-flashcards', { document: aiDocumentPayload(doc) });
    const incoming = Array.isArray(data.cards) ? data.cards : [];
    const seen = new Set();
    const usable = incoming.filter(card => {
      if (!card || typeof card !== 'object') return false;
      const frontValue = card.front || card.question || card.term;
      const backValue = card.back || card.answer || card.definition;
      const front = typeof frontValue === 'string' ? frontValue.trim() : '';
      const back = typeof backValue === 'string' ? backValue.trim() : '';
      const key = `${normalizeAnswer(front)}|${normalizeAnswer(back)}`;
      if (!front || !back || seen.has(key)) return false;
      seen.add(key);
      card.front = front;
      card.back = back;
      return true;
    });
    if (!usable.length) {
      setStatus('cards-ai-status', 'The AI returned no usable flashcards. Try again with a document that has more study content.');
      return;
    }
    const records = usable.map(card => ({
        front: card.front,
        back: card.back,
        subject: doc.course || 'General',
        unit: doc.unit || '',
        format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
        aiGenerated: true,
        sourceDocumentId: doc.id,
        sourceDocumentTitle: doc.title,
        mastered: false
      }));
    const added = await importFlashcardRecords(records);
    const skipped = incoming.length - added;
    setStatus('cards-ai-status', `Added ${added} cards${skipped ? `; skipped ${skipped} incomplete or duplicate ${skipped === 1 ? 'card' : 'cards'}` : ''}.`);
  } catch (err) {
    setStatus('cards-ai-status', err.message || 'Could not generate cards.');
  } finally {
    $('generate-cards-btn').disabled = false;
  }
}

function startCardStudy(deckKey) {
  state.studyDeck = filteredCards()
    .filter(card => flashcardDeckKey(card) === deckKey)
    .sort((a, b) => (a.front || '').localeCompare(b.front || ''));
  if (state.studyDeck.length === 0) return;
  state.studyDeckName = flashcardDeckName(state.studyDeck[0]);
  state.studyIndex = 0;
  state.studySessionResults = { mastered: 0, review: 0 };
  $('panel-cards').classList.add('studying');
  $('cards-study').classList.remove('hidden');
  renderStudyCard();
  $('flip-card').focus();
}
function renderStudyCard() {
  const progress = $('card-study-progress-fill').parentElement;
  const summary = $('card-study-summary');
  const face = $('flip-card');
  const previous = $('card-study-prev-btn');
  const next = $('card-study-next-btn');
  $('study-deck-title').textContent = state.studyDeckName;
  if (state.studyIndex >= state.studyDeck.length) {
    $('card-study-progress').textContent = 'Session complete.';
    face.classList.add('hidden');
    $('study-card-more').replaceChildren();
    summary.classList.remove('hidden');
    summary.textContent = `You reviewed ${state.studyDeck.length} ${state.studyDeck.length === 1 ? 'card' : 'cards'}: ${state.studySessionResults.mastered} marked as known and ${state.studySessionResults.review} to review again.`;
    previous.disabled = state.studyDeck.length === 0;
    next.disabled = true;
    $('card-got-it-btn').disabled = true;
    $('card-again-btn').disabled = true;
    progress.setAttribute('aria-valuenow', '100');
    $('card-study-progress-fill').style.width = '100%';
    state.studyFlipped = false;
    return;
  }
  state.studyFlipped = false;
  $('card-study-progress').textContent = `Card ${state.studyIndex + 1} of ${state.studyDeck.length}`;
  face.classList.remove('hidden', 'flipped');
  summary.classList.add('hidden');
  face.setAttribute('aria-pressed', 'false');
  face.setAttribute('aria-label', 'Question shown. Press Space to show answer.');
  face.innerHTML = `<span class="card-front">${renderInlineMarkdown(state.studyDeck[state.studyIndex].front)}</span><span class="card-back">${renderInlineMarkdown(state.studyDeck[state.studyIndex].back)}</span>`;
  face.style.setProperty('--study-card-font-size', cardFontSize(state.studyDeck[state.studyIndex].front));
  $('study-card-more').innerHTML = cardMoreMarkup(state.studyDeck[state.studyIndex]);
  bindCardActions($('study-card-more'));
  previous.disabled = state.studyIndex === 0;
  next.disabled = false;
  $('card-got-it-btn').disabled = false;
  $('card-again-btn').disabled = false;
  const percent = Math.round((state.studyIndex / state.studyDeck.length) * 100);
  progress.setAttribute('aria-valuenow', String(percent));
  $('card-study-progress-fill').style.width = `${percent}%`;
}
function exitCardStudy() {
  $('cards-study').classList.add('hidden');
  $('panel-cards').classList.remove('studying');
  $('card-list').querySelector('[data-study-deck]')?.focus();
}
function navigateStudyCard(direction) {
  state.studyIndex = Math.max(0, Math.min(state.studyDeck.length, state.studyIndex + direction));
  renderStudyCard();
}
async function markStudyCard(mastered) {
  if (state.studyIndex >= state.studyDeck.length) return;
  const card = state.cards.find(c => c.id === state.studyDeck[state.studyIndex].id);
  if (!card) return;
  try {
    await saveFlashcardRecord({ ...card, mastered }, card.id);
    const current = state.cards.find(item => item.id === card.id);
    if (current) current.mastered = mastered;
  } catch (error) {
    setStatus('flashcards-storage-status', error.message || 'Could not update flashcard mastery.');
    return;
  }
  state.studySessionResults[mastered ? 'mastered' : 'review']++;
  state.studyIndex++;
  renderProgress();
  renderStudyCard();
  if (state.studyIndex < state.studyDeck.length) $('flip-card').focus();
}


function aiDocumentPayload(doc) {
  return {
    id: doc.id,
    title: doc.title,
    course: doc.course,
    unit: doc.unit,
    text: truncateText(doc.extractedText, 14000)
  };
}
async function callAI(path, payload) {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'The AI request failed'));
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('The server returned an invalid response. Please try again.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The server returned an invalid response. Please try again.');
  }
  if (typeof data.error === 'string' && data.error) throw new Error(data.error);
  return data;
}

function showChartEmpty(container, message, summary) {
  container.replaceChildren();
  container.setAttribute('aria-busy', 'false');
  container.setAttribute('aria-label', summary);
  const empty = document.createElement('p');
  empty.className = 'chart-empty';
  empty.setAttribute('role', 'status');
  empty.textContent = message;
  container.appendChild(empty);
}

function showChartLoading(container) {
  container.replaceChildren();
  container.setAttribute('aria-busy', 'true');
  const skeleton = document.createElement('div');
  skeleton.className = 'chart-loading';
  skeleton.setAttribute('aria-hidden', 'true');
  container.appendChild(skeleton);
}

function showChartError(container, message, retry) {
  container.replaceChildren();
  container.setAttribute('aria-busy', 'false');
  const error = document.createElement('div');
  error.className = 'chart-message';
  error.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'progress-inline-action';
  button.textContent = 'Retry';
  button.addEventListener('click', retry);
  error.append(text, button);
  container.appendChild(error);
}

function renderProgressChart(containerId, renderer, errorMessage) {
  const container = $(containerId);
  if (state.progressDataLoading) {
    showChartLoading(container);
    return;
  }
  try {
    renderer(container);
  } catch (error) {
    console.error(`Rendering ${containerId} failed`, error);
    showChartError(container, errorMessage, () => renderProgressChart(containerId, renderer, errorMessage));
  }
}

function appendSvgTitle(element, text) {
  const title = createSvgElement('title');
  title.textContent = text;
  element.appendChild(title);
}

function addChartAxisLine(svg, x1, y1, x2, y2, label) {
  const line = createSvgElement('line', { x1, y1, x2, y2, class: 'chart-grid-line' });
  svg.appendChild(line);
  if (label !== undefined) {
    const text = createSvgElement('text', { x: x1 - 8, y: y1 + 4, 'text-anchor': 'end', class: 'chart-axis-label' });
    text.textContent = label;
    svg.appendChild(text);
  }
}

function renderStudyTimeChart(container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const seconds = state.timerSessions.reduce((total, session) => {
      const completed = new Date(session.completedAt);
      return completed.getFullYear() === date.getFullYear()
        && completed.getMonth() === date.getMonth()
        && completed.getDate() === date.getDate()
        ? total + (Number(session.seconds) || 0)
        : total;
    }, 0);
    return { date, seconds };
  });
  const totalMinutes = Math.round(days.reduce((sum, day) => sum + day.seconds, 0) / 60);
  const summary = `Study time, last 7 days: ${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'} total.`;
  if (!days.some(day => day.seconds > 0)) {
    showChartEmpty(container, 'No study time recorded in the last 7 days. Complete a focus timer session to see daily totals.', summary);
    return;
  }

  container.setAttribute('aria-busy', 'false');
  container.setAttribute('aria-label', summary);
  const svg = createSvgElement('svg', { viewBox: '0 0 448 210', role: 'group', 'aria-label': summary, class: 'chart-svg' });
  const plot = { left: 48, top: 28, bottom: 164 };
  const maxMinutes = Math.max(15, Math.ceil(Math.max(...days.map(day => day.seconds / 60)) / 15) * 15);
  const ticks = [0, Math.ceil(maxMinutes / 2), maxMinutes];
  ticks.forEach(minutes => {
    const y = plot.bottom - (minutes / maxMinutes) * (plot.bottom - plot.top);
    addChartAxisLine(svg, plot.left, y, 438, y, String(minutes));
  });
  const axisTitle = createSvgElement('text', { x: 48, y: 17, class: 'chart-axis-title' });
  axisTitle.textContent = 'Minutes';
  svg.appendChild(axisTitle);
  days.forEach((day, index) => {
    const x = 61 + index * 54;
    const minutes = day.seconds / 60;
    const height = (minutes / maxMinutes) * (plot.bottom - plot.top);
    const value = Math.round(minutes);
    const isToday = index === 6;
    const bar = createSvgElement('rect', {
      x,
      y: plot.bottom - Math.max(height, 2),
      width: 30,
      height: Math.max(height, 2),
      rx: 4,
      class: `chart-bar${isToday ? ' today' : ''}`,
      tabindex: '0',
      'aria-label': `${day.date.toLocaleDateString(undefined, { weekday: 'long' })}${isToday ? ', today' : ''}: ${value} ${value === 1 ? 'minute' : 'minutes'}`
    });
    appendSvgTitle(bar, `${day.date.toLocaleDateString(undefined, { weekday: 'long' })}${isToday ? ' (today)' : ''}: ${value} min`);
    svg.appendChild(bar);
    const valueLabel = createSvgElement('text', {
      x: x + 15,
      y: Math.max(plot.top - 2, plot.bottom - height - 7),
      'text-anchor': 'middle',
      class: 'chart-value-label'
    });
    valueLabel.textContent = String(value);
    svg.appendChild(valueLabel);
    const dayLabel = createSvgElement('text', { x: x + 15, y: 183, 'text-anchor': 'middle', class: 'chart-axis-label' });
    dayLabel.textContent = day.date.toLocaleDateString(undefined, { weekday: 'short' });
    svg.appendChild(dayLabel);
    if (isToday) {
      const todayLabel = createSvgElement('text', { x: x + 15, y: 198, 'text-anchor': 'middle', class: 'chart-today-label' });
      todayLabel.textContent = 'Today';
      svg.appendChild(todayLabel);
    }
  });
  container.replaceChildren(svg);
}

function renderQuizAccuracyChart(container) {
  const attempts = state.quizResults.slice().sort((a, b) => Number(a.takenAt) - Number(b.takenAt)).slice(-8);
  if (!attempts.length) {
    showChartEmpty(container, 'No quiz attempts recorded yet. Take a quiz to see your accuracy trend.', 'Quiz accuracy: no recorded attempts.');
    return;
  }
  const average = Math.round(attempts.reduce((sum, attempt) => sum + (Number(attempt.score) || 0), 0) / attempts.length);
  const summary = `Quiz accuracy, recent attempts: ${attempts.length} ${attempts.length === 1 ? 'attempt' : 'attempts'}, average ${average}%.`;
  container.setAttribute('aria-busy', 'false');
  container.setAttribute('aria-label', summary);
  const svg = createSvgElement('svg', { viewBox: '0 0 448 210', role: 'group', 'aria-label': summary, class: 'chart-svg' });
  const plot = { left: 48, top: 28, bottom: 164 };
  [0, 50, 100].forEach(percent => {
    const y = plot.bottom - (percent / 100) * (plot.bottom - plot.top);
    addChartAxisLine(svg, plot.left, y, 438, y, `${percent}%`);
  });
  const axisTitle = createSvgElement('text', { x: 48, y: 17, class: 'chart-axis-title' });
  axisTitle.textContent = 'Accuracy';
  svg.appendChild(axisTitle);
  const points = attempts.map((attempt, index) => {
    const score = Math.max(0, Math.min(100, Number(attempt.score) || 0));
    const x = attempts.length === 1 ? 243 : 58 + index * (360 / (attempts.length - 1));
    const y = plot.bottom - (score / 100) * (plot.bottom - plot.top);
    const date = new Date(Number(attempt.takenAt) || attempt.takenAt);
    const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const point = createSvgElement('circle', {
      cx: x,
      cy: y,
      r: 5,
      class: 'chart-point',
      tabindex: '0',
      'aria-label': `Quiz attempt ${index + 1}, ${dateLabel}: ${Math.round(score)}%`
    });
    appendSvgTitle(point, `${dateLabel}: ${Math.round(score)}%`);
    svg.appendChild(point);
    const valueLabel = createSvgElement('text', { x, y: Math.max(21, y - 10), 'text-anchor': 'middle', class: 'chart-value-label' });
    valueLabel.textContent = `${Math.round(score)}%`;
    svg.appendChild(valueLabel);
    const dateText = createSvgElement('text', { x, y: 184, 'text-anchor': 'middle', class: 'chart-axis-label' });
    dateText.textContent = dateLabel;
    svg.appendChild(dateText);
    return `${x},${y}`;
  });
  svg.insertBefore(createSvgElement('polyline', { points: points.join(' '), class: 'chart-line' }), svg.childNodes[1]);
  container.replaceChildren(svg);
}

function renderFlashcardMasteryChart(container) {
  if (!state.cards.length) {
    showChartEmpty(container, 'No flashcards available. Add cards to track mastery.', 'Flashcard mastery: no cards available.');
    return;
  }
  const mastered = state.cards.filter(card => card.mastered).length;
  const notMastered = state.cards.length - mastered;
  const percent = Math.round((mastered / state.cards.length) * 100);
  const summary = `Flashcard mastery: ${mastered} mastered, ${notMastered} not yet mastered, ${state.cards.length} total.`;
  container.replaceChildren();
  container.setAttribute('aria-busy', 'false');
  container.setAttribute('aria-label', summary);
  const group = document.createElement('div');
  group.className = 'mastery-chart';
  const value = document.createElement('p');
  value.className = 'mastery-chart-summary';
  value.textContent = `${percent}% mastered`;
  const track = document.createElement('div');
  track.className = 'mastery-segmented-bar';
  track.setAttribute('aria-hidden', 'true');
  const masteredSegment = document.createElement('span');
  masteredSegment.className = 'mastery-segment mastered';
  masteredSegment.style.width = `${(mastered / state.cards.length) * 100}%`;
  const remainingSegment = document.createElement('span');
  remainingSegment.className = 'mastery-segment not-mastered';
  remainingSegment.style.width = `${(notMastered / state.cards.length) * 100}%`;
  track.append(masteredSegment, remainingSegment);
  const legend = document.createElement('ul');
  legend.className = 'mastery-legend';
  [
    { label: 'Mastered', count: mastered, className: 'mastered' },
    { label: 'Not yet mastered', count: notMastered, className: 'not-mastered' }
  ].forEach(item => {
    const row = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = `mastery-swatch ${item.className}`;
    swatch.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = item.label;
    const count = document.createElement('strong');
    count.textContent = String(item.count);
    row.append(swatch, label, count);
    legend.appendChild(row);
  });
  group.append(value, track, legend);
  container.appendChild(group);
}

function makeProgressGroup(groups, name) {
  const course = String(name || 'General').trim() || 'General';
  if (!groups.has(course)) groups.set(course, { course, docs: [], notes: [], cards: [], quizzes: [], sessions: [] });
  return groups.get(course);
}

function renderExpandableList(container, count, label) {
  const previous = container.nextElementSibling;
  if (previous?.classList.contains('fit-page-controls') || previous?.classList.contains('progress-list-toggle')) {
    previous.remove();
  }
  const items = [...container.children];
  let expanded = count > 6 && container.dataset.expanded === 'true';
  container.dataset.expanded = String(expanded);
  items.forEach((item, index) => { item.hidden = !expanded && index >= 6; });
  if (count <= 6) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'progress-list-toggle';
  button.setAttribute('aria-controls', container.id);
  button.setAttribute('aria-expanded', String(expanded));
  const updateLabel = () => {
    button.textContent = expanded ? 'Show fewer' : `View all ${count} ${label}`;
    button.setAttribute('aria-expanded', String(expanded));
  };
  updateLabel();
  button.addEventListener('click', () => {
    const nextExpanded = button.getAttribute('aria-expanded') !== 'true';
    container.dataset.expanded = String(nextExpanded);
    items.forEach((item, index) => { item.hidden = !nextExpanded && index >= 6; });
    button.setAttribute('aria-expanded', String(nextExpanded));
    expanded = nextExpanded;
    updateLabel();
  });
  container.after(button);
}

function renderProgress() {
  const totalSeconds = state.timerSessions.reduce((sum, session) => sum + (Number(session.seconds) || 0), 0);
  const completedDocs = state.documents.filter(document => (document.readingProgress || 0) >= 100).length;
  const quizAvg = state.quizResults.length ? Math.round(state.quizResults.reduce((sum, result) => sum + (Number(result.score) || 0), 0) / state.quizResults.length) : 0;
  const masteredCount = state.cards.filter(card => card.mastered).length;
  const mastery = state.cards.length ? Math.round((masteredCount / state.cards.length) * 100) : 0;
  $('stat-hours').textContent = formatStudyDuration(totalSeconds);
  $('stat-hours-help').textContent = `${formatStudyDuration(totalSeconds)} across completed focus sessions.`;
  $('stat-docs').textContent = String(completedDocs);
  $('stat-docs-help').textContent = `${completedDocs} of ${state.documents.length} ${state.documents.length === 1 ? 'document' : 'documents'} at 100% reading.`;
  $('stat-quiz').textContent = `${quizAvg}%`;
  $('stat-quiz-help').textContent = state.quizResults.length
    ? `Average across ${pluralizeCount(state.quizResults.length, 'recorded attempt')}.`
    : 'Take a quiz to record an accuracy score.';
  $('stat-cards').textContent = `${mastery}%`;
  $('stat-cards-help').textContent = `${masteredCount} of ${state.cards.length} ${state.cards.length === 1 ? 'card' : 'cards'} mastered.`;

  renderProgressChart('study-time-chart', renderStudyTimeChart, 'Study time chart could not be rendered.');
  renderProgressChart('quiz-accuracy-chart', renderQuizAccuracyChart, 'Quiz accuracy chart could not be rendered.');
  if (state.progressDataLoading) {
    showChartLoading($('flashcard-mastery-chart'));
  } else if (state.dashboardFlashcardStatus === 'error' && !state.cards.length) {
    const container = $('flashcard-mastery-chart');
    showChartError(container, state.dashboardFlashcardError || 'Flashcard mastery could not be loaded.', () => {
      showChartLoading(container);
      refreshFlashcardData(false).then(renderProgress).catch(error => {
        console.error('Retrying Progress flashcard data failed', error);
        showChartError(container, error.message || 'Flashcard mastery could not be loaded.', () => renderProgress());
      });
    });
  } else {
    renderProgressChart('flashcard-mastery-chart', renderFlashcardMasteryChart, 'Flashcard mastery chart could not be rendered.');
  }

  const groups = new Map();
  state.documents.forEach(document => makeProgressGroup(groups, document.course).docs.push(document));
  state.notes.forEach(note => makeProgressGroup(groups, note.tag).notes.push(note));
  state.cards.forEach(card => makeProgressGroup(groups, card.subject).cards.push(card));
  state.quizResults.forEach(result => makeProgressGroup(groups, result.course).quizzes.push(result));
  state.timerSessions.forEach(session => makeProgressGroup(groups, session.course).sessions.push(session));
  const courses = [...groups.values()];
  $('progress-list').innerHTML = courses.map(group => {
    const read = group.docs.length
      ? Math.round(group.docs.reduce((sum, document) => sum + (Number(document.readingProgress) || 0), 0) / group.docs.length)
      : 0;
    const groupMastery = group.cards.length
      ? Math.round((group.cards.filter(card => card.mastered).length / group.cards.length) * 100)
      : 0;
    const groupQuiz = group.quizzes.length
      ? Math.round(group.quizzes.reduce((sum, result) => sum + (Number(result.score) || 0), 0) / group.quizzes.length)
      : null;
    const groupSeconds = group.sessions.reduce((sum, session) => sum + (Number(session.seconds) || 0), 0);
    const metrics = [
      group.docs.length ? `<span><strong>${read}%</strong> reading</span>` : '',
      group.cards.length ? `<span><strong>${groupMastery}%</strong> card mastery</span>` : '',
      groupQuiz === null ? '' : `<span><strong>${groupQuiz}%</strong> quiz accuracy</span>`,
      group.sessions.length ? `<span><strong>${escapeHtml(formatStudyDuration(groupSeconds))}</strong> study time</span>` : ''
    ].filter(Boolean).join('');
    return `<article class="course-progress-card">
      <div class="course-progress-heading"><h4>${escapeHtml(group.course)}</h4></div>
      <p class="course-progress-counts">${pluralizeCount(group.docs.length, 'document')} · ${pluralizeCount(group.notes.length, 'note')} · ${pluralizeCount(group.cards.length, 'flashcard')}</p>
      ${group.docs.length ? `<div class="course-reading-progress" role="progressbar" aria-label="${escapeHtml(group.course)} reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${read}"><span style="width:${read}%"></span></div>` : ''}
      ${metrics ? `<div class="course-progress-metrics">${metrics}</div>` : ''}
    </article>`;
  }).join('') || '<p class="empty-state">No course progress yet. Add a document, note, flashcard, quiz, or focus session to see it here.</p>';
  renderExpandableList($('progress-list'), courses.length, 'courses');

  const recent = state.timerSessions.slice().sort((a, b) => Number(b.completedAt) - Number(a.completedAt));
  $('session-list').innerHTML = recent.map(session => {
    const course = String(session.course || '').trim();
    const unit = String(session.unit || '').trim();
    const isGeneral = value => !value || value.toLocaleLowerCase() === 'general';
    const label = !isGeneral(course) ? course : !isGeneral(unit) ? unit : 'General study';
    const date = new Date(Number(session.completedAt) || session.completedAt);
    const dateLabel = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return `<div class="list-row">
      <div><h4>${escapeHtml(label)}</h4><p>${escapeHtml(formatStudyDuration(session.seconds))} · ${escapeHtml(dateLabel)}</p></div>
      <button class="icon-btn btn-danger progress-delete-session" type="button" data-delete-session="${escapeHtml(session.id)}" aria-label="Delete session" title="Delete session">×</button>
    </div>`;
  }).join('') || '<p class="empty-state">No study sessions recorded yet. Complete a focus timer session to see it here.</p>';
  renderExpandableList($('session-list'), recent.length, 'sessions');
  $('session-list').querySelectorAll('[data-delete-session]').forEach(button => button.addEventListener('click', async () => {
    const session = state.timerSessions.find(item => item.id === button.dataset.deleteSession);
    if (!session) return;
    const sessionDate = new Date(Number(session.completedAt) || session.completedAt)
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const confirmed = await confirmDeletion({
      title: 'Delete focus session?',
      description: `Delete the ${formatStudyDuration(session.seconds)} focus session from ${sessionDate}?`,
      affected: 'Study-time totals, charts, and course progress will be recalculated.'
    });
    if (confirmed) await softDeleteRecords([{ collection: 'timerSessions', ids: [session.id] }], 'Focus session deleted.');
  }));
}

function renderProgressWeakDecks(deckStats) {
  const container = $('progress-weak-decks');
  if (!container) return;
  const weakDecks = deckStats.filter(deck => deck.weak);
  if (!weakDecks.length) {
    container.innerHTML = '<p class="empty-state">No weak decks right now. A deck is flagged after five recent reviews averaging below 60%.</p>';
    return;
  }
  container.innerHTML = weakDecks.map(deck => {
    const name = deck.deck || deck.topic;
    const average = Math.max(0, Math.min(100, Number(deck.average_score_30d) || 0));
    return `<article class="progress-weak-deck-card">
      <div class="course-progress-heading"><h4>${escapeHtml(name)}</h4><span>Needs practice</span></div>
      <div class="learning-mastery-track" role="progressbar" aria-label="${escapeHtml(name)} mastery" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(average)}"><span class="learning-mastery-fill" style="width:${average}%"></span></div>
      <p>${Math.round(average)}% average · ${deck.recent_review_count} reviews in 30 days · ${deck.due_count} due</p>
    </article>`;
  }).join('');
}

async function loadProgressDeckStats() {
  const container = $('progress-weak-decks');
  const requestId = ++state.progressDeckStatsRequest;
  container.setAttribute('aria-busy', 'true');
  container.replaceChildren();
  const skeleton = document.createElement('div');
  skeleton.className = 'progress-deck-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  container.appendChild(skeleton);
  try {
    const data = await learningApi('/api/stats/topics');
    if (requestId !== state.progressDeckStatsRequest) return;
    container.setAttribute('aria-busy', 'false');
    renderProgressWeakDecks(data.decks || data.topics || []);
  } catch (error) {
    console.error('Loading weak deck stats failed', error);
    if (requestId !== state.progressDeckStatsRequest) return;
    container.setAttribute('aria-busy', 'false');
    container.replaceChildren();
    const message = document.createElement('p');
    message.className = 'status';
    message.setAttribute('role', 'alert');
    message.textContent = error.message || 'Could not load weak decks.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'progress-inline-action';
    retry.textContent = 'Retry';
    retry.addEventListener('click', loadProgressDeckStats);
    container.append(message, retry);
  }
}


async function saveBackupCollections(collections) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    BACKUP_COLLECTIONS.filter(key => key !== 'cards').forEach(key => tx.objectStore(STORE).put({ key, value: collections[key] }));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save imported data.'));
    tx.onabort = () => reject(tx.error || new Error('Import was cancelled before it could be saved.'));
  });
}

async function importAllData(file) {
  const backup = validateBackup(JSON.parse(await file.text()));
  const merged = {};
  BACKUP_COLLECTIONS.forEach(key => {
    if (key === 'cards') {
      merged.cards = state.cards;
      return;
    }
    merged[key] = mergeRecords(
      { documents: state.documents, cards: state.cards, notes: state.notes, quizResults: state.quizResults, timerSessions: state.timerSessions, classes: state.classes, assignments: state.assignments, tutorConversations: state.tutorConversations }[key],
      backup[key]
    );
  });
  await importFlashcardRecords(backup.cards);
  merged.cards = state.cards;
  await saveBackupCollections(merged);
  state.documents = merged.documents;
  state.notes = merged.notes;
  state.quizResults = merged.quizResults;
  state.timerSessions = merged.timerSessions;
  state.classes = merged.classes;
  state.assignments = merged.assignments;
  state.tutorConversations = merged.tutorConversations;
  state.activeConversationId = state.tutorConversations.some(item => item.id === state.activeConversationId)
    ? state.activeConversationId
    : state.tutorConversations[0]?.id || null;
  state.chatHistory = state.tutorConversations.find(item => item.id === state.activeConversationId)?.messages || [];
  await persistTutorConversations();
  Object.entries(backup.localSettings).forEach(([key, value]) => localStorage.setItem(key, value));
  if (backup.localSettings[THEME_KEY]) setTheme(backup.localSettings[THEME_KEY]);
  renderEverything();
  if (!state.currentPreviewDocId && state.documents[0]) previewDocument(state.documents[0].id);
  return BACKUP_COLLECTIONS.reduce((total, key) => total + backup[key].length, 0);
}

function renderTutorOverview() {
  $('tutor-doc-count').textContent = state.documents.length;
  $('tutor-card-count').textContent = state.cards.length;
  $('tutor-note-count').textContent = state.notes.length;
  const recentQuestions = state.chatHistory.filter(message => message.role === 'user').slice(-3).reverse();
  const list = $('tutor-recent-topics');
  list.replaceChildren();
  if (!recentQuestions.length) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = 'Your recent questions will appear here.';
    list.appendChild(empty);
    return;
  }
  recentQuestions.forEach(message => {
    const topic = document.createElement('p');
    topic.textContent = message.content;
    list.appendChild(topic);
  });
}

function renderEverything() {
  renderTaxonomy();
  renderDocuments();
  renderDeckBar();
  renderCardFilters();
  renderCardList();
  renderFlashcardSourceOptions();
  renderNotes();
  renderClasses();
  renderDashboard();
  renderProgress();
  renderTutorOverview();
  renderTutorScopeOptions();
  renderReminderBadge();
  updateStudyMaterialIndex();
  document.querySelectorAll('select').forEach(syncCustomSelect);
}

function setFlashcardsView(view) {
  const views = ['cards', 'generate', 'review', 'stats'];
  if (!views.includes(view)) return;
  sessionStorage.setItem(FLASHCARD_VIEW_KEY, view);
  document.querySelectorAll('[data-flashcard-view]').forEach(button => {
    const active = button.dataset.flashcardView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  views.forEach(name => $(`flashcards-view-${name}`).classList.toggle('hidden', name !== view));
  if (view === 'generate') {
    const selectedDeck = state.decks.find(deck => deck.id === state.currentFlashcardDeckFilter);
    if (selectedDeck) $('learning-topic').value = selectedDeck.id;
  }
  if (view === 'review') loadLearningReview();
  if (view === 'stats') loadLearningStats();
}

async function flashcardApi(path, body, method) {
  const response = await apiFetch(path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'The flashcard request failed.'));
  return response.status === 204 ? null : response.json();
}

async function learningApi(path, body) {
  return flashcardApi(path, body);
}

function mapServerCard(card) {
  return {
    ...card,
    createdAt: new Date(card.created_at).getTime(),
    dueAt: card.due_at,
    sourceDocumentId: card.sourceDocumentId || '',
    sourceDocumentTitle: card.sourceDocumentTitle || '',
    sourceNoteId: card.sourceNoteId || '',
    sourceNoteTitle: card.sourceNoteTitle || ''
  };
}

async function refreshFlashcardData(render = true) {
  try {
    const [cardData, deckData] = await Promise.all([
      flashcardApi('/api/cards'),
      flashcardApi('/api/decks')
    ]);
    state.cards = cardData.cards.map(mapServerCard);
    state.decks = deckData.decks;
    state.dashboardFlashcardStatus = 'ready';
    state.dashboardFlashcardError = '';
    updateFlashcardDueBadge(state.decks.reduce((sum, deck) => sum + (Number(deck.due_count) || 0), 0));
    if (render) {
      renderDeckBar();
      renderCardFilters();
      renderCardList();
      renderTutorOverview();
      renderProgress();
    }
  } catch (error) {
    state.dashboardFlashcardStatus = 'error';
    state.dashboardFlashcardError = error.message || 'Could not load flashcards.';
    renderDashboard();
    throw error;
  }
}

async function importLegacyFlashcards(localCards) {
  if (localStorage.getItem(FLASHCARD_IMPORT_DONE_KEY) === 'true') return;
  if (await idbGet('flashcards-local-backup') === undefined) {
    const backedUp = await idbSet('flashcards-local-backup', localCards);
    if (!backedUp) throw new Error('Could not preserve the local flashcard backup.');
  }
  const importedCount = localCards.length ? await importFlashcardRecords(localCards) : 0;
  localStorage.setItem(FLASHCARD_IMPORT_DONE_KEY, 'true');
  await idbSet('cards', []);
  if (localCards.length) {
    setStatus('flashcards-storage-status', `Imported ${importedCount} ${importedCount === 1 ? 'card' : 'cards'} from this browser. A backup of the old local cards was kept.`);
  }
}

async function saveFlashcardRecord(input, cardId = null) {
  const deckName = String(input.subject || 'General').trim() || 'General';
  let deck = state.decks.find(item => item.name.toLocaleLowerCase() === deckName.toLocaleLowerCase())
    || state.decks.find(item => item.id === input.deck_id);
  if (!deck) {
    const created = await flashcardApi('/api/decks', { name: deckName });
    deck = created.deck;
    state.decks.push(deck);
  }
  const payload = {
    deck_id: deck.id,
    subject: input.subject || deck.name,
    unit: input.unit || '',
    format: input.format || 'basic',
    front: input.front,
    back: input.back,
    aiGenerated: input.aiGenerated === true,
    mastered: input.mastered === true,
    sourceDocumentId: input.sourceDocumentId || '',
    sourceDocumentTitle: input.sourceDocumentTitle || '',
    sourceNoteId: input.sourceNoteId || '',
    sourceNoteTitle: input.sourceNoteTitle || ''
  };
  const result = await flashcardApi(
    cardId ? `/api/cards/${encodeURIComponent(cardId)}` : '/api/cards',
    payload,
    cardId ? 'PATCH' : 'POST'
  );
  return result.card;
}

async function importFlashcardRecords(records) {
  if (!records.length) return 0;
  let imported = 0;
  for (let index = 0; index < records.length; index += 5000) {
    const result = await flashcardApi('/api/cards/import', { cards: records.slice(index, index + 5000) });
    imported += result.imported_count;
  }
  await refreshFlashcardData();
  return imported;
}

function renderFlashcardSourceOptions() {
  const notesSelect = $('flashcard-note-source');
  const docsSelect = $('flashcard-document-source');
  if (!notesSelect || !docsSelect) return;
  notesSelect.innerHTML = state.notes.length
    ? state.notes.map(note => `<option value="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled note')}</option>`).join('')
    : '<option value="">No saved notes</option>';
  docsSelect.innerHTML = state.documents.length
    ? state.documents.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || 'Untitled document')}</option>`).join('')
    : '<option value="">No documents</option>';
  syncCustomSelect(notesSelect);
  syncCustomSelect(docsSelect);
}

function loadFlashcardSourceText() {
  const type = $('flashcard-source-type').value;
  $('flashcard-note-source-wrap').classList.toggle('hidden', type !== 'note');
  $('flashcard-document-source-wrap').classList.toggle('hidden', type !== 'document');
  const content = type === 'note'
    ? state.notes.find(note => note.id === $('flashcard-note-source').value)?.body || ''
    : type === 'document'
      ? state.documents.find(item => item.id === $('flashcard-document-source').value)?.extractedText || ''
      : state.flashcardPastedSource;
  $('flashcard-truncation-notice').classList.toggle('hidden', content.length <= 6000);
  $('learning-notes').value = content.slice(0, 6000);
}

async function loadFlashcardsFromServer() {
  const legacyCards = await idbGet('cards') || [];
  try {
    await importLegacyFlashcards(legacyCards);
    await refreshFlashcardData(false);
  } catch (error) {
    console.error('Flashcard storage could not be loaded', error);
    state.dashboardFlashcardStatus = 'error';
    state.dashboardFlashcardError = error.message || 'Could not load flashcards from the server.';
    setStatus('flashcards-storage-status', `${state.dashboardFlashcardError} Your local backup is still available.`);
  }
}

function renderLearningPreview() {
  const container = $('learning-preview-list');
  container.replaceChildren();
  state.learningPreviewCards.forEach((card, index) => {
    const article = document.createElement('article');
    article.className = 'learning-preview-card';
    const selected = document.createElement('input');
    selected.type = 'checkbox';
    selected.checked = card.selected !== false;
    selected.setAttribute('aria-label', `Select card ${index + 1} to save`);
    selected.addEventListener('change', () => {
      card.selected = selected.checked;
      $('learning-save-btn').disabled = !state.learningPreviewCards.some(item => item.selected !== false);
    });
    const fields = document.createElement('div');
    fields.className = 'learning-preview-card-fields';
    [['Question', 'front', 500], ['Answer', 'back', 2000]].forEach(([label, key, maxLength]) => {
      const fieldLabel = document.createElement('label');
      fieldLabel.textContent = label;
      const input = key === 'front' ? document.createElement('input') : document.createElement('textarea');
      input.value = card[key];
      input.maxLength = maxLength;
      input.setAttribute('aria-label', `${label} for card ${index + 1}`);
      input.addEventListener('input', () => { card[key] = input.value; });
      fieldLabel.appendChild(input);
      fields.appendChild(fieldLabel);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-sm btn-danger';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove card ${index + 1}`);
    remove.addEventListener('click', () => {
      state.learningPreviewCards.splice(index, 1);
      renderLearningPreview();
    });
    article.append(selected, fields, remove);
    container.appendChild(article);
  });
  $('learning-save-btn').disabled = !state.learningPreviewCards.some(card => card.selected !== false);
}

async function generateLearningCards() {
  const notesText = $('learning-notes').value.trim();
  const deck = state.decks.find(item => item.id === $('learning-topic').value);
  if (!notesText || !deck) {
    setStatus('learning-generate-status', 'Choose a source and deck before generating cards.');
    return;
  }
  const button = $('learning-generate-btn');
  button.disabled = true;
  setStatus('learning-generate-status', 'Generating cards… The first request may take longer while the AI service wakes up.');
  try {
    const data = await learningApi('/api/cards/generate', {
      notes: notesText.slice(0, 6000),
      topic: deck.name,
      count: Number($('learning-count').value)
    });
    state.learningPreviewCards = data.cards.map(card => ({ ...card, selected: true }));
    renderLearningPreview();
    setStatus('learning-generate-status', `Preview ready: ${state.learningPreviewCards.length} cards for ${data.topic}. Review or edit them before saving.`);
  } catch (error) {
    console.error('Flashcard generation failed', error);
    setStatus('learning-generate-status', error.message || 'Could not generate cards. Please try again.');
  } finally {
    button.disabled = false;
  }
}

async function saveLearningCards() {
  const deck = state.decks.find(item => item.id === $('learning-topic').value);
  const selected = state.learningPreviewCards
    .filter(card => card.selected !== false)
    .map(({ front, back }) => ({
      front: front.trim(),
      back: back.trim(),
      aiGenerated: true,
      subject: deck?.name || 'General',
      sourceNoteId: $('flashcard-source-type').value === 'note' ? $('flashcard-note-source').value : '',
      sourceNoteTitle: $('flashcard-source-type').value === 'note'
        ? state.notes.find(note => note.id === $('flashcard-note-source').value)?.title || ''
        : '',
      sourceDocumentId: $('flashcard-source-type').value === 'document' ? $('flashcard-document-source').value : '',
      sourceDocumentTitle: $('flashcard-source-type').value === 'document'
        ? state.documents.find(item => item.id === $('flashcard-document-source').value)?.title || ''
        : ''
    }));
  if (!deck || !selected.length || selected.some(card => !card.front || !card.back)) {
    setStatus('learning-generate-status', 'Choose a deck, select cards, and make sure each question and answer is filled in.');
    return;
  }
  const button = $('learning-save-btn');
  button.disabled = true;
  setStatus('learning-generate-status', 'Saving cards… The database may take a moment to wake up.');
  try {
    const data = await learningApi('/api/cards/save', { deck_id: deck.id, topic: deck.name, cards: selected });
    const savedCount = data.cards.length;
    state.learningPreviewCards = state.learningPreviewCards.filter(card => card.selected === false);
    renderLearningPreview();
    await refreshFlashcardData();
    setStatus('learning-generate-status', `Saved ${savedCount} ${savedCount === 1 ? 'card' : 'cards'} to ${deck.name}.`);
    loadLearningStats();
  } catch (error) {
    console.error('Saving flashcards failed', error);
    setStatus('learning-generate-status', error.message || 'Could not save cards. Please try again.');
  } finally {
    button.disabled = !state.learningPreviewCards.some(card => card.selected !== false);
  }
}

function renderLearningReviewCard() {
  const card = state.learningReviewCards[state.learningReviewIndex];
  const cardElement = $('learning-review-card');
  const empty = $('learning-nothing-due');
  cardElement.classList.toggle('hidden', !card);
  empty.classList.toggle('hidden', Boolean(card) || state.learningReviewLoading);
  $('learning-due-count').textContent = state.learningReviewLoading
    ? 'Checking due cards…'
    : `${state.learningReviewDueCount} ${state.learningReviewDueCount === 1 ? 'card' : 'cards'} due`;
  if (!card) return;
  $('learning-review-topic').textContent = card.topic;
  $('learning-review-front').textContent = card.front;
  $('learning-review-answer').value = '';
  $('learning-submit-answer').classList.remove('hidden');
  $('learning-submit-answer').disabled = state.learningReviewLoading;
  $('learning-grade-result').classList.add('hidden');
  state.learningReviewGraded = false;
  state.learningReviewShownAt = Date.now();
}

async function loadLearningReview() {
  if (state.learningReviewLoading) return;
  state.learningReviewLoading = true;
  setStatus('learning-review-status', 'Loading due cards… The database may take a moment to wake up.');
  renderLearningReviewCard();
  try {
    const selectedDeck = $('learning-review-deck').value;
    const query = selectedDeck && selectedDeck !== 'all'
      ? `?limit=10&deck_id=${encodeURIComponent(selectedDeck)}`
      : '?limit=10';
    const data = await learningApi(`/api/review/next${query}`);
    state.learningReviewCards = data.cards;
    state.learningReviewIndex = 0;
    state.learningReviewDueCount = data.total_due;
    setStatus('learning-review-status', '');
  } catch (error) {
    state.learningReviewCards = [];
    state.learningReviewDueCount = 0;
    setStatus('learning-review-status', error.message || 'Could not load due cards.');
  } finally {
    state.learningReviewLoading = false;
    renderLearningReviewCard();
  }
}

async function submitLearningAnswer() {
  const card = state.learningReviewCards[state.learningReviewIndex];
  if (!card || state.learningReviewGraded || state.learningReviewLoading) return;
  const button = $('learning-submit-answer');
  button.disabled = true;
  setStatus('learning-review-status', 'Checking your answer…');
  try {
    const result = await learningApi('/api/review/grade', {
      card_id: card.id,
      user_answer: $('learning-review-answer').value,
      response_ms: Math.max(0, Date.now() - state.learningReviewShownAt)
    });
    state.learningReviewGraded = true;
    state.learningReviewDueCount = Math.max(0, state.learningReviewDueCount - 1);
    const reviewedDeck = state.decks.find(deck => deck.id === card.deck_id);
    if (reviewedDeck) reviewedDeck.due_count = Math.max(0, Number(reviewedDeck.due_count) - 1);
    updateFlashcardDueBadge(Math.max(0, state.flashcardDueCount - 1));
    renderFlashcardDeckSummary();
    $('learning-grade-score').textContent = `${result.score}%`;
    $('learning-grade-feedback').textContent = result.feedback;
    $('learning-correct-answer').textContent = result.correct_answer;
    $('learning-next-due').textContent = `Next review: ${new Date(result.next_due_at).toLocaleString()}`;
    $('learning-grade-result').classList.remove('hidden');
    $('learning-submit-answer').classList.add('hidden');
    setStatus('learning-review-status', '');
    loadProgressDeckStats();
  } catch (error) {
    console.error('Answer grading failed', error);
    setStatus('learning-review-status', error.message || 'Could not check the answer. Please try again.');
    button.disabled = false;
  }
}

async function showNextLearningCard() {
  if (!state.learningReviewGraded || state.learningReviewLoading) return;
  state.learningReviewIndex++;
  if (state.learningReviewIndex >= state.learningReviewCards.length) {
    await loadLearningReview();
    return;
  }
  renderLearningReviewCard();
  $('learning-review-answer').focus();
}

function renderLearningStats(data) {
  const topics = $('learning-topic-stats');
  const chart = $('learning-activity-chart');
  topics.replaceChildren();
  chart.replaceChildren();
  const deckStats = data.decks || data.topics || [];
  if (!deckStats.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No flashcard decks yet. Generate or add cards to see deck stats.';
    topics.appendChild(empty);
  }
  deckStats.forEach(topic => {
    const item = document.createElement('article');
    item.className = `learning-topic-stat${topic.weak ? ' weak' : ''}`;
    const heading = document.createElement('div');
    heading.className = 'learning-topic-stat-heading';
    const title = document.createElement('strong');
    title.textContent = topic.deck || topic.topic;
    heading.appendChild(title);
    if (topic.weak) {
      const badge = document.createElement('span');
      badge.className = 'learning-weak-badge';
      badge.textContent = 'Needs practice';
      heading.appendChild(badge);
    }
    const average = topic.average_score_30d === null
      ? 0
      : Math.max(0, Math.min(100, Number(topic.average_score_30d)));
    const track = document.createElement('div');
    track.className = 'learning-mastery-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', `${topic.deck || topic.topic} mastery`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(average)));
    const fill = document.createElement('span');
    fill.className = 'learning-mastery-fill';
    fill.style.width = `${average}%`;
    track.appendChild(fill);
    const meta = document.createElement('div');
    meta.className = 'learning-topic-stat-meta';
    meta.textContent = `${topic.average_score_30d === null ? 'No reviews yet' : `${Math.round(average)}% average`} · ${topic.total_cards} cards · ${topic.due_count} due · ${topic.review_count} reviews`;
    item.append(heading, track, meta);
    topics.appendChild(item);
  });
  renderProgressWeakDecks(deckStats);
  const maxReviews = Math.max(1, ...data.activity.map(day => Number(day.reviews)));
  data.activity.forEach(day => {
    const item = document.createElement('div');
    item.className = 'learning-activity-day';
    item.setAttribute('role', 'listitem');
    const wrap = document.createElement('div');
    wrap.className = 'learning-activity-bar-wrap';
    const bar = document.createElement('span');
    bar.className = 'learning-activity-bar';
    bar.style.height = `${Math.max(2, Number(day.reviews) / maxReviews * 100)}%`;
    bar.title = `${day.reviews} reviews`;
    wrap.appendChild(bar);
    const label = document.createElement('span');
    label.textContent = new Date(`${day.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });
    label.title = `${day.day}: ${day.reviews} reviews`;
    item.append(wrap, label);
    chart.appendChild(item);
  });
}

async function loadLearningStats() {
  if (state.learningStatsLoading) return;
  state.learningStatsLoading = true;
  setStatus('learning-stats-status', 'Loading deck stats… The database may take a moment to wake up.');
  try {
    const data = await learningApi('/api/stats/topics');
    renderLearningStats(data);
    setStatus('learning-stats-status', '');
  } catch (error) {
    console.error('Loading deck stats failed', error);
    setStatus('learning-stats-status', error.message || 'Could not load deck stats.');
  } finally {
    state.learningStatsLoading = false;
  }
}

document.querySelectorAll('[data-flashcard-view]').forEach(button => {
  button.addEventListener('click', () => setFlashcardsView(button.dataset.flashcardView));
});
$('learning-generate-btn').addEventListener('click', generateLearningCards);
$('learning-save-btn').addEventListener('click', saveLearningCards);
$('learning-refresh-review').addEventListener('click', loadLearningReview);
$('learning-submit-answer').addEventListener('click', submitLearningAnswer);
$('learning-next-card').addEventListener('click', showNextLearningCard);
$('learning-refresh-stats').addEventListener('click', loadLearningStats);
$('learning-review-deck').addEventListener('change', loadLearningReview);
$('flashcard-source-type').addEventListener('change', event => {
  if (state.flashcardSelectedSource === 'paste') state.flashcardPastedSource = $('learning-notes').value;
  state.flashcardSelectedSource = event.target.value;
  loadFlashcardSourceText();
});
$('flashcard-note-source').addEventListener('change', loadFlashcardSourceText);
$('flashcard-document-source').addEventListener('change', loadFlashcardSourceText);
$('learning-notes').addEventListener('input', () => {
  if ($('flashcard-source-type').value === 'paste') {
    state.flashcardPastedSource = $('learning-notes').value.slice(0, 6000);
    $('flashcard-truncation-notice').classList.add('hidden');
  }
});
$('learning-topic').addEventListener('change', async event => {
  if (event.target.value !== 'new') return;
  const name = window.prompt('Name your new deck');
  if (!name?.trim()) {
    renderFlashcardDeckSelectors();
    return;
  }
  try {
    const result = await flashcardApi('/api/decks', { name: name.trim() });
    await refreshFlashcardData(false);
    $('learning-topic').value = result.deck.id;
  } catch (error) {
    setStatus('learning-generate-status', error.message || 'Could not create the deck.');
    renderFlashcardDeckSelectors();
  }
});

$('chat-send').addEventListener('click', () => sendChat());
function updateTutorConnectionStatus() {
  $('tutor-connection-chip').textContent = 'Connected';
  $('tutor-connection-chip').dataset.state = 'connected';
}
updateTutorConnectionStatus();
$('logout-btn').addEventListener('click', async () => {
  const button = $('logout-btn');
  button.disabled = true;
  $('logout-status').textContent = '';
  $('logout-status').classList.add('hidden');
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'StudyBuddy'
      },
      body: '{}'
    });
    if (!response.ok) throw new Error('Could not log out right now. Please try again.');
    state.appInitialization = null;
    showLoginScreen();
    $('login-username').focus();
  } catch (error) {
    $('logout-status').textContent = error.message || 'Could not log out right now. Please try again.';
    $('logout-status').classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
});
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('chat-input').addEventListener('input', event => {
  const input = event.currentTarget;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
  $('chat-send').disabled = state.chatPending || !input.value.trim();
});
$('chat-input').addEventListener('paste', event => {
  const input = event.currentTarget;
  const pasted = event.clipboardData?.getData('text/plain') || '';
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const allowedLength = input.maxLength - (input.value.length - (end - start));
  if (allowedLength <= 0) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  const text = pasted.slice(0, allowedLength);
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
$('chat-log').addEventListener('scroll', () => {
  const log = $('chat-log');
  state.chatAtLatest = log.scrollHeight - log.clientHeight - log.scrollTop <= 48;
  $('chat-jump-latest').classList.toggle('hidden', state.chatAtLatest || state.chatHistory.length === 0);
});
$('chat-jump-latest').addEventListener('click', () => {
  state.chatAtLatest = true;
  $('chat-log').scrollTo({
    top: $('chat-log').scrollHeight,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  });
  $('chat-jump-latest').classList.add('hidden');
});
$('open-add-card-btn').addEventListener('click', () => openCardForm());
$('card-course-filter').addEventListener('change', renderCardList);
$('close-card-dialog').addEventListener('click', () => $('card-dialog').close());
$('cancel-card-dialog').addEventListener('click', () => $('card-dialog').close());
$('card-dialog').addEventListener('close', resetCardForm);
$('add-card-btn').addEventListener('click', saveCard);
$('card-unit-filter').addEventListener('change', renderCardList);
$('card-mastery-filter').addEventListener('change', renderCardList);
$('card-search').addEventListener('input', renderCardList);
$('generate-cards-btn').addEventListener('click', generateFlashcardsFromDocument);
$('export-cards-btn').addEventListener('click', async () => {
  try {
    await refreshFlashcardData(false);
    downloadJSON(state.cards, 'margin-flashcards.json');
  } catch (error) {
    setStatus('flashcards-storage-status', error.message || 'Could not export flashcards.');
  }
});
$('import-cards-btn').addEventListener('click', () => $('import-cards-file').click());
$('import-cards-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error('The deck file must contain a list of cards.');
    const imported = await importFlashcardRecords(data);
    setStatus('flashcards-storage-status', `Imported ${imported} ${imported === 1 ? 'card' : 'cards'} into Neon.`);
  } catch (error) {
    setStatus('flashcards-storage-status', error.message || 'Could not import that deck.');
  } finally {
    event.target.value = '';
  }
});
$('cards-study').addEventListener('keydown', event => {
  if (!state.studyDeck.length || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (event.code === 'Space' && (event.target === $('flip-card') || !event.target.matches('button, a'))) {
    event.preventDefault();
    $('flip-card').click();
  } else if (event.key === 'ArrowRight' && state.studyIndex < state.studyDeck.length) {
    event.preventDefault();
    navigateStudyCard(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateStudyCard(-1);
  }
});
$('flip-card').addEventListener('click', () => {
  if (state.studyIndex >= state.studyDeck.length) return;
  state.studyFlipped = !state.studyFlipped;
  $('flip-card').classList.toggle('flipped', state.studyFlipped);
  $('flip-card').setAttribute('aria-pressed', String(state.studyFlipped));
  $('flip-card').setAttribute('aria-label', state.studyFlipped ? 'Answer shown. Press Space to show question.' : 'Question shown. Press Space to show answer.');
});
$('card-got-it-btn').addEventListener('click', () => markStudyCard(true));
$('card-again-btn').addEventListener('click', () => markStudyCard(false));
$('card-study-prev-btn').addEventListener('click', () => navigateStudyCard(-1));
$('card-study-next-btn').addEventListener('click', () => navigateStudyCard(1));
$('card-study-exit-btn').addEventListener('click', exitCardStudy);
$('export-all-data-btn').addEventListener('click', () => {
  (async () => {
    try {
    await refreshFlashcardData(false);
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { documents: state.documents, cards: state.cards, notes: state.notes, quizResults: state.quizResults, timerSessions: state.timerSessions, classes: state.classes, assignments: state.assignments, tutorConversations: state.tutorConversations },
      localSettings: Object.fromEntries(BACKUP_LOCAL_SETTINGS
        .filter(key => localStorage.getItem(key) !== null)
        .map(key => [key, localStorage.getItem(key)]))
    };
    downloadJSON(backup, 'studybuddy-backup.json');
    setStatus('all-data-status', 'Backup exported. Keep the downloaded file somewhere safe.');
    } catch (error) {
    setStatus('all-data-status', error.message || 'Could not export a backup.');
    }
  })();
});
$('import-all-data-btn').addEventListener('click', () => $('import-all-data-file').click());
$('import-all-data-file').addEventListener('change', async e => {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  setStatus('all-data-status', 'Importing and merging backup...');
  try {
    const count = await importAllData(file);
    setStatus('all-data-status', `Imported ${count} records. Existing records were kept when IDs matched.`);
  } catch (error) {
    setStatus('all-data-status', error.message || 'Could not import that backup.');
  } finally {
    input.value = '';
  }
});
$('tutor-history-open').addEventListener('click', () => {
  state.historyPageIndex = 0;
  $('tutor-history-search').value = '';
  renderTutorHistory();
  $('tutor-history-dialog').showModal();
  $('tutor-history-search').focus();
});
$('tutor-history-search').addEventListener('input', () => {
  state.historyPageIndex = 0;
  renderTutorHistory();
});
$('new-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  createTutorConversation();
  $('chat-input').focus();
});
$('rename-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  renameTutorConversation(state.tutorConversations.find(item => item.id === state.activeConversationId));
});
$('export-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  exportTutorConversation();
});
$('tutor-conversation-title').addEventListener('change', async event => {
  const conversation = state.tutorConversations.find(item => item.id === state.activeConversationId);
  if (!conversation) return;
  conversation.title = event.target.value.trim().slice(0, 80) || 'New chat';
  await persistTutorConversations();
  event.target.value = conversation.title;
});
$('tutor-conversation-title').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  } else if (event.key === 'Escape') {
    event.currentTarget.value = state.tutorConversations.find(item => item.id === state.activeConversationId)?.title || 'New chat';
    event.currentTarget.blur();
  }
});
$('tutor-history-close').addEventListener('click', () => $('tutor-history-dialog').close());
$('tutor-overview-open').addEventListener('click', () => setTutorOverviewOpen(true));
$('tutor-aside-close').addEventListener('click', () => setTutorOverviewOpen(false));
$('tutor-aside-backdrop').addEventListener('click', () => setTutorOverviewOpen(false));
$('tutor-menu').addEventListener('keydown', event => {
  const items = [...$('tutor-menu').querySelectorAll('[role="menuitem"]')];
  const activeIndex = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    $('tutor-menu').open = false;
    $('tutor-menu').querySelector('summary').focus();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!$('tutor-menu').open) $('tutor-menu').open = true;
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (activeIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
  }
});
$('tutor-aside').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setTutorOverviewOpen(false);
    return;
  }
  if (event.key === 'Tab' && $('tutor-aside').classList.contains('open')) {
    const focusable = [...$('tutor-aside').querySelectorAll('button:not(:disabled)')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
$('clear-chat-btn').addEventListener('click', async () => {
  $('tutor-menu').open = false;
  const confirmed = await confirmBulkDeletion('Clear all Tutor conversations and messages? This does not delete notes or flashcards made from replies.');
  if (!confirmed) return;
  state.tutorConversations = [];
  state.chatHistory = [];
  state.activeConversationId = null;
  await idbSet('tutorConversations', state.tutorConversations);
  createTutorConversation();
  renderTutorHistory();
});
$('clear-quiz-history-btn').addEventListener('click', async () => {
  if (!state.quizResults.length) {
    setStatus('all-data-status', 'There is no quiz history to clear.');
    return;
  }
  const confirmed = await confirmBulkDeletion(`Delete all ${state.quizResults.length} quiz attempts? Quiz accuracy charts and course averages will be recalculated.`);
  if (!confirmed) return;
  const previous = state.quizResults;
  state.quizResults = [];
  if (!await idbSet('quizResults', state.quizResults)) {
    state.quizResults = previous;
    setStatus('all-data-status', 'Quiz history could not be cleared. Your data was restored.');
    return;
  }
  renderEverything();
  setStatus('all-data-status', 'Quiz history cleared.');
});
$('clear-timer-sessions-btn').addEventListener('click', async () => {
  if (!state.timerSessions.length) {
    setStatus('all-data-status', 'There are no timer sessions to clear.');
    return;
  }
  const confirmed = await confirmBulkDeletion(`Delete all ${state.timerSessions.length} timer sessions? Study-time totals, charts, and course progress will be recalculated.`);
  if (!confirmed) return;
  const previous = state.timerSessions;
  state.timerSessions = [];
  if (!await idbSet('timerSessions', state.timerSessions)) {
    state.timerSessions = previous;
    setStatus('all-data-status', 'Timer sessions could not be cleared. Your data was restored.');
    return;
  }
  renderTimer();
  renderEverything();
  setStatus('all-data-status', 'Timer sessions cleared.');
});
$('tutor-history-dialog').addEventListener('click', async event => {
  const openButton = event.target.closest('[data-open-conversation]');
  const renameButton = event.target.closest('[data-rename-conversation]');
  const deleteButton = event.target.closest('[data-delete-conversation]');
  if (openButton) {
    const conversation = state.tutorConversations.find(item => item.id === openButton.dataset.openConversation);
    if (!conversation) return;
    await persistTutorConversations();
    state.activeConversationId = conversation.id;
    state.chatHistory = conversation.messages;
    localStorage.setItem('studybuddy-active-conversation', state.activeConversationId);
    state.chatAtLatest = true;
    renderTutorChatPage();
    renderTutorOverview();
    $('tutor-history-dialog').close();
    return;
  }
  if (renameButton) {
    const conversation = state.tutorConversations.find(item => item.id === renameButton.dataset.renameConversation);
    if (!conversation) return;
    renameTutorConversation(conversation);
    return;
  }
  if (deleteButton) {
    const conversation = state.tutorConversations.find(item => item.id === deleteButton.dataset.deleteConversation);
    if (!conversation) return;
    const confirmed = await confirmDeletion({
      title: `Delete conversation "${conversation.title || 'New chat'}"?`,
      description: `This removes the conversation and its ${conversation.messages.length} messages from this browser.`,
      affected: 'Saved notes and flashcards created from replies are not changed.'
    });
    if (!confirmed) return;
    if (state.activeConversationId === conversation.id) {
      state.activeConversationId = state.tutorConversations.find(item => item.id !== conversation.id)?.id || null;
      state.chatHistory = state.tutorConversations.find(item => item.id === state.activeConversationId)?.messages || [];
    }
    localStorage.setItem('studybuddy-active-conversation', state.activeConversationId || '');
    await softDeleteRecords([{ collection: 'tutorConversations', ids: [conversation.id] }], 'Conversation deleted.');
    if (!state.activeConversationId) createTutorConversation();
    renderTutorChatPage();
    renderTutorOverview();
    renderTutorHistory();
  }
});
$('reply-dialog-close').addEventListener('click', () => $('reply-dialog').close());
$('tutor-study-scope').addEventListener('change', () => {
  $('tutor-study-scope').setAttribute('aria-label', 'Study material scope');
});
on('timer:session-logged', () => renderProgress());
on('classes:changed', () => renderEverything());
on('assignments:changed', () => renderEverything());
on('assignment-brief:changed', () => renderEverything());
on('documents:changed', () => renderEverything());
on('flashcards:create-from-note', async ({ records, noteTitle, onComplete, onError }) => {
  try {
    await importFlashcardRecords(records);
    activatePage('cards');
    setFlashcardsView('cards');
    setStatus('cards-ai-status', `Added ${records.length} cards from ${noteTitle || 'your note'}.`);
    onComplete?.();
  } catch (error) {
    onError?.(error);
  }
});
on('tutor:ask-about-note', ({ note }) => {
  activatePage('tutor');
  $('tutor-use-material').checked = true;
  localStorage.setItem(TUTOR_MATERIAL_KEY, 'true');
  $('settings-tutor-material').checked = true;
  $('tutor-study-scope').value = 'all';
  $('chat-input').value = `Help me understand the main ideas in my note "${note.title || 'Untitled note'}".`;
  $('chat-input').focus();
});
on('flashcards:create-from-mistakes', async ({ records, onComplete, onError }) => {
  try {
    const added = await importFlashcardRecords(records);
    onComplete?.(added);
  } catch (error) {
    onError?.(error);
  }
});

async function init() {
  initUndo({ flashcardApi, refreshFlashcardData, renderEverything });
  initializeCustomControls();
  initTimer();
  initDocuments({ renderProgress });
  initQuiz({
    callAI,
    aiDocumentPayload,
    activatePage,
    renderProgress
  });
  initMarkdown();
  initNotes({
    callAI,
    aiDocumentPayload,
    renderEverything,
    updateStudyMaterialIndex,
    renderTaxonomy
  });
  initAssignmentBrief({
    briefsApi: assignmentBriefsApi,
    apiFetch,
    apiErrorMessage
  });
  initAssignments({ openAssignmentBriefDialog });
  initCalendar({
    openAssignmentForm,
    assignmentMarkup,
    bindAssignmentActions,
    syncReminderControls
  });
  initClasses({
    openAssignmentForm,
    renderAssignmentList,
    renderCalendar,
    activatePage
  });
  state.documents = await idbGet('documents') || [];
  state.cards = [];
  state.notes = await idbGet('notes') || [];
  state.quizResults = await idbGet('quizResults') || [];
  state.timerSessions = await idbGet('timerSessions') || [];
  if (state.timerSessions.some(session => !session.id)) {
    state.timerSessions = state.timerSessions.map(session => session.id ? session : { ...session, id: uid() });
    await idbSet('timerSessions', state.timerSessions);
  }
  state.classes = await idbGet('classes') || [];
  state.assignments = await idbGet('assignments') || [];
  await loadAssignmentBriefs();
  state.tutorConversations = await idbGet('tutorConversations') || [];
  let migratedTutorTimestamps = false;
  state.tutorConversations.forEach(conversation => {
    if (!Array.isArray(conversation.messages)) {
      conversation.messages = [];
      migratedTutorTimestamps = true;
    }
    const messages = conversation.messages;
    messages.forEach((message, index) => {
      if (message.timestamp != null && Number.isFinite(Number(message.timestamp))) return;
      message.timestamp = Math.max(0, Number(conversation.updatedAt) - (messages.length - index) * 60000) || Date.now();
      migratedTutorTimestamps = true;
    });
  });
  if (migratedTutorTimestamps) await idbSet('tutorConversations', state.tutorConversations);
  state.deletedRecords = (await idbGet('deletedRecords') || []).filter(snapshot => snapshot.expiresAt > Date.now());
  await idbSet('deletedRecords', state.deletedRecords);
  const savedConversationId = localStorage.getItem('studybuddy-active-conversation');
  state.activeConversationId = state.tutorConversations.some(item => item.id === savedConversationId)
    ? savedConversationId
    : state.tutorConversations.at(-1)?.id || null;
  state.chatHistory = state.tutorConversations.find(item => item.id === state.activeConversationId)?.messages || [];
  if (!state.activeConversationId) {
    const conversation = { id: uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    state.tutorConversations.push(conversation);
    state.activeConversationId = conversation.id;
    state.chatHistory = conversation.messages;
    localStorage.setItem('studybuddy-active-conversation', state.activeConversationId);
    await persistTutorConversations();
  }
  await cleanupStoredNotes();
  await loadFlashcardsFromServer();
  state.progressDataLoading = false;
  renderTimer();
  renderEverything();
  renderFlashcardSourceOptions();
  setFlashcardsView(sessionStorage.getItem(FLASHCARD_VIEW_KEY) || 'cards');
  renderTutorChatPage();
  state.deletedRecords.forEach(snapshot => {
    const remaining = Math.max(0, snapshot.expiresAt - Date.now());
    state.undoTimers.set(snapshot.id, setTimeout(() => purgeUndoSnapshot(snapshot.id), remaining));
  });
  if (state.deletedRecords.length) showUndoToast(state.deletedRecords.at(-1), 'An item was deleted.');
  if (state.documents[0]) previewDocument(state.documents[0].id);
  syncReminderControls();
  checkAssignmentReminders();
  $('export-all-data-btn').disabled = false;
  $('import-all-data-btn').disabled = false;
}
checkAuthentication();
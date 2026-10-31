// Force the frontend to use the real Express backend (not GitHub Pages static hosting)
window.MARGIN_API_BASE = window.MARGIN_API_BASE || (
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? ''
    : 'https://studybuddy2-r2i6.onrender.com'
);

const DB_NAME = 'margin-db';
const STORE = 'kv';
const QUERY_API_BASE = new URLSearchParams(location.search).get('api') || '';
const CONFIGURED_API_BASE = window.MARGIN_API_BASE || QUERY_API_BASE || localStorage.getItem('margin-api-base') || '';
const DEPLOYED_API_BASE = 'https://studybuddy2-r2i6.onrender.com';
const API_TIMEOUT_MS = 75000;
const ACCESS_TOKEN_KEY = 'studybuddy-access-token';
const BACKUP_FORMAT = 'studybuddy-data';
const BACKUP_VERSION = 1;
const BACKUP_COLLECTIONS = ['documents', 'cards', 'notes', 'quizResults', 'timerSessions', 'classes', 'assignments'];
const REQUIRED_BACKUP_COLLECTIONS = ['documents', 'cards', 'notes', 'quizResults', 'timerSessions'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REMINDERS_ENABLED_KEY = 'studybuddy-assignment-reminders';
let dbPromise = null;

let documents = [];
let cards = [];
let notes = [];
let quizResults = [];
let timerSessions = [];
let classes = [];
let assignments = [];
let activeSubject = 'all';
let showOriginalDocumentText = false;
let editingNoteId = null;
let editingCardId = null;
let currentPreviewDocId = null;
let chatHistory = [];
let studyDeck = [];
let studyIndex = 0;
let studyFlipped = false;
let currentQuiz = null;
let editingClassId = null;
let editingAssignmentId = null;
let calendarWeekOffset = 0;
let reminderIntervalId = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function idbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, value });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('Could not save', key, e); return false; }
}
async function idbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('Could not load', key, e); return undefined; }
}

const $ = id => document.getElementById(id);
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function normalizeAnswer(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function courseUnitKey(course, unit) { return `${course || 'General'}|${unit || 'General'}`; }
function truncateText(text, max = 12000) { return String(text || '').slice(0, max); }
function setStatus(id, text) { $(id).textContent = text; }
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
function cleanApiBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
function apiBaseCandidates() {
  // Prefer the forced backend base (set at top of file) and ignore other heuristics
  // to avoid accidentally falling back to localhost when running on a static host.
  const forced = cleanApiBase(window.MARGIN_API_BASE);
  if (forced) return [forced];

  const configured = cleanApiBase(CONFIGURED_API_BASE);
  if (configured) return [configured];

  // Fallback (dev-only) if nothing is configured
  return ['http://localhost:3000'];
}
async function apiFetch(path, options = {}) {
  const bases = apiBaseCandidates();
  if (bases.length === 0) {
    throw new Error('Set your backend URL first. Define window.MARGIN_API_BASE or deploy the Express server and update DEPLOYED_API_BASE.');
  }

  let lastError = null;
  for (const base of bases) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const accessToken = $('access-token-input')?.value || localStorage.getItem(ACCESS_TOKEN_KEY) || '';
      const res = await fetch(`${base}${path}`, {
        ...options,
        headers: { ...options.headers, 'x-access-token': accessToken },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.status !== 404) {
        localStorage.setItem('margin-api-base', base);
        return res;
      }
      lastError = new Error(`No API route at ${base}`);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
    }
  }

  const tried = bases.join(', ');
  const last = lastError?.message || String(lastError || 'Unknown error');
  if (lastError?.name === 'AbortError') {
    throw new Error(`Backend timeout calling ${path}. Tried: ${tried}. Last error: ${last}`);
  }
  throw new Error(`Could not reach backend for ${path}. Tried: ${tried}. Last error: ${last}`);
}

function persistAll() {
  idbSet('documents', documents);
  idbSet('cards', cards);
  idbSet('notes', notes);
  idbSet('quizResults', quizResults);
  idbSet('timerSessions', timerSessions);
}

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  classes: 'Classes',
  documents: 'Documents',
  tutor: 'Tutor',
  cards: 'Flashcards',
  quiz: 'Quiz',
  timer: 'Timer',
  notes: 'Notes',
  progress: 'Progress',
  settings: 'Settings'
};
const THEME_KEY = 'studybuddy-theme';
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

function renderDashboard() {
  const now = new Date();
  const hour = now.getHours();
  $('dashboard-greeting').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextWeek = new Date(todayStart);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const todaySessions = timerSessions.filter(session => new Date(session.completedAt).toDateString() === now.toDateString());
  const focusMinutes = Math.floor(todaySessions.reduce((total, session) => total + (Number(session.seconds) || 0), 0) / 60);
  const dueSoon = assignments.filter(assignment => !assignment.completed
    && Number(assignment.dueAt) >= now.getTime() && Number(assignment.dueAt) < nextWeek.getTime());
  const reviewCount = cards.filter(card => !card.mastered).length;
  const todayClasses = classes.filter(item => Array.isArray(item.meetingDays)
    && item.meetingDays.some(day => Number(day) === now.getDay()));
  const todayAssignments = assignments.filter(assignment => !assignment.completed
    && new Date(Number(assignment.dueAt)).toDateString() === now.toDateString());

  $('dashboard-focus-time').textContent = focusMinutes < 60
    ? `${focusMinutes} min`
    : `${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60}m`;
  $('dashboard-due-count').textContent = String(dueSoon.length);
  $('dashboard-completed-count').textContent = String(assignments.filter(assignment => assignment.completed).length);
  $('dashboard-review-count').textContent = String(reviewCount);
  $('dashboard-summary').textContent = [
    `${todayClasses.length} ${todayClasses.length === 1 ? 'class' : 'classes'} today`,
    `${dueSoon.length} ${dueSoon.length === 1 ? 'deadline' : 'deadlines'} in the next 7 days`
  ].join(' · ');

  const events = [
    ...todayClasses.map(item => ({
      sortKey: item.startTime || '99:99',
      time: item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : item.startTime || 'Class',
      title: item.name,
      detail: item.location || item.instructor || 'Class meeting'
    })),
    ...todayAssignments.map(assignment => ({
      sortKey: `${String(new Date(Number(assignment.dueAt)).getHours()).padStart(2, '0')}:${String(new Date(Number(assignment.dueAt)).getMinutes()).padStart(2, '0')}`,
      time: `Due ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(Number(assignment.dueAt)))}`,
      title: assignment.title || 'Untitled assignment',
      detail: classForAssignment(assignment)?.name || 'General'
    }))
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  $('dashboard-today-schedule').innerHTML = events.length
    ? events.map(event => `
      <article class="dashboard-list-row">
        <span class="dashboard-event-time">${escapeHtml(event.time)}</span>
        <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></div>
      </article>
    `).join('')
    : '<p class="dashboard-empty">Nothing scheduled today. You have room for a focused study session.</p>';

  const upcoming = assignments.filter(assignment => !assignment.completed && Number(assignment.dueAt) < nextWeek.getTime())
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
    .slice(0, 5);
  $('dashboard-upcoming-assignments').innerHTML = upcoming.length
    ? upcoming.map(assignment => {
      const dueAt = Number(assignment.dueAt);
      const overdue = dueAt < todayStart.getTime();
      const label = overdue ? 'Overdue' : `Due ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(dueAt))}`;
      const course = classForAssignment(assignment)?.name || 'General';
      return `
        <article class="dashboard-list-row dashboard-assignment-row">
          <button class="dashboard-complete-btn" type="button" data-toggle-assignment="${escapeHtml(assignment.id)}" aria-label="Mark ${escapeHtml(assignment.title)} complete">○</button>
          <div><strong>${escapeHtml(assignment.title || 'Untitled assignment')}</strong><small>${escapeHtml(course)} · ${escapeHtml(label)}</small></div>
        </article>
      `;
    }).join('')
    : '<p class="dashboard-empty">No open deadlines in the next 7 days.</p>';
  bindAssignmentActions($('dashboard-upcoming-assignments'));

  const latestDocument = documents
    .filter(documentItem => (documentItem.readingProgress || 0) < 100)
    .sort((a, b) => (b.lastOpened || b.uploadedAt || 0) - (a.lastOpened || a.uploadedAt || 0))[0];
  const continueButton = $('dashboard-continue-button');
  if (latestDocument) {
    $('dashboard-continue-title').textContent = `Continue ${latestDocument.title}`;
    $('dashboard-continue-detail').textContent = `${latestDocument.course || 'General'} · ${latestDocument.readingProgress || 0}% read`;
    continueButton.textContent = 'Continue reading';
    continueButton.dataset.documentId = latestDocument.id;
    continueButton.dataset.go = '';
  } else if (reviewCount) {
    $('dashboard-continue-title').textContent = 'Keep your knowledge fresh';
    $('dashboard-continue-detail').textContent = `${reviewCount} ${reviewCount === 1 ? 'flashcard' : 'flashcards'} ready to review.`;
    continueButton.textContent = 'Review flashcards';
    continueButton.dataset.documentId = '';
    continueButton.dataset.go = 'cards';
  } else if (upcoming.length) {
    $('dashboard-continue-title').textContent = 'Make progress on what is due next';
    $('dashboard-continue-detail').textContent = `${upcoming[0].title || 'Your next assignment'} is coming up.`;
    continueButton.textContent = 'View assignments';
    continueButton.dataset.documentId = '';
    continueButton.dataset.go = 'classes';
  } else {
    $('dashboard-continue-title').textContent = 'Ready for your next study session?';
    $('dashboard-continue-detail').textContent = 'Start a focus session and make time for one small win.';
    continueButton.textContent = 'Start focus session';
    continueButton.dataset.documentId = '';
    continueButton.dataset.go = 'timer';
  }
}

$('dashboard-continue-button').addEventListener('click', event => {
  const button = event.currentTarget;
  if (button.dataset.documentId) {
    activatePage('documents');
    previewDocument(button.dataset.documentId);
  } else if (PAGE_TITLES[button.dataset.go]) {
    activatePage(button.dataset.go);
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
  if (!PAGE_TITLES[page] || !$(`panel-${page}`)) return;
  document.querySelectorAll('.tab').forEach(button => {
    const active = button.dataset.tab === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `panel-${page}`));
  $('page-title').textContent = PAGE_TITLES[page];
  $('page-layout').classList.toggle('tutor-active', page === 'tutor');
  if (page === 'dashboard') renderDashboard();
  if (page === 'progress') renderProgress();
  if (page === 'tutor') renderTutorOverview();
  if (page === 'calendar') renderCalendar();
  if (page === 'classes') renderClasses();
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  activatePage(tab.dataset.tab);
  closeMobileMenu();
}));

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
$('theme-select').value = document.documentElement.dataset.theme || localStorage.getItem(THEME_KEY) || 'system';
setTheme($('theme-select').value);
$('theme-select').addEventListener('change', event => setTheme(event.target.value));
$('theme-toggle').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((document.documentElement.dataset.theme || 'system') === 'system') setTheme('system');
});
updatePageDate();
activatePage('dashboard');

document.querySelectorAll('.quick-prompt').forEach(button => button.addEventListener('click', () => {
  $('chat-input').value = button.dataset.prompt;
  $('chat-input').focus();
}));

function dateTimeInputValue(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function getCalendarWeekStart() {
  const start = startOfWeek(new Date());
  start.setDate(start.getDate() + calendarWeekOffset * 7);
  return start;
}

function formatDueDate(timestamp, includeYear = true) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function formatMeetingDays(days) {
  return (Array.isArray(days) ? days : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day < 7)
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map(day => WEEKDAY_NAMES[day].slice(0, 3))
    .join(', ');
}

function classForAssignment(assignment) {
  return classes.find(item => item.id === assignment.classId);
}

function assignmentMarkup(assignment) {
  const classItem = classForAssignment(assignment);
  const dueAt = Number(assignment.dueAt);
  const overdue = !assignment.completed && dueAt < Date.now();
  return `
    <article class="assignment-row ${assignment.completed ? 'is-complete' : ''} ${overdue ? 'is-overdue' : ''}">
      <div class="assignment-copy">
        <div class="meta-line">
          <span class="pill">${escapeHtml(classItem?.name || 'General')}</span>
          <span class="pill ${assignment.completed ? 'good' : overdue ? 'overdue-pill' : ''}">${assignment.completed ? 'Completed' : overdue ? 'Overdue' : 'Due'}</span>
        </div>
        <h3>${escapeHtml(assignment.title || 'Untitled assignment')}</h3>
        <time datetime="${new Date(dueAt).toISOString()}">${escapeHtml(formatDueDate(dueAt))}</time>
        ${assignment.details ? `<p>${escapeHtml(assignment.details)}</p>` : ''}
        ${Number.isFinite(assignment.reminderAt) && !assignment.completed ? `<span class="assignment-reminder-note">Reminder: ${escapeHtml(formatDueDate(assignment.reminderAt))}</span>` : ''}
      </div>
      <div class="assignment-actions">
        <button class="btn btn-sm" type="button" data-toggle-assignment="${escapeHtml(assignment.id)}">${assignment.completed ? 'Reopen' : 'Mark complete'}</button>
        <button class="icon-btn" type="button" data-edit-assignment="${escapeHtml(assignment.id)}" aria-label="Edit assignment" title="Edit">edit</button>
        <button class="icon-btn btn-danger" type="button" data-delete-assignment="${escapeHtml(assignment.id)}" aria-label="Delete assignment" title="Delete">x</button>
      </div>
    </article>
  `;
}

function bindAssignmentActions(container) {
  container.querySelectorAll('[data-toggle-assignment]').forEach(button => button.addEventListener('click', () => {
    const assignment = assignments.find(item => item.id === button.dataset.toggleAssignment);
    if (!assignment) return;
    assignment.completed = !assignment.completed;
    if (assignment.completed) assignment.reminderSentAt = null;
    idbSet('assignments', assignments);
    renderEverything();
  }));
  container.querySelectorAll('[data-edit-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm(button.dataset.editAssignment)));
  container.querySelectorAll('[data-delete-assignment]').forEach(button => button.addEventListener('click', () => {
    const assignment = assignments.find(item => item.id === button.dataset.deleteAssignment);
    if (!assignment || !confirm(`Delete "${assignment.title}"?`)) return;
    assignments = assignments.filter(item => item.id !== assignment.id);
    idbSet('assignments', assignments);
    renderEverything();
  }));
}

function renderAssignmentList(container, emptyMessage) {
  const ordered = [...assignments].sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  container.innerHTML = ordered.length
    ? ordered.map(assignmentMarkup).join('')
    : (emptyMessage ? `<div class="empty-state">${escapeHtml(emptyMessage)}</div>` : '');
  bindAssignmentActions(container);
  return ordered.length;
}

function renderClasses() {
  const list = $('class-list');
  const empty = $('classes-empty');
  if (!classes.length) {
    list.replaceChildren();
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = [...classes].sort((a, b) => a.name.localeCompare(b.name)).map(item => {
      const days = formatMeetingDays(item.meetingDays);
      const time = item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : '';
      return `
        <article class="class-card">
          <div class="class-card-main">
            <div class="class-mark" aria-hidden="true">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</div>
            <div class="class-card-copy">
              <h3>${escapeHtml(item.name)}</h3>
              <p>${[item.instructor, item.location].filter(Boolean).map(escapeHtml).join(' · ') || 'Class details not added'}</p>
              ${days ? `<div class="class-meeting-line"><strong>${escapeHtml(days)}</strong>${time ? `<span>${escapeHtml(time)}</span>` : ''}</div>` : '<span class="hint">No weekly meeting time</span>'}
            </div>
          </div>
          <div class="class-card-actions">
            <button class="btn btn-sm" type="button" data-add-class-assignment="${escapeHtml(item.id)}">Add assignment</button>
            <button class="icon-btn" type="button" data-edit-class="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit">edit</button>
            <button class="icon-btn btn-danger" type="button" data-delete-class="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}" title="Delete">x</button>
          </div>
        </article>
      `;
    }).join('');
    list.querySelectorAll('[data-edit-class]').forEach(button => button.addEventListener('click', () => openClassForm(button.dataset.editClass)));
    list.querySelectorAll('[data-add-class-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm(null, button.dataset.addClassAssignment)));
    list.querySelectorAll('[data-delete-class]').forEach(button => button.addEventListener('click', () => {
      const item = classes.find(course => course.id === button.dataset.deleteClass);
      if (!item) return;
      const linked = assignments.filter(assignment => assignment.classId === item.id).length;
      const message = linked
        ? `Delete "${item.name}"? Its ${linked} ${linked === 1 ? 'assignment will' : 'assignments will'} stay in your list without a class.`
        : `Delete "${item.name}"?`;
      if (!confirm(message)) return;
      classes = classes.filter(course => course.id !== item.id);
      assignments.forEach(assignment => {
        if (assignment.classId === item.id) assignment.classId = '';
      });
      idbSet('classes', classes);
      idbSet('assignments', assignments);
      renderEverything();
    }));
  }
  const assignmentCount = renderAssignmentList($('classes-assignment-list'), '');
  $('assignments-empty').classList.toggle('hidden', assignmentCount > 0);
  renderCalendar();
}

function renderCalendar() {
  const week = $('calendar-week');
  if (!week) return;
  const firstDay = getCalendarWeekStart();
  const lastDay = new Date(firstDay);
  lastDay.setDate(firstDay.getDate() + 6);
  const rangeFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  $('calendar-range').textContent = `${rangeFormatter.format(firstDay)} – ${rangeFormatter.format(lastDay)}`;
  week.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    const dateKey = localDateKey(date);
    const events = [];
    classes.forEach(item => {
      const days = Array.isArray(item.meetingDays) ? item.meetingDays.map(Number) : [];
      if (!days.includes(date.getDay())) return;
      const time = item.startTime ? `<time>${escapeHtml(item.startTime)}${item.endTime ? `–${escapeHtml(item.endTime)}` : ''}</time>` : '<time>Class</time>';
      events.push({ time: item.startTime || '', html: `<div class="calendar-event class-event"><strong>${escapeHtml(item.name)}</strong>${time}${item.location ? `<span>${escapeHtml(item.location)}</span>` : ''}</div>` });
    });
    assignments.forEach(assignment => {
      if (localDateKey(new Date(Number(assignment.dueAt))) !== dateKey) return;
      events.push({ time: new Date(Number(assignment.dueAt)).toTimeString().slice(0, 5), html: `<div class="calendar-event assignment-event ${assignment.completed ? 'is-complete' : ''}"><span>${assignment.completed ? 'Completed' : 'Assignment'}</span><strong>${escapeHtml(assignment.title)}</strong><time>${escapeHtml(new Date(Number(assignment.dueAt)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</time><button type="button" data-edit-assignment="${escapeHtml(assignment.id)}">View assignment</button></div>` });
    });
    events.sort((a, b) => a.time.localeCompare(b.time));
    const todayClass = dateKey === localDateKey(new Date()) ? 'is-today' : '';
    return `
      <section class="calendar-day ${todayClass}">
        <header><span>${escapeHtml(WEEKDAY_NAMES[date.getDay()].slice(0, 3))}</span><strong>${date.getDate()}</strong></header>
        <div class="calendar-day-events">${events.map(event => event.html).join('') || '<span class="calendar-no-events">No events</span>'}</div>
      </section>
    `;
  }).join('');
  week.querySelectorAll('[data-edit-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm(button.dataset.editAssignment)));
  const upcoming = assignments.filter(assignment => !assignment.completed).sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  const container = $('calendar-assignment-list');
  container.innerHTML = upcoming.length
    ? upcoming.map(assignmentMarkup).join('')
    : '<div class="empty-state">You are all caught up. Add an assignment to see it on your calendar.</div>';
  bindAssignmentActions(container);
  syncReminderControls();
}

function syncReminderControls() {
  const checkbox = $('calendar-reminders-enabled');
  if (!checkbox) return;
  const supported = typeof window.Notification !== 'undefined';
  checkbox.disabled = !supported;
  checkbox.checked = supported
    && Notification.permission === 'granted'
    && localStorage.getItem(REMINDERS_ENABLED_KEY) === 'true';
  if (!supported && !checkbox.dataset.unsupportedMessage) {
    setStatus('calendar-reminder-status', 'Browser notifications are not supported here. You can still view due dates in the calendar.');
    checkbox.dataset.unsupportedMessage = 'true';
  }
}

async function setAssignmentRemindersEnabled(enabled) {
  if (!enabled) {
    localStorage.setItem(REMINDERS_ENABLED_KEY, 'false');
    setStatus('calendar-reminder-status', 'Assignment reminders are off.');
    syncReminderControls();
    return;
  }
  if (typeof window.Notification === 'undefined') {
    setStatus('calendar-reminder-status', 'This browser does not support notifications.');
    syncReminderControls();
    return;
  }
  try {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') {
      localStorage.setItem(REMINDERS_ENABLED_KEY, 'false');
      setStatus('calendar-reminder-status', 'Notification permission was not granted. Due dates remain visible in your calendar.');
      syncReminderControls();
      return;
    }
    localStorage.setItem(REMINDERS_ENABLED_KEY, 'true');
    setStatus('calendar-reminder-status', 'Assignment reminders are enabled while StudyBuddy is open.');
    syncReminderControls();
    checkAssignmentReminders();
  } catch (error) {
    localStorage.setItem(REMINDERS_ENABLED_KEY, 'false');
    setStatus('calendar-reminder-status', 'Could not enable browser notifications. Check your browser permissions and try again.');
    syncReminderControls();
  }
}

function checkAssignmentReminders() {
  if (localStorage.getItem(REMINDERS_ENABLED_KEY) !== 'true'
    || typeof window.Notification === 'undefined'
    || Notification.permission !== 'granted') return;
  const now = Date.now();
  let changed = false;
  assignments.forEach(assignment => {
    if (assignment.completed || !Number.isFinite(assignment.reminderAt)
      || assignment.reminderAt > now || assignment.reminderSentAt) return;
    try {
      new Notification('Assignment reminder', {
        body: `${assignment.title} is due ${formatDueDate(Number(assignment.dueAt))}.`,
        tag: `studybuddy-assignment-${assignment.id}`
      });
      assignment.reminderSentAt = now;
      changed = true;
    } catch (error) {
      setStatus('calendar-reminder-status', 'A browser notification could not be shown. Check your browser permissions.');
    }
  });
  if (changed) idbSet('assignments', assignments);
}

function openClassForm(id = null) {
  const item = classes.find(course => course.id === id);
  editingClassId = item?.id || null;
  $('class-dialog-title').textContent = item ? 'Edit class' : 'Add a class';
  $('save-class-btn').textContent = item ? 'Save changes' : 'Save class';
  $('class-name').value = item?.name || '';
  $('class-instructor').value = item?.instructor || '';
  $('class-location').value = item?.location || '';
  $('class-start-time').value = item?.startTime || '';
  $('class-end-time').value = item?.endTime || '';
  const selectedDays = new Set((item?.meetingDays || []).map(Number));
  document.querySelectorAll('[name="class-meeting-day"]').forEach(input => {
    input.checked = selectedDays.has(Number(input.value));
  });
  $('class-dialog').showModal();
  $('class-name').focus();
}

function resetClassForm() {
  editingClassId = null;
  $('class-form').reset();
  $('class-dialog-title').textContent = 'Add a class';
  $('save-class-btn').textContent = 'Save class';
}

async function saveClass() {
  const name = $('class-name').value.trim();
  const meetingDays = [...document.querySelectorAll('[name="class-meeting-day"]:checked')].map(input => Number(input.value));
  const startTime = $('class-start-time').value;
  const endTime = $('class-end-time').value;
  if (meetingDays.length && (!startTime || !endTime || startTime >= endTime)) {
    const invalidInput = !startTime ? $('class-start-time') : $('class-end-time');
    invalidInput.setCustomValidity(!startTime || !endTime ? 'Choose both meeting times when setting weekly meeting days.' : 'The end time must be after the start time.');
    invalidInput.reportValidity();
    invalidInput.addEventListener('input', () => invalidInput.setCustomValidity(''), { once: true });
    return;
  }
  const fields = {
    name,
    instructor: $('class-instructor').value.trim(),
    location: $('class-location').value.trim(),
    meetingDays,
    startTime,
    endTime
  };
  const item = classes.find(course => course.id === editingClassId);
  if (item) Object.assign(item, fields, { updatedAt: Date.now() });
  else classes.push({ id: uid(), ...fields, createdAt: Date.now() });
  $('class-dialog').close();
  resetClassForm();
  await idbSet('classes', classes);
  renderEverything();
}

function renderAssignmentClassOptions(selectedId = '') {
  $('assignment-class').innerHTML = `<option value="">General (no class)</option>${classes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('')}`;
  $('assignment-class').value = classes.some(item => item.id === selectedId) ? selectedId : '';
}

function openAssignmentForm(id = null, classId = '') {
  const assignment = assignments.find(item => item.id === id);
  editingAssignmentId = assignment?.id || null;
  $('assignment-dialog-title').textContent = assignment ? 'Edit assignment' : 'Add an assignment';
  $('save-assignment-btn').textContent = assignment ? 'Save changes' : 'Save assignment';
  $('assignment-title').value = assignment?.title || '';
  $('assignment-details').value = assignment?.details || '';
  $('assignment-due').value = dateTimeInputValue(Number(assignment?.dueAt));
  $('assignment-reminder').value = assignment?.reminderAt == null ? '' : dateTimeInputValue(Number(assignment.reminderAt));
  renderAssignmentClassOptions(assignment?.classId || classId);
  $('assignment-dialog').showModal();
  $('assignment-title').focus();
}

function resetAssignmentForm() {
  editingAssignmentId = null;
  $('assignment-form').reset();
  $('assignment-dialog-title').textContent = 'Add an assignment';
  $('save-assignment-btn').textContent = 'Save assignment';
}

async function saveAssignment() {
  const dueAt = new Date($('assignment-due').value).getTime();
  const reminderValue = $('assignment-reminder').value;
  const reminderAt = reminderValue ? new Date(reminderValue).getTime() : null;
  if (reminderAt !== null && reminderAt > dueAt) {
    const input = $('assignment-reminder');
    input.setCustomValidity('The reminder time must be before the due date.');
    input.reportValidity();
    input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
    return;
  }
  const fields = {
    title: $('assignment-title').value.trim(),
    classId: $('assignment-class').value,
    dueAt,
    reminderAt,
    reminderSentAt: null,
    details: $('assignment-details').value.trim()
  };
  const assignment = assignments.find(item => item.id === editingAssignmentId);
  if (assignment) {
    const reminderChanged = assignment.reminderAt !== reminderAt || assignment.dueAt !== dueAt;
    fields.reminderSentAt = reminderChanged ? null : (assignment.reminderSentAt || null);
    Object.assign(assignment, fields, { updatedAt: Date.now() });
  }
  else assignments.push({ id: uid(), ...fields, completed: false, createdAt: Date.now() });
  $('assignment-dialog').close();
  resetAssignmentForm();
  await idbSet('assignments', assignments);
  renderEverything();
  checkAssignmentReminders();
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\uF0B7\u2022\u25AA\u25CF\u25E6]/g, '•')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}

function extractPdfPageText(items) {
  const lines = [];
  items.filter(item => typeof item.str === 'string' && item.str.trim()).forEach(item => {
    const transform = item.transform || [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const fontSize = Math.abs(Number(transform[3])) || 10;
    let line = lines.find(candidate => Math.abs(candidate.y - y) <= Math.max(2, fontSize * 0.22));
    if (!line) {
      line = { y, fontSize, items: [] };
      lines.push(line);
    }
    line.items.push({ x, width: Number(item.width) || 0, text: item.str });
  });

  lines.sort((a, b) => b.y - a.y);
  return lines.map((line, index) => {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd = null;
    line.items.forEach(item => {
      const gap = previousEnd === null ? 0 : item.x - previousEnd;
      if (text && gap > 1.25) text += ' ';
      text += item.text;
      previousEnd = item.x + item.width;
    });
    const next = lines[index + 1];
    const blankLine = next && line.y - next.y > Math.max(line.fontSize, next.fontSize) * 1.65;
    return `${text.trim()}${blankLine ? '\n' : ''}`;
  }).join('\n');
}

async function parseDocumentFile(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('PDF parser did not load. Check your connection and try again.');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const chunks = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      chunks.push(extractPdfPageText(content.items));
    }
    const originalText = chunks.join('\n\n').trim();
    return { originalText, extractedText: normalizeExtractedText(originalText) };
  }
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
    const originalText = await file.text();
    return { originalText, extractedText: normalizeExtractedText(originalText) };
  }
  throw new Error('Only PDF and TXT files are supported in v1.');
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [, 'application/octet-stream'])[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function addDocument() {
  const file = $('doc-file').files[0];
  if (!file) return setStatus('doc-status', 'Choose a PDF or TXT file first.');
  setStatus('doc-status', 'Extracting text...');
  try {
    const { originalText, extractedText } = await parseDocumentFile(file);
    if (!extractedText) throw new Error('No readable text was found.');
    const now = Date.now();
    const title = $('doc-title').value.trim() || file.name.replace(/\.[^.]+$/, '');
    const doc = {
      id: uid(),
      title,
      course: $('doc-course').value.trim(),
      unit: $('doc-unit').value.trim(),
      favorite: $('doc-favorite').value === 'yes',
      fileName: file.name,
      fileType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
      fileSize: file.size,
      fileData: await blobToDataUrl(file),
      originalExtractedText: originalText,
      extractedText,
      uploadedAt: now,
      lastOpened: null,
      readingProgress: 0
    };
    documents.push(doc);
    $('doc-file').value = '';
    $('doc-title').value = '';
    $('document-metadata').classList.add('hidden');
    $('upload-dropzone').classList.remove('has-file');
    $('upload-file-name').textContent = '';
    $('upload-file-name').classList.add('hidden');
    showOriginalDocumentText = false;
    setStatus('doc-status', 'Document saved.');
    await idbSet('documents', documents);
    renderEverything();
    previewDocument(doc.id);
  } catch (err) {
    setStatus('doc-status', err.message || 'Could not upload document.');
  }
}

function filteredDocuments() {
  const q = $('doc-search').value.trim().toLowerCase();
  const filter = $('doc-filter').value;
  let list = documents.filter(doc => {
    const hay = `${doc.title} ${doc.course} ${doc.unit} ${doc.fileName}`.toLowerCase();
    return (!q || hay.includes(q)) && (filter !== 'favorites' || doc.favorite);
  });
  const sort = $('doc-sort').value;
  list.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'course') return `${a.course}${a.unit}${a.title}`.localeCompare(`${b.course}${b.unit}${b.title}`);
    return (b.lastOpened || b.uploadedAt) - (a.lastOpened || a.uploadedAt);
  });
  return list;
}

function renderDocuments() {
  const list = $('doc-list');
  const empty = $('docs-empty');
  const docs = filteredDocuments();
  if (docs.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); }
  else {
    empty.classList.add('hidden');
    list.innerHTML = docs.map(doc => `
      <article class="document-card">
        <div class="document-card-main">
          <div class="document-file-icon" aria-hidden="true">${doc.fileType === 'application/pdf' ? 'PDF' : 'TXT'}</div>
          <div class="document-card-copy">
          <h4>${escapeHtml(doc.title)}</h4>
          <p>${escapeHtml(doc.fileName)} - ${formatBytes(doc.fileSize)}</p>
          <div class="meta-line">
            <span class="pill">${escapeHtml(doc.course || 'General')}</span>
            <span class="pill">${escapeHtml(doc.unit || 'General')}</span>
            ${doc.favorite ? '<span class="pill good">favorite</span>' : ''}
            <span class="pill">${new Date(doc.uploadedAt).toLocaleDateString()}</span>
          </div>
          <div class="document-progress-label"><span>Reading progress</span><strong>${doc.readingProgress || 0}%</strong></div>
          <div class="progress-line" role="progressbar" aria-valuenow="${doc.readingProgress || 0}" aria-valuemin="0" aria-valuemax="100"><span style="width:${doc.readingProgress || 0}%"></span></div>
          </div>
        </div>
        <div class="row document-card-actions">
          <button class="btn btn-sm" data-preview-doc="${doc.id}">Preview</button>
          <button class="btn btn-sm" data-open-raw="${doc.id}">File</button>
          <button class="icon-btn btn-danger" data-delete-doc="${doc.id}" title="Delete" aria-label="Delete document">x</button>
        </div>
      </article>
    `).join('');
  }
  list.querySelectorAll('[data-preview-doc]').forEach(btn => btn.addEventListener('click', () => previewDocument(btn.dataset.previewDoc)));
  list.querySelectorAll('[data-open-raw]').forEach(btn => btn.addEventListener('click', () => openRawDocument(btn.dataset.openRaw)));
  list.querySelectorAll('[data-delete-doc]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this document from this browser?')) return;
    documents = documents.filter(doc => doc.id !== btn.dataset.deleteDoc);
    if (currentPreviewDocId === btn.dataset.deleteDoc) currentPreviewDocId = null;
    idbSet('documents', documents);
    renderEverything();
  }));
  renderDocumentSelects();
}

function renderDocumentSelects() {
  const options = documents.length
    ? documents.map(doc => `<option value="${doc.id}">${escapeHtml(doc.title)}</option>`).join('')
    : '<option value="">No documents</option>';
  ['active-doc-select', 'flashcard-doc-select', 'quiz-doc-select', 'notes-doc-select'].forEach(id => {
    const previous = $(id).value;
    $(id).innerHTML = options;
    if (documents.some(doc => doc.id === previous)) $(id).value = previous;
  });
}

function previewDocument(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc) return;
  currentPreviewDocId = id;
  doc.lastOpened = Date.now();
  $('active-doc-select').value = id;
  const originalText = doc.originalExtractedText || doc.extractedText;
  const hasOriginal = originalText !== doc.extractedText;
  if (!hasOriginal) showOriginalDocumentText = false;
  $('original-text-toggle').disabled = !hasOriginal;
  $('original-text-toggle').setAttribute('aria-pressed', String(showOriginalDocumentText));
  $('original-text-toggle').textContent = showOriginalDocumentText ? 'View cleaned text' : 'View original text';
  $('doc-preview').textContent = (showOriginalDocumentText ? originalText : doc.extractedText).slice(0, 12000) || 'No extracted text available.';
  $('doc-progress').value = doc.readingProgress || 0;
  idbSet('documents', documents);
  renderDocuments();
}

function openRawDocument(id) {
  const doc = documents.find(d => d.id === id);
  if (!doc || !doc.fileData) return;
  doc.lastOpened = Date.now();
  const url = URL.createObjectURL(dataUrlToBlob(doc.fileData));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  idbSet('documents', documents);
  renderDocuments();
}

function renderTaxonomy() {
  const courses = [...new Set([
    ...documents.map(d => d.course),
    ...cards.map(c => c.subject),
    ...notes.map(n => n.tag),
    ...timerSessions.map(s => s.course),
    ...classes.map(item => item.name)
  ].filter(Boolean))].sort();
  const units = [...new Set([
    ...documents.map(d => d.unit),
    ...cards.map(c => c.unit),
    ...notes.map(n => n.unit),
    ...timerSessions.map(s => s.unit)
  ].filter(Boolean))].sort();
  $('course-list').innerHTML = courses.map(c => `<option value="${escapeHtml(c)}">`).join('');
  $('subject-list').innerHTML = courses.map(c => `<option value="${escapeHtml(c)}">`).join('');
  $('unit-list').innerHTML = units.map(u => `<option value="${escapeHtml(u)}">`).join('');
  const courseOptions = ['<option value="">General course</option>', ...courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)].join('');
  const unitOptions = ['<option value="">General unit</option>', ...units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`)].join('');
  const prevCourse = $('timer-course').value;
  const prevUnit = $('timer-unit').value;
  $('timer-course').innerHTML = courseOptions;
  $('timer-unit').innerHTML = unitOptions;
  if (courses.includes(prevCourse)) $('timer-course').value = prevCourse;
  if (units.includes(prevUnit)) $('timer-unit').value = prevUnit;
}

function addMsg(role, text) {
  const empty = $('chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  $('chat-log').appendChild(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return div;
}
async function sendChat() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  $('chat-send').disabled = true;
  addMsg('user', q);
  chatHistory.push({ role: 'user', content: q });
  renderTutorOverview();
  const loadingEl = addMsg('assistant loading', 'Thinking...');
  try {
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: q, history: chatHistory.slice(0, -1) })
    });
    if (!res.ok) throw new Error(await apiErrorMessage(res, 'The AI request failed'));
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('The server returned an invalid response. Please try again.');
    }
    if (data?.error) throw new Error(data.error);
    if (typeof data?.reply !== 'string' || !data.reply.trim()) {
      throw new Error('The AI did not return a response. Please try again.');
    }
    const textBlock = data.reply;
    loadingEl.remove();
    addMsg('assistant', textBlock);
    chatHistory.push({ role: 'assistant', content: textBlock });
    if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
    renderTutorOverview();
  } catch (err) {
    loadingEl.remove();
    addMsg('assistant', err.message || 'Could not reach the tutor. Check the backend server and try again.');
    chatHistory.pop();
  } finally {
    $('chat-send').disabled = false;
  }
}

function cardLabel(card) {
  if (card.format === 'definition') return 'Definition';
  if (card.format === 'fill_blank') return 'Fill blank';
  return 'Basic';
}
function renderDeckBar() {
  const subs = [...new Set(cards.map(c => c.subject || 'General'))].sort();
  const bar = $('deck-bar');
  if (subs.length === 0) { bar.innerHTML = ''; return; }
  let html = `<button class="deck-chip ${activeSubject === 'all' ? 'active' : ''}" data-subj="all">All (${cards.length})</button>`;
  subs.forEach(s => {
    const count = cards.filter(c => (c.subject || 'General') === s).length;
    html += `<button class="deck-chip ${activeSubject === s ? 'active' : ''}" data-subj="${escapeHtml(s)}">${escapeHtml(s)} (${count})</button>`;
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.deck-chip').forEach(btn => btn.addEventListener('click', () => {
    activeSubject = btn.dataset.subj;
    renderDeckBar();
    renderCardList();
  }));
}
function filteredCards() {
  const unit = $('card-unit-filter').value;
  const mastery = $('card-mastery-filter').value;
  return cards.filter(card =>
    (activeSubject === 'all' || (card.subject || 'General') === activeSubject)
    && (unit === 'all' || (card.unit || 'General') === unit)
    && (mastery === 'all' || (mastery === 'mastered' ? card.mastered : !card.mastered))
  );
}

function renderCardFilters() {
  const units = [...new Set(cards.map(card => card.unit || 'General'))].sort();
  const select = $('card-unit-filter');
  const previous = select.value || 'all';
  select.innerHTML = `<option value="all">All units</option>${units.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = units.includes(previous) ? previous : 'all';
}
function renderCardList() {
  const list = $('card-list');
  const empty = $('cards-empty');
  const fc = filteredCards();
  if (fc.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = fc.map(c => `
    <article class="card-row">
      <div class="meta-line">
        <span class="pill">${escapeHtml(c.subject || 'General')}</span>
        <span class="pill">${cardLabel(c)}</span>
        ${c.sourceDocumentTitle || documents.find(doc => doc.id === c.sourceDocumentId) ? `<span class="pill source-pill" title="Source document">Source: ${escapeHtml(c.sourceDocumentTitle || documents.find(doc => doc.id === c.sourceDocumentId).title)}</span>` : ''}
        ${c.aiGenerated ? '<span class="pill ai">AI generated</span>' : '<span class="pill">Added by you</span>'}
      </div>
      <button type="button" class="flashcard-face" data-flip-card="${c.id}" aria-pressed="false" aria-label="Reveal answer">
        <span class="face-label">QUESTION</span>
        <span class="face-content">${escapeHtml(c.front)}</span>
        <span class="face-hint">Click to reveal answer</span>
      </button>
      <details class="flashcard-details">
        <summary>Card details</summary>
        <div class="meta-line">
          <span class="pill">${escapeHtml(c.unit || 'General')}</span>
        </div>
      </details>
      <div class="card-actions">
        <span class="mastery-label"><i class="mastery-dot ${c.mastered ? 'mastered' : ''}"></i>${c.mastered ? 'Mastered' : 'Still learning'}</span>
        <button class="icon-btn" data-edit-card="${c.id}" title="Edit" aria-label="Edit flashcard">edit</button>
        <button class="icon-btn btn-danger" data-del-card="${c.id}" title="Delete" aria-label="Delete card">x</button>
      </div>
    </article>
  `).join('');
  list.querySelectorAll('[data-flip-card]').forEach(button => button.addEventListener('click', () => {
    const card = cards.find(item => item.id === button.dataset.flipCard);
    if (!card) return;
    const flipped = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(flipped));
    button.setAttribute('aria-label', flipped ? 'Show question' : 'Reveal answer');
    button.classList.toggle('flipped', flipped);
    button.querySelector('.face-label').textContent = flipped ? 'ANSWER' : 'QUESTION';
    button.querySelector('.face-content').textContent = flipped ? card.back : card.front;
    button.querySelector('.face-hint').textContent = flipped ? 'Click to return to question' : 'Click to reveal answer';
  }));
  list.querySelectorAll('[data-del-card]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this flashcard?')) return;
    cards = cards.filter(c => c.id !== btn.dataset.delCard);
    idbSet('cards', cards);
    renderEverything();
  }));
  list.querySelectorAll('[data-edit-card]').forEach(btn => btn.addEventListener('click', () => openCardForm(btn.dataset.editCard)));
}
function openCardForm(id = null) {
  const card = cards.find(item => item.id === id);
  editingCardId = card ? card.id : null;
  $('card-dialog-title').textContent = card ? 'Edit flashcard' : 'Add a flashcard';
  $('add-card-btn').textContent = card ? 'Save changes' : 'Save card';
  $('card-front').value = card?.front || '';
  $('card-back').value = card?.back || '';
  $('card-subject').value = card?.subject || '';
  $('card-unit').value = card?.unit || '';
  $('card-format').value = card?.format || 'basic';
  $('card-dialog').showModal();
  $('card-front').focus();
}
function resetCardForm() {
  editingCardId = null;
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
  const card = cards.find(item => item.id === editingCardId);
  if (card) {
    card.front = front;
    card.back = back;
    card.subject = $('card-subject').value.trim();
    card.unit = $('card-unit').value.trim();
    card.format = $('card-format').value;
    card.updatedAt = Date.now();
  } else {
    cards.push({
      id: uid(),
      front,
      back,
      subject: $('card-subject').value.trim(),
      unit: $('card-unit').value.trim(),
      format: $('card-format').value,
      aiGenerated: false,
      mastered: false,
      createdAt: Date.now()
    });
  }
  $('card-dialog').close();
  resetCardForm();
  await idbSet('cards', cards);
  renderEverything();
}
async function generateFlashcardsFromDocument() {
  const doc = documents.find(d => d.id === $('flashcard-doc-select').value);
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
    usable.forEach(card => {
      cards.push({
        id: uid(),
        front: card.front,
        back: card.back,
        subject: doc.course,
        unit: doc.unit,
        format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
        aiGenerated: true,
        sourceDocumentId: doc.id,
        sourceDocumentTitle: doc.title,
        mastered: false,
        createdAt: Date.now()
      });
    });
    await idbSet('cards', cards);
    const skipped = incoming.length - usable.length;
    setStatus('cards-ai-status', `Added ${usable.length} cards${skipped ? `; skipped ${skipped} incomplete or duplicate ${skipped === 1 ? 'card' : 'cards'}` : ''}.`);
    renderEverything();
  } catch (err) {
    setStatus('cards-ai-status', err.message || 'Could not generate cards.');
  } finally {
    $('generate-cards-btn').disabled = false;
  }
}

function startCardStudy() {
  studyDeck = shuffle([...filteredCards()]);
  if (studyDeck.length === 0) return;
  studyIndex = 0;
  $('cards-study').classList.remove('hidden');
  renderStudyCard();
}
function renderStudyCard() {
  if (studyIndex >= studyDeck.length) {
    $('card-study-progress').textContent = 'Session complete.';
    $('flip-card').textContent = 'Nice work. The deck is cleared for now.';
    $('flip-card').classList.remove('flipped');
    return;
  }
  studyFlipped = false;
  $('card-study-progress').textContent = `Card ${studyIndex + 1} of ${studyDeck.length}`;
  $('flip-card').classList.remove('flipped');
  $('flip-card').textContent = studyDeck[studyIndex].front;
}
function markStudyCard(mastered) {
  if (studyIndex >= studyDeck.length) return;
  const card = cards.find(c => c.id === studyDeck[studyIndex].id);
  if (card) card.mastered = mastered;
  studyIndex++;
  idbSet('cards', cards);
  renderStudyCard();
  renderProgress();
}
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function renderNotes() {
  const grid = $('note-grid');
  const empty = $('notes-empty');
  const q = $('notes-search').value.trim().toLowerCase();
  const filtered = notes.filter(n => {
    const hay = `${n.title} ${n.body} ${n.tag} ${n.unit}`.toLowerCase();
    return !q || hay.includes(q);
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  if (filtered.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = filtered.map(n => `
    <article class="note-card">
      <div class="meta-line">
        <span class="pill">${escapeHtml(n.tag || 'General')}</span>
        <span class="pill">${escapeHtml(n.unit || 'General')}</span>
        ${n.sourceDocumentTitle || documents.find(doc => doc.id === n.sourceDocumentId) ? `<span class="pill source-pill" title="Source document">Source: ${escapeHtml(n.sourceDocumentTitle || documents.find(doc => doc.id === n.sourceDocumentId).title)}</span>` : ''}
        ${n.aiGenerated ? '<span class="pill ai">AI generated</span>' : ''}
      </div>
      <h4>${escapeHtml(n.title || 'Untitled')}</h4>
    <div class="body markdown-body">${renderMarkdown(n.body)}</div>
      <div class="note-meta">
      <span class="hint">Edited ${new Date(n.updatedAt || n.createdAt).toLocaleDateString()}</span>
        <span>
          <button class="icon-btn" data-edit-note="${n.id}" title="Edit" aria-label="Edit note">edit</button>
          <button class="icon-btn btn-danger" data-del-note="${n.id}" title="Delete" aria-label="Delete note">x</button>
        </span>
      </div>
    </article>
  `).join('');
  grid.querySelectorAll('[data-edit-note]').forEach(btn => btn.addEventListener('click', () => openNoteForm(btn.dataset.editNote)));
  grid.querySelectorAll('[data-del-note]').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('Delete this note?')) return;
    notes = notes.filter(n => n.id !== btn.dataset.delNote);
    idbSet('notes', notes);
    renderNotes();
  }));
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let codeLines = [];
  let inCode = false;
  const inline = value => escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>');
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length) blocks.push(`<ul>${listItems.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  lines.forEach(line => {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*(?:[-*+]|\u2022)\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  });
  if (inCode) blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  flushParagraph();
  flushList();
  return blocks.join('');
}

function renderNotePreview() {
  const title = $('note-title').value.trim();
  const body = $('note-body').value;
  $('note-preview').innerHTML = `${title ? `<h2>${escapeHtml(title)}</h2>` : ''}${renderMarkdown(body) || '<p class="hint">Your formatted note preview will appear here.</p>'}`;
}

function openNoteForm(id) {
  $('note-form').classList.remove('hidden');
  $('note-editor-empty').classList.add('hidden');
  editingNoteId = id || null;
  const n = notes.find(note => note.id === id);
  $('note-title').value = n?.title || '';
  $('note-tag').value = n?.tag || '';
  $('note-unit').value = n?.unit || '';
  $('note-body').value = n?.body || '';
  renderNotePreview();
  $('note-title').focus();
}
function closeNoteForm() {
  $('note-form').classList.add('hidden');
  $('note-editor-empty').classList.remove('hidden');
  editingNoteId = null;
}
function saveNote() {
  const title = $('note-title').value.trim();
  const tag = $('note-tag').value.trim();
  const unit = $('note-unit').value.trim();
  const body = $('note-body').value.trim();
  if (!title && !body) return;
  if (editingNoteId) {
    const n = notes.find(note => note.id === editingNoteId);
    if (n) { n.title = title; n.tag = tag; n.unit = unit; n.body = body; n.updatedAt = Date.now(); }
  } else {
    notes.push({ id: uid(), title, tag, unit, body, aiGenerated: false, createdAt: Date.now(), updatedAt: Date.now() });
  }
  closeNoteForm();
  idbSet('notes', notes);
  renderEverything();
}
async function generateNotesFromDocument() {
  const doc = documents.find(d => d.id === $('notes-doc-select').value);
  if (!doc) return setStatus('notes-ai-status', 'Upload a document first. (No document selected)');

  setStatus('notes-ai-status', 'Generating notes...');
  $('generate-notes-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-notes', { document: aiDocumentPayload(doc) });
    const bodyParts = [
      typeof data.summary === 'string' && data.summary.trim() ? `## Summary\n${data.summary.trim()}` : '',
      Array.isArray(data.keyConcepts) && data.keyConcepts.some(value => typeof value === 'string' && value.trim())
        ? `## Key concepts\n${data.keyConcepts.filter(value => typeof value === 'string' && value.trim()).map(value => `- ${value.trim()}`).join('\n')}`
        : '',
      typeof data.body === 'string' && data.body.trim() ? `## Detailed notes\n${data.body.trim()}` : ''
    ].filter(Boolean);
    if (!bodyParts.length) throw new Error('The AI returned an empty note. Try again with a document that has more study content.');
    notes.push({
      id: uid(),
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : `${doc.title} notes`,
      tag: doc.course,
      unit: doc.unit,
      body: bodyParts.join('\n\n'),
      aiGenerated: true,
      sourceDocumentId: doc.id,
      sourceDocumentTitle: doc.title,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    await idbSet('notes', notes);
    setStatus('notes-ai-status', 'AI note added.');
    renderEverything();
  } catch (err) {
    setStatus('notes-ai-status', err.message || 'Could not generate notes.');
  } finally {
    $('generate-notes-btn').disabled = false;
  }
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

async function generateQuiz() {
  const doc = documents.find(d => d.id === $('quiz-doc-select').value);
  if (!doc) return setStatus('quiz-status', 'Upload a document first. (No document selected)');

  setStatus('quiz-status', 'Generating quiz...');
  $('generate-quiz-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-quiz', { document: aiDocumentPayload(doc) });
    const questions = normalizeGeneratedQuestions(data.questions);
    renderQuiz(doc, questions);
    setStatus('quiz-status', questions.length
      ? `Ready: ${questions.length} questions from ${doc.title}.`
      : 'The AI returned no complete, auto-gradable questions. Try again with a document that has more study content.');
  } catch (err) {
    setStatus('quiz-status', err.message || 'Could not generate quiz.');
  } finally {
    $('generate-quiz-btn').disabled = false;
  }
}
function normalizeGeneratedQuestions(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.reduce((questions, item) => {
    if (!item || typeof item !== 'object') return questions;
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const correctAnswer = typeof (item.correctAnswer || item.answer) === 'string'
      ? String(item.correctAnswer || item.answer).trim()
      : '';
    const type = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'].includes(item.type)
      ? item.type
      : 'short_answer';
    const rawOptions = Array.isArray(item.options)
      ? [...new Set(item.options.filter(option => typeof option === 'string').map(option => option.trim()).filter(Boolean))]
      : [];
    if (!question || !correctAnswer) return questions;
    if (type === 'multiple_choice' && (rawOptions.length < 2 || !rawOptions.some(option => normalizeAnswer(option) === normalizeAnswer(correctAnswer)))) return questions;
    if (type === 'true_false' && !['true', 'false'].includes(normalizeAnswer(correctAnswer))) return questions;
    const key = normalizeAnswer(question);
    if (seen.has(key)) return questions;
    seen.add(key);
    const options = type === 'multiple_choice' ? rawOptions : (type === 'true_false' ? ['True', 'False'] : []);
    questions.push({
      ...item,
      type,
      question,
      options,
      correctAnswer: type === 'multiple_choice'
        ? options.find(option => normalizeAnswer(option) === normalizeAnswer(correctAnswer))
        : correctAnswer
    });
    return questions;
  }, []);
}
function renderQuiz(doc, questions) {
  if (!questions.length) {
    currentQuiz = null;
    $('quiz-view-toolbar').classList.add('hidden');
    $('quiz-area').replaceChildren();
    $('quiz-empty').textContent = 'The AI returned no complete, auto-gradable questions. Try again with a document that has more study content.';
    $('quiz-empty').classList.remove('hidden');
    return;
  }
  $('quiz-empty').textContent = 'Choose a document and generate a quiz.';
  $('quiz-empty').classList.add('hidden');
  currentQuiz = {
    doc,
    questions,
    answers: Array(questions.length).fill(''),
    index: 0,
    mode: 'one',
    graded: false,
    results: []
  };
  $('quiz-view-toolbar').classList.remove('hidden');
  renderQuizView();
}

function quizQuestionMarkup(question, index) {
  const type = question.type || 'multiple_choice';
  const options = Array.isArray(question.options) ? question.options : (type === 'true_false' ? ['True', 'False'] : []);
  const currentAnswer = currentQuiz.answers[index];
  const input = options.length ? options.map(option => `
    <label class="quiz-option ${currentQuiz.graded && normalizeAnswer(option) === normalizeAnswer(question.correctAnswer || question.answer) ? 'correct' : ''} ${currentQuiz.graded && currentAnswer === option && normalizeAnswer(option) !== normalizeAnswer(question.correctAnswer || question.answer) ? 'wrong' : ''}">
      <input type="radio" name="quiz-${index}" value="${escapeHtml(option)}" ${currentAnswer === option ? 'checked' : ''} ${currentQuiz.graded ? 'disabled' : ''}>
      <span>${escapeHtml(option)}</span>
    </label>
  `).join('') : `<input type="text" data-free-answer="${index}" value="${escapeHtml(currentAnswer)}" placeholder="Your answer" ${currentQuiz.graded ? 'disabled' : ''}>`;
  const result = currentQuiz.graded ? currentQuiz.results[index] : null;
  return `
    <article class="quiz-question" data-q-index="${index}">
      <div class="meta-line"><span class="pill">${escapeHtml(type.replace(/_/g, ' '))}</span><span class="question-count">Question ${index + 1}</span></div>
      <strong>${escapeHtml(question.question)}</strong>
      <div class="quiz-answer-options">${input}</div>
      ${result ? `<div class="quiz-feedback ${result.correct ? 'is-correct' : 'is-wrong'}" role="status"><strong>${result.correct ? 'Correct' : 'Not quite'}</strong>${result.correct ? '' : `<span>Answer: ${escapeHtml(question.correctAnswer || question.answer || 'Not provided')}</span>`}${question.explanation ? `<span>${escapeHtml(question.explanation)}</span>` : ''}</div>` : ''}
    </article>
  `;
}

function collectQuizAnswers() {
  currentQuiz.questions.forEach((question, index) => {
    const checked = document.querySelector(`input[name="quiz-${index}"]:checked`);
    const free = document.querySelector(`[data-free-answer="${index}"]`);
    if (checked) currentQuiz.answers[index] = checked.value;
    else if (free) currentQuiz.answers[index] = free.value.trim();
  });
}

function renderQuizView() {
  if (!currentQuiz) return;
  const { questions, index, mode } = currentQuiz;
  const area = $('quiz-area');
  $('quiz-mode-one').classList.toggle('active', mode === 'one');
  $('quiz-mode-one').setAttribute('aria-pressed', String(mode === 'one'));
  $('quiz-mode-all').classList.toggle('active', mode === 'all');
  $('quiz-mode-all').setAttribute('aria-pressed', String(mode === 'all'));
  if (currentQuiz.graded) {
    renderQuizResults();
    return;
  }
  const content = mode === 'all'
    ? questions.map((question, questionIndex) => quizQuestionMarkup(question, questionIndex)).join('')
    : quizQuestionMarkup(questions[index], index);
  const percent = Math.round(((index + 1) / questions.length) * 100);
  area.innerHTML = `
    <div class="quiz-progress-wrap">
      <div class="quiz-progress-label"><span>${mode === 'all' ? `${questions.length} questions` : `Question ${index + 1} of ${questions.length}`}</span><strong>${percent}%</strong></div>
      <div class="quiz-progress-track"><span style="width:${percent}%"></span></div>
    </div>
    <div class="quiz-question-list">${content}</div>
    <div class="quiz-navigation">
      ${mode === 'one' ? `<button class="btn" id="quiz-previous-btn" ${index === 0 ? 'disabled' : ''}>Previous</button>` : ''}
      <span class="hint">${mode === 'all' ? 'Answer each question, then submit.' : 'Take your time. You can move back and change an answer.'}</span>
      ${mode === 'one' && index < questions.length - 1
        ? '<button class="btn btn-primary" id="quiz-next-btn">Next question</button>'
        : '<button class="btn btn-primary" id="grade-quiz-btn">Submit quiz</button>'}
    </div>
  `;
  area.querySelectorAll('input').forEach(input => input.addEventListener('change', collectQuizAnswers));
  area.querySelectorAll('input[type="text"]').forEach(input => input.addEventListener('input', collectQuizAnswers));
  $('quiz-previous-btn')?.addEventListener('click', () => { collectQuizAnswers(); currentQuiz.index--; renderQuizView(); });
  $('quiz-next-btn')?.addEventListener('click', () => { collectQuizAnswers(); currentQuiz.index++; renderQuizView(); });
  $('grade-quiz-btn')?.addEventListener('click', () => { collectQuizAnswers(); gradeQuiz(); });
}

function gradeQuiz() {
  const { doc, questions, answers } = currentQuiz;
  currentQuiz.results = questions.map((question, index) => {
    const answer = answers[index];
    return {
      question: question.question,
      answer,
      correct: normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer || question.answer),
      topic: question.topic || question.question
    };
  });
  const correct = currentQuiz.results.filter(result => result.correct).length;
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  currentQuiz.graded = true;
  quizResults.push({ id: uid(), documentId: doc.id, course: doc.course, unit: doc.unit, score, correct, total: questions.length, takenAt: Date.now() });
  idbSet('quizResults', quizResults);
  setStatus('quiz-status', `Score: ${correct}/${questions.length} (${score}%).`);
  renderProgress();
  renderQuizView();
}

function renderQuizResults() {
  const correct = currentQuiz.results.filter(result => result.correct).length;
  const weakTopics = currentQuiz.results.filter(result => !result.correct);
  $('quiz-area').innerHTML = `
    <section class="quiz-results">
      <span class="results-kicker">QUIZ COMPLETE</span>
      <div class="results-score">${correct}<span>/${currentQuiz.questions.length}</span></div>
      <h2>${Math.round((correct / currentQuiz.questions.length) * 100)}% correct</h2>
      <p>${weakTopics.length ? 'Here are a few topics worth another look.' : 'Excellent work. You got every question right.'}</p>
      ${weakTopics.length ? `<div class="weak-topics"><strong>Topics to review</strong><ul>${weakTopics.map(result => `<li>${escapeHtml(result.topic)}</li>`).join('')}</ul></div>` : ''}
      <div class="row quiz-result-actions">
        ${weakTopics.length ? '<button class="btn btn-primary" id="mistakes-to-cards-btn">Make flashcards from mistakes</button>' : ''}
        <button class="btn" id="retake-quiz-btn">Retake quiz</button>
      </div>
    </section>
  `;
  $('mistakes-to-cards-btn')?.addEventListener('click', makeFlashcardsFromMistakes);
  $('retake-quiz-btn').addEventListener('click', () => {
    currentQuiz.answers = Array(currentQuiz.questions.length).fill('');
    currentQuiz.index = 0;
    currentQuiz.graded = false;
    currentQuiz.results = [];
    renderQuizView();
  });
}

async function makeFlashcardsFromMistakes() {
  if (currentQuiz.madeFlashcards) return;
  const mistakes = currentQuiz.results.filter(result => !result.correct);
  mistakes.forEach(result => cards.push({
    id: uid(),
    front: result.question,
    back: result.answer ? `Your answer: ${result.answer}\nCorrect answer: ${currentQuiz.questions.find(question => question.question === result.question)?.correctAnswer || ''}` : `Correct answer: ${currentQuiz.questions.find(question => question.question === result.question)?.correctAnswer || 'Review this topic.'}`,
    subject: currentQuiz.doc.course || '',
    unit: currentQuiz.doc.unit || '',
    format: 'basic',
    aiGenerated: false,
    mastered: false,
    createdAt: Date.now()
  }));
  currentQuiz.madeFlashcards = true;
  await idbSet('cards', cards);
  setStatus('quiz-status', `Added ${mistakes.length} flashcards from your mistakes.`);
  renderEverything();
  $('mistakes-to-cards-btn').disabled = true;
  $('mistakes-to-cards-btn').textContent = 'Flashcards added';
}

const RING_CIRC = 2 * Math.PI * 98;
$('ring-progress').setAttribute('stroke-dasharray', RING_CIRC.toFixed(2));
let timer = { mode: 'work', remaining: 25 * 60, total: 25 * 60, running: false, cyclesDone: 0, intervalId: null };
function getDurations() {
  return {
    work: Math.max(1, parseInt($('work-min').value) || 25) * 60,
    brk: Math.max(1, parseInt($('break-min').value) || 5) * 60,
    long: Math.max(1, parseInt($('long-min').value) || 15) * 60
  };
}
function renderTimer() {
  const m = Math.floor(timer.remaining / 60).toString().padStart(2, '0');
  const s = Math.floor(timer.remaining % 60).toString().padStart(2, '0');
  $('ring-time').textContent = `${m}:${s}`;
  $('ring-mode').textContent = timer.mode === 'work' ? 'Work session' : (timer.mode === 'long' ? 'Long break' : 'Short break');
  $('ring-progress').setAttribute('stroke-dashoffset', (RING_CIRC * (1 - timer.remaining / timer.total)).toFixed(2));
  $('ring-progress').style.stroke = timer.mode === 'work' ? 'var(--pen-green)' : 'var(--pen-blue)';
  $('timer-start-btn').textContent = timer.running ? 'Pause' : 'Start';
  const today = new Date();
  $('timer-session-count').textContent = timerSessions.filter(session => {
    const completed = new Date(session.completedAt);
    return completed.getFullYear() === today.getFullYear()
      && completed.getMonth() === today.getMonth()
      && completed.getDate() === today.getDate();
  }).length;
}
function logWorkSession(seconds) {
  timerSessions.push({
    id: uid(),
    course: $('timer-course').value,
    unit: $('timer-unit').value,
    seconds,
    completedAt: Date.now()
  });
  idbSet('timerSessions', timerSessions);
  renderTimer();
  renderProgress();
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) { }
}
function timerTick() {
  timer.remaining--;
  if (timer.remaining <= 0) {
    if ($('timer-sound-enabled').checked) beep();
    if ($('timer-notification-enabled').checked && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('StudyBuddy timer', { body: timer.mode === 'work' ? 'Focus session complete. Take a short break.' : 'Break complete. Ready to focus again?' });
    }
    const d = getDurations();
    if (timer.mode === 'work') {
      logWorkSession(timer.total);
      timer.cyclesDone++;
      const isLong = timer.cyclesDone % 4 === 0;
      timer.mode = isLong ? 'long' : 'break';
      timer.total = isLong ? d.long : d.brk;
    } else {
      timer.mode = 'work';
      timer.total = d.work;
    }
    timer.remaining = timer.total;
  }
  renderTimer();
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function showChartEmpty(container, message) {
  container.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'chart-empty';
  empty.textContent = message;
  container.appendChild(empty);
}

function renderStudyTimeChart() {
  const container = $('study-time-chart');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const seconds = timerSessions.reduce((total, session) => {
      const completed = new Date(session.completedAt);
      return completed.toDateString() === date.toDateString() ? total + (session.seconds || 0) : total;
    }, 0);
    return { date, seconds };
  });
  if (!days.some(day => day.seconds > 0)) {
    showChartEmpty(container, 'Complete a focus session to see your weekly study time.');
    return;
  }
  const svg = createSvgElement('svg', { viewBox: '0 0 420 180', role: 'presentation', class: 'chart-svg' });
  const maxMinutes = Math.max(30, Math.ceil(Math.max(...days.map(day => day.seconds / 60)) / 30) * 30);
  days.forEach((day, index) => {
    const x = 26 + index * 56;
    const barHeight = (day.seconds / 60 / maxMinutes) * 112;
    const bar = createSvgElement('rect', {
      x,
      y: 132 - barHeight,
      width: 30,
      height: Math.max(barHeight, 2),
      rx: 8,
      class: 'chart-bar'
    });
    bar.setAttribute('aria-label', `${day.date.toLocaleDateString(undefined, { weekday: 'long' })}: ${Math.round(day.seconds / 60)} minutes`);
    svg.appendChild(bar);
    const label = createSvgElement('text', { x: x + 15, y: 157, 'text-anchor': 'middle', class: 'chart-axis-label' });
    label.textContent = day.date.toLocaleDateString(undefined, { weekday: 'short' });
    svg.appendChild(label);
  });
  container.replaceChildren(svg);
}

function renderQuizAccuracyChart() {
  const container = $('quiz-accuracy-chart');
  const attempts = quizResults.slice().sort((a, b) => a.takenAt - b.takenAt).slice(-8);
  if (!attempts.length) {
    showChartEmpty(container, 'Take a quiz to start your accuracy trend.');
    return;
  }
  const svg = createSvgElement('svg', { viewBox: '0 0 420 180', role: 'presentation', class: 'chart-svg' });
  const points = attempts.map((attempt, index) => {
    const x = attempts.length === 1 ? 210 : 30 + index * (360 / (attempts.length - 1));
    const y = 132 - (Math.max(0, Math.min(100, attempt.score)) / 100) * 108;
    const point = createSvgElement('circle', { cx: x, cy: y, r: 5, class: 'chart-point' });
    svg.appendChild(point);
    const label = createSvgElement('text', { x, y: 157, 'text-anchor': 'middle', class: 'chart-axis-label' });
    label.textContent = new Date(attempt.takenAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    svg.appendChild(label);
    return `${x},${y}`;
  });
  svg.insertBefore(createSvgElement('polyline', { points: points.join(' '), class: 'chart-line' }), svg.firstChild);
  container.replaceChildren(svg);
}

function renderFlashcardMasteryChart() {
  const container = $('flashcard-mastery-chart');
  if (!cards.length) {
    showChartEmpty(container, 'Add flashcards to track your mastery.');
    return;
  }
  const mastered = cards.filter(card => card.mastered).length;
  const percent = Math.round((mastered / cards.length) * 100);
  const circumference = 2 * Math.PI * 48;
  const svg = createSvgElement('svg', { viewBox: '0 0 180 140', role: 'presentation', class: 'chart-svg mastery-donut' });
  svg.appendChild(createSvgElement('circle', { cx: 90, cy: 68, r: 48, class: 'donut-track' }));
  svg.appendChild(createSvgElement('circle', {
    cx: 90,
    cy: 68,
    r: 48,
    class: 'donut-progress',
    'stroke-dasharray': `${circumference * percent / 100} ${circumference}`,
    transform: 'rotate(-90 90 68)'
  }));
  const label = createSvgElement('text', { x: 90, y: 72, 'text-anchor': 'middle', class: 'donut-label' });
  label.textContent = `${percent}%`;
  svg.appendChild(label);
  const legend = createSvgElement('text', { x: 90, y: 134, 'text-anchor': 'middle', class: 'chart-axis-label' });
  legend.textContent = `${mastered} of ${cards.length} mastered`;
  svg.appendChild(legend);
  container.replaceChildren(svg);
}

function renderProgress() {
  const totalSeconds = timerSessions.reduce((sum, s) => sum + (s.seconds || 0), 0);
  const completedDocs = documents.filter(d => (d.readingProgress || 0) >= 100).length;
  const quizAvg = quizResults.length ? Math.round(quizResults.reduce((sum, r) => sum + r.score, 0) / quizResults.length) : 0;
  const mastery = cards.length ? Math.round((cards.filter(c => c.mastered).length / cards.length) * 100) : 0;
  $('stat-hours').textContent = `${(totalSeconds / 3600).toFixed(totalSeconds >= 36000 ? 0 : 1)}h`;
  $('stat-docs').textContent = completedDocs;
  $('stat-quiz').textContent = `${quizAvg}%`;
  $('stat-cards').textContent = `${mastery}%`;
  renderStudyTimeChart();
  renderQuizAccuracyChart();
  renderFlashcardMasteryChart();
  const groups = new Map();
  documents.forEach(d => {
    const key = d.course || 'General';
    if (!groups.has(key)) groups.set(key, { course: key, docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).docs.push(d);
  });
  cards.forEach(c => {
    const key = c.subject || 'General';
    if (!groups.has(key)) groups.set(key, { course: key, docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).cards.push(c);
  });
  quizResults.forEach(q => {
    const key = q.course || 'General';
    if (!groups.has(key)) groups.set(key, { course: key, docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).quizzes.push(q);
  });
  timerSessions.forEach(s => {
    const key = s.course || 'General';
    if (!groups.has(key)) groups.set(key, { course: key, docs: [], cards: [], quizzes: [], sessions: [] });
    groups.get(key).sessions.push(s);
  });
  $('progress-list').innerHTML = [...groups.values()].map(g => {
    const read = g.docs.length ? Math.round(g.docs.reduce((sum, d) => sum + (d.readingProgress || 0), 0) / g.docs.length) : 0;
    const gMastery = g.cards.length ? Math.round((g.cards.filter(c => c.mastered).length / g.cards.length) * 100) : 0;
    const gQuiz = g.quizzes.length ? Math.round(g.quizzes.reduce((sum, q) => sum + q.score, 0) / g.quizzes.length) : 0;
    const hours = g.sessions.reduce((sum, s) => sum + (s.seconds || 0), 0) / 3600;
    return `<article class="course-progress-card"><div class="course-progress-heading"><h4>${escapeHtml(g.course)}</h4><span>${g.docs.length} documents</span></div><div class="course-progress-metrics"><span><strong>${read}%</strong> reading</span><span><strong>${gMastery}%</strong> card mastery</span><span><strong>${gQuiz}%</strong> quiz average</span><span><strong>${hours.toFixed(1)}h</strong> study time</span></div></article>`;
  }).join('') || '<div class="empty-state">No progress yet.</div>';
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = timerSessions.filter(s => s.completedAt >= weekStart).sort((a, b) => b.completedAt - a.completedAt);
  $('session-list').innerHTML = recent.slice(0, 8).map(s => `
    <div class="list-row"><div><h4>${escapeHtml(s.course || 'General')} - ${escapeHtml(s.unit || 'General')}</h4><p>${Math.round(s.seconds / 60)} minutes on ${new Date(s.completedAt).toLocaleDateString()}</p></div></div>
  `).join('') || '<div class="empty-state">No sessions this week.</div>';
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readJSONFile(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { cb(JSON.parse(reader.result)); }
    catch (e) { alert('Could not read that file. Make sure it is valid JSON.'); }
  };
  reader.readAsText(file);
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)
    || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION
    || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('This is not a supported StudyBuddy backup.');
  }

  const requiredFields = {
    documents: { title: 'string', extractedText: 'string' },
    cards: { front: 'string', back: 'string' },
    notes: { title: 'string', body: 'string' },
    quizResults: { score: 'number', correct: 'number', total: 'number', takenAt: 'number' },
    timerSessions: { seconds: 'number', completedAt: 'number' },
    classes: { name: 'string' },
    assignments: { title: 'string', dueAt: 'number' }
  };

  for (const collection of BACKUP_COLLECTIONS) {
    const records = backup.data[collection];
    if (records === undefined && !REQUIRED_BACKUP_COLLECTIONS.includes(collection)) {
      backup.data[collection] = [];
      continue;
    }
    if (!Array.isArray(records)) throw new Error(`The backup is missing valid ${collection} data.`);
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || typeof record.id !== 'string' || !/^[\w-]{1,100}$/.test(record.id)
        || Object.entries(requiredFields[collection]).some(([field, type]) => typeof record[field] !== type)
        || (collection === 'assignments' && (!Number.isFinite(record.dueAt)
          || !Number.isFinite(new Date(record.dueAt).getTime())
          || (record.reminderAt != null && (!Number.isFinite(record.reminderAt)
            || !Number.isFinite(new Date(record.reminderAt).getTime())))))) {
        throw new Error(`The backup contains an invalid ${collection} record at item ${index + 1}.`);
      }
    });
  }
  return Object.fromEntries(BACKUP_COLLECTIONS.map(collection => [collection, backup.data[collection] || []]));
}

function mergeRecords(existing, imported) {
  const ids = new Set(existing.map(record => record.id));
  const merged = [...existing];
  imported.forEach(record => {
    if (!ids.has(record.id)) {
      ids.add(record.id);
      merged.push(record);
    }
  });
  return merged;
}

async function saveBackupCollections(collections) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    BACKUP_COLLECTIONS.forEach(key => tx.objectStore(STORE).put({ key, value: collections[key] }));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save imported data.'));
    tx.onabort = () => reject(tx.error || new Error('Import was cancelled before it could be saved.'));
  });
}

async function importAllData(file) {
  const backup = validateBackup(JSON.parse(await file.text()));
  const merged = {};
  BACKUP_COLLECTIONS.forEach(key => {
    merged[key] = mergeRecords(
      { documents, cards, notes, quizResults, timerSessions, classes, assignments }[key],
      backup[key]
    );
  });
  await saveBackupCollections(merged);
  documents = merged.documents;
  cards = merged.cards;
  notes = merged.notes;
  quizResults = merged.quizResults;
  timerSessions = merged.timerSessions;
  classes = merged.classes;
  assignments = merged.assignments;
  renderEverything();
  if (!currentPreviewDocId && documents[0]) previewDocument(documents[0].id);
  return BACKUP_COLLECTIONS.reduce((total, key) => total + backup[key].length, 0);
}

function renderTutorOverview() {
  $('tutor-doc-count').textContent = documents.length;
  $('tutor-card-count').textContent = cards.length;
  $('tutor-note-count').textContent = notes.length;
  const recentQuestions = chatHistory.filter(message => message.role === 'user').slice(-3).reverse();
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
  renderNotes();
  renderClasses();
  renderDashboard();
  renderProgress();
  renderTutorOverview();
}

$('upload-doc-btn').addEventListener('click', addDocument);
function updateSelectedUpload(file) {
  const allowed = file && (file.type === 'application/pdf' || file.type === 'text/plain'
    || /\.(pdf|txt)$/i.test(file.name));
  if (!file || !allowed) {
    $('document-metadata').classList.add('hidden');
    $('upload-dropzone').classList.remove('has-file');
    $('upload-file-name').classList.add('hidden');
    $('upload-file-name').textContent = '';
    if (file) setStatus('doc-status', 'Only PDF and TXT files are supported.');
    return;
  }
  $('document-metadata').classList.remove('hidden');
  $('upload-dropzone').classList.add('has-file');
  $('upload-file-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
  $('upload-file-name').classList.remove('hidden');
  setStatus('doc-status', '');
}
$('doc-file').addEventListener('change', event => updateSelectedUpload(event.target.files[0]));
const uploadDropzone = $('upload-dropzone');
['dragenter', 'dragover'].forEach(type => uploadDropzone.addEventListener(type, event => {
  event.preventDefault();
  uploadDropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => uploadDropzone.addEventListener(type, event => {
  event.preventDefault();
  uploadDropzone.classList.remove('dragging');
}));
uploadDropzone.addEventListener('drop', event => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $('doc-file').files = transfer.files;
  updateSelectedUpload(file);
});
['doc-search', 'doc-sort', 'doc-filter'].forEach(id => $(id).addEventListener('input', renderDocuments));
$('active-doc-select').addEventListener('change', e => previewDocument(e.target.value));
$('open-doc-btn').addEventListener('click', () => $('active-doc-select').value && openRawDocument($('active-doc-select').value));
$('original-text-toggle').addEventListener('click', () => {
  const doc = documents.find(item => item.id === currentPreviewDocId);
  if (!doc || (doc.originalExtractedText || doc.extractedText) === doc.extractedText) return;
  showOriginalDocumentText = !showOriginalDocumentText;
  previewDocument(doc.id);
});
$('doc-progress').addEventListener('input', e => {
  const doc = documents.find(d => d.id === currentPreviewDocId);
  if (!doc) return;
  doc.readingProgress = parseInt(e.target.value) || 0;
  idbSet('documents', documents);
  renderProgress();
  renderDocuments();
});
$('chat-send').addEventListener('click', sendChat);
$('access-token-input').value = localStorage.getItem(ACCESS_TOKEN_KEY) || '';
$('save-access-token-btn').addEventListener('click', () => {
  const token = $('access-token-input').value.trim();
  if (!token) {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    setStatus('access-token-status', 'Saved token cleared.');
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  setStatus('access-token-status', 'Access token saved in this browser.');
});
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('open-add-card-btn').addEventListener('click', () => openCardForm());
$('close-card-dialog').addEventListener('click', () => $('card-dialog').close());
$('cancel-card-dialog').addEventListener('click', () => $('card-dialog').close());
$('card-dialog').addEventListener('close', resetCardForm);
$('add-card-btn').addEventListener('click', saveCard);
$('card-unit-filter').addEventListener('change', renderCardList);
$('card-mastery-filter').addEventListener('change', renderCardList);
$('generate-cards-btn').addEventListener('click', generateFlashcardsFromDocument);
$('export-cards-btn').addEventListener('click', () => downloadJSON(cards, 'margin-flashcards.json'));
$('import-cards-btn').addEventListener('click', () => $('import-cards-file').click());
$('import-cards-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
  if (Array.isArray(data)) {
    data.forEach(c => cards.push({ id: uid(), front: c.front || '', back: c.back || '', subject: c.subject || c.course || '', unit: c.unit || '', format: c.format || 'basic', aiGenerated: !!c.aiGenerated, mastered: !!c.mastered, createdAt: Date.now() }));
    idbSet('cards', cards);
    renderEverything();
  }
}));
$('start-card-study-btn').addEventListener('click', startCardStudy);
$('flip-card').addEventListener('click', () => {
  if (studyIndex >= studyDeck.length) return;
  studyFlipped = !studyFlipped;
  $('flip-card').classList.toggle('flipped', studyFlipped);
  $('flip-card').textContent = studyFlipped ? studyDeck[studyIndex].back : studyDeck[studyIndex].front;
});
$('card-got-it-btn').addEventListener('click', () => markStudyCard(true));
$('card-again-btn').addEventListener('click', () => markStudyCard(false));
$('card-study-exit-btn').addEventListener('click', () => $('cards-study').classList.add('hidden'));
$('generate-quiz-btn').addEventListener('click', generateQuiz);
$('quiz-mode-one').addEventListener('click', () => {
  if (!currentQuiz || currentQuiz.graded) return;
  collectQuizAnswers();
  currentQuiz.mode = 'one';
  renderQuizView();
});
$('quiz-mode-all').addEventListener('click', () => {
  if (!currentQuiz || currentQuiz.graded) return;
  collectQuizAnswers();
  currentQuiz.mode = 'all';
  renderQuizView();
});
$('new-note-btn').addEventListener('click', () => openNoteForm(null));
$('cancel-note-btn').addEventListener('click', closeNoteForm);
$('save-note-btn').addEventListener('click', saveNote);
$('notes-search').addEventListener('input', renderNotes);
$('note-title').addEventListener('input', renderNotePreview);
$('note-body').addEventListener('input', renderNotePreview);
$('generate-notes-btn').addEventListener('click', generateNotesFromDocument);
$('export-notes-btn').addEventListener('click', () => downloadJSON(notes, 'margin-notes.json'));
$('import-notes-btn').addEventListener('click', () => $('import-notes-file').click());
$('import-notes-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
  if (Array.isArray(data)) {
    data.forEach(n => notes.push({ id: uid(), title: n.title || '', tag: n.tag || '', unit: n.unit || '', body: n.body || '', aiGenerated: !!n.aiGenerated, createdAt: n.createdAt || Date.now(), updatedAt: n.updatedAt || Date.now() }));
    idbSet('notes', notes);
    renderEverything();
  }
}));
$('export-all-data-btn').addEventListener('click', () => {
  try {
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { documents, cards, notes, quizResults, timerSessions, classes, assignments }
    };
    downloadJSON(backup, 'studybuddy-backup.json');
    setStatus('all-data-status', 'Backup exported. Keep the downloaded file somewhere safe.');
  } catch (error) {
    setStatus('all-data-status', error.message || 'Could not export a backup.');
  }
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
$('add-class-btn').addEventListener('click', () => openClassForm());
$('classes-add-assignment').addEventListener('click', () => openAssignmentForm());
$('calendar-add-assignment').addEventListener('click', () => openAssignmentForm());
$('calendar-prev-week').addEventListener('click', () => {
  calendarWeekOffset--;
  renderCalendar();
});
$('calendar-next-week').addEventListener('click', () => {
  calendarWeekOffset++;
  renderCalendar();
});
$('calendar-this-week').addEventListener('click', () => {
  calendarWeekOffset = 0;
  renderCalendar();
});
$('class-form').addEventListener('submit', event => {
  event.preventDefault();
  saveClass();
});
$('class-dialog').addEventListener('close', resetClassForm);
$('close-class-dialog').addEventListener('click', () => $('class-dialog').close());
$('cancel-class-dialog').addEventListener('click', () => $('class-dialog').close());
$('assignment-form').addEventListener('submit', event => {
  event.preventDefault();
  saveAssignment();
});
$('assignment-due').addEventListener('input', () => $('assignment-reminder').setCustomValidity(''));
$('assignment-reminder').addEventListener('input', () => $('assignment-reminder').setCustomValidity(''));
$('assignment-dialog').addEventListener('close', resetAssignmentForm);
$('close-assignment-dialog').addEventListener('click', () => $('assignment-dialog').close());
$('cancel-assignment-dialog').addEventListener('click', () => $('assignment-dialog').close());
$('calendar-reminders-enabled').checked = localStorage.getItem(REMINDERS_ENABLED_KEY) === 'true'
  && typeof window.Notification !== 'undefined' && Notification.permission === 'granted';
$('calendar-reminders-enabled').addEventListener('change', event => setAssignmentRemindersEnabled(event.target.checked));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkAssignmentReminders();
});
$('timer-start-btn').addEventListener('click', () => {
  timer.running = !timer.running;
  if (timer.running) timer.intervalId = setInterval(timerTick, 1000);
  else clearInterval(timer.intervalId);
  renderTimer();
});
$('timer-sound-enabled').checked = localStorage.getItem('studybuddy-timer-sound') !== 'false';
$('timer-notification-enabled').checked = localStorage.getItem('studybuddy-timer-notification') === 'true'
  && 'Notification' in window && Notification.permission === 'granted';
$('timer-sound-enabled').addEventListener('change', event => {
  localStorage.setItem('studybuddy-timer-sound', String(event.target.checked));
});
$('timer-notification-enabled').addEventListener('change', async event => {
  if (!event.target.checked) {
    localStorage.setItem('studybuddy-timer-notification', 'false');
    setStatus('timer-alert-status', 'Browser notifications are off.');
    return;
  }
  if (!('Notification' in window)) {
    event.target.checked = false;
    setStatus('timer-alert-status', 'This browser does not support notifications.');
    return;
  }
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== 'granted') {
    event.target.checked = false;
    localStorage.setItem('studybuddy-timer-notification', 'false');
    setStatus('timer-alert-status', 'Notification permission was not granted. The timer will still play its sound if enabled.');
    return;
  }
  localStorage.setItem('studybuddy-timer-notification', 'true');
  setStatus('timer-alert-status', 'Browser notifications are enabled for timer alerts.');
});
$('timer-reset-btn').addEventListener('click', () => {
  clearInterval(timer.intervalId);
  const d = getDurations();
  timer = { mode: 'work', remaining: d.work, total: d.work, running: false, cyclesDone: 0, intervalId: null };
  renderTimer();
});
['work-min', 'break-min', 'long-min'].forEach(id => $(id).addEventListener('change', () => {
  if (!timer.running) {
    const d = getDurations();
    timer.total = timer.mode === 'work' ? d.work : (timer.mode === 'long' ? d.long : d.brk);
    timer.remaining = timer.total;
    renderTimer();
  }
}));

async function init() {
  documents = await idbGet('documents') || [];
  cards = await idbGet('cards') || [];
  notes = await idbGet('notes') || [];
  quizResults = await idbGet('quizResults') || [];
  timerSessions = await idbGet('timerSessions') || [];
  classes = await idbGet('classes') || [];
  assignments = await idbGet('assignments') || [];
  renderTimer();
  renderEverything();
  if (documents[0]) previewDocument(documents[0].id);
  syncReminderControls();
  if (reminderIntervalId) clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(checkAssignmentReminders, 30000);
  checkAssignmentReminders();
  $('export-all-data-btn').disabled = false;
  $('import-all-data-btn').disabled = false;
}
init();
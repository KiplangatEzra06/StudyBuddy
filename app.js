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
const TUTOR_MATERIAL_KEY = 'studybuddy-tutor-material';
const NOTE_CLEANUP_KEY = 'studybuddy-note-cleanup-version';
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
let reminderIntervalId = null;
let selectedNoteId = null;
let noteAutosaveTimer = null;
let chatPending = false;
let studyMaterialIndex = new Map();
let calendarMonthOffset = 0;
let classesView = 'classes';
let chatPageIndex = 0;
let historyPageIndex = 0;
let documentPageIndex = 0;
let documentTextPages = [];
const fitPaginations = new Map();
const fitPaginationObservers = new Map();

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

function changeDocumentPage(index) {
  documentPageIndex = Math.max(0, Math.min(Number(index) || 0, documentTextPages.length - 1));
  renderDocumentPage();
}

const $ = id => document.getElementById(id);
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function paginateToFit(container, options = {}) {
  if (!container) return;
  const key = container.id || container;
  const state = fitPaginations.get(key) || { page: 0 };
  fitPaginations.set(key, state);
  let controls = container.nextElementSibling;
  if (!controls?.classList.contains('fit-page-controls')) {
    controls = document.createElement('nav');
    controls.className = 'fit-page-controls';
    controls.setAttribute('aria-label', options.label || 'List pages');
    controls.innerHTML = '<button type="button" class="btn btn-sm" data-fit-prev aria-label="Previous page">Previous</button><span data-fit-status aria-live="polite"></span><button type="button" class="btn btn-sm" data-fit-next aria-label="Next page">Next</button>';
    container.after(controls);
    controls.querySelector('[data-fit-prev]').addEventListener('click', () => {
      state.page = Math.max(0, state.page - 1);
      paginateToFit(container, options);
    });
    controls.querySelector('[data-fit-next]').addEventListener('click', () => {
      state.page++;
      paginateToFit(container, options);
    });
  }
  const items = [...container.children].filter(item => !item.classList.contains('fit-page-controls'));
  const gap = parseFloat(getComputedStyle(container).rowGap) || 8;
  const columns = options.columns || Math.max(1, getComputedStyle(container).gridTemplateColumns.split(/\s+/).filter(Boolean).length);
  const previousVisibility = items.map(item => item.hidden);
  items.forEach(item => { item.hidden = false; });
  const measuredItemHeight = items.reduce((height, item) => Math.max(height, item.getBoundingClientRect().height), 0);
  items.forEach((item, index) => { item.hidden = previousVisibility[index]; });
  const firstItemHeight = Math.max(measuredItemHeight, options.itemHeight || 88);
  const pageHeight = Math.max(0, container.clientHeight - (options.bottomReserve || 0));
  const rowsPerPage = Math.max(1, Math.floor((pageHeight + gap) / (firstItemHeight + gap)));
  const pageSize = Math.max(1, rowsPerPage * columns);
  state.pageSize = pageSize;
  state.itemHeight = options.itemHeight || 88;
  state.label = options.label || 'List pages';
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  state.page = Math.min(state.page, pageCount - 1);
  const start = state.page * pageSize;
  items.forEach((item, index) => {
    const visible = index >= start && index < start + pageSize;
    item.hidden = !visible;
    item.setAttribute('aria-hidden', String(!visible));
  });
  controls.querySelector('[data-fit-status]').textContent = `Page ${state.page + 1} of ${pageCount} · ${items.length} items`;
  controls.querySelector('[data-fit-prev]').disabled = state.page === 0;
  controls.querySelector('[data-fit-next]').disabled = state.page >= pageCount - 1;
  controls.classList.toggle('hidden', items.length <= pageSize);
  if (!fitPaginationObservers.has(key) && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => requestAnimationFrame(() => paginateToFit(container, options)));
    observer.observe(container);
    fitPaginationObservers.set(key, observer);
  }
}

function refreshFitPaginators() {
  document.querySelectorAll('[data-fit-paginate]').forEach(container => paginateToFit(container, {
    label: container.dataset.fitLabel || `${container.getAttribute('aria-label') || 'List'} pages`,
    itemHeight: Number(container.dataset.fitItemHeight) || 88,
    columns: container.dataset.fitColumns ? Number(container.dataset.fitColumns) : undefined
  }));
}

function showFitItem(container, itemSelector) {
  if (!container) return;
  const key = container.id || container;
  const state = fitPaginations.get(key) || { page: 0 };
  fitPaginations.set(key, state);
  const items = [...container.children].filter(item => !item.classList.contains('fit-page-controls'));
  const index = items.findIndex(item => item.matches(itemSelector) || item.querySelector(itemSelector));
  if (index < 0) return;
  state.page = Math.floor(index / (state.pageSize || 1));
  paginateToFit(container, {
    label: container.dataset.fitLabel || state.label || `${container.getAttribute('aria-label') || 'List'} pages`,
    itemHeight: Number(container.dataset.fitItemHeight) || state.itemHeight || 88,
    columns: container.dataset.fitColumns ? Number(container.dataset.fitColumns) : undefined
  });
  const target = items[index].matches('button, a, [tabindex]') ? items[index] : items[index].querySelector('button, a, [tabindex]');
  target?.focus({ preventScroll: true });
}

function releaseFitPaginator(container) {
  if (!container) return;
  const key = container.id || container;
  fitPaginationObservers.get(key)?.disconnect();
  fitPaginationObservers.delete(key);
  fitPaginations.delete(key);
}

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
  document.querySelector('meta[name="theme-color"]').setAttribute('content', selected === 'dark'
    || (selected === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? '#151927'
    : '#f5f6fb');
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
    ? events.slice(0, 3).map(event => `
      <article class="dashboard-list-row">
        <span class="dashboard-event-time">${escapeHtml(event.time)}</span>
        <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail)}</small></div>
      </article>
    `).join('')
    : '<p class="dashboard-empty">Nothing scheduled today. You have room for a focused study session.</p>';

  const upcoming = assignments.filter(assignment => !assignment.completed && Number(assignment.dueAt) < nextWeek.getTime())
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
    .slice(0, 3);
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
  $('topbar-page-title').textContent = PAGE_TITLES[page];
  $('page-layout').classList.toggle('tutor-active', page === 'tutor');
  if (page === 'dashboard') renderDashboard();
  if (page === 'progress') renderProgress();
  if (page === 'tutor') renderTutorOverview();
  if (page === 'calendar') renderCalendar();
  if (page === 'classes') renderClasses();
}

function renderReminderBadge() {
  const count = assignments.filter(assignment => !assignment.completed
    && Number(assignment.dueAt) < Date.now() + 7 * 24 * 60 * 60 * 1000).length;
  $('reminders-count').textContent = count > 9 ? '9+' : String(count);
  $('reminders-count').classList.toggle('hidden', count === 0);
  $('reminders-bell').setAttribute('aria-label', count
    ? `Open calendar reminders, ${count} upcoming ${count === 1 ? 'assignment' : 'assignments'}`
    : 'Open calendar reminders');
}

$('reminders-bell').addEventListener('click', () => activatePage('calendar'));
$('tutor-use-material').checked = localStorage.getItem(TUTOR_MATERIAL_KEY) !== 'false';
$('settings-tutor-material').checked = $('tutor-use-material').checked;
$('tutor-use-material').addEventListener('change', event => {
  localStorage.setItem(TUTOR_MATERIAL_KEY, String(event.target.checked));
  $('settings-tutor-material').checked = event.target.checked;
});
$('settings-tutor-material').addEventListener('change', event => {
  localStorage.setItem(TUTOR_MATERIAL_KEY, String(event.target.checked));
  $('tutor-use-material').checked = event.target.checked;
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
  const query = container.id === 'classes-assignment-list' ? $('classes-search').value.trim().toLocaleLowerCase() : '';
  const ordered = [...assignments]
    .filter(assignment => !query || `${assignment.title} ${assignment.details} ${classForAssignment(assignment)?.name || ''}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  container.innerHTML = ordered.length
    ? ordered.map(assignmentMarkup).join('')
    : (emptyMessage ? `<div class="empty-state">${escapeHtml(emptyMessage)}</div>` : '');
  bindAssignmentActions(container);
  paginateToFit(container, { label: 'Assignment pages', itemHeight: 100 });
  return ordered.length;
}

function renderClasses() {
  const list = $('class-list');
  const empty = $('classes-empty');
  const query = $('classes-search').value.trim().toLocaleLowerCase();
  const filteredClasses = classes.filter(item => `${item.name} ${item.instructor || ''} ${item.location || ''}`
    .toLocaleLowerCase().includes(query));
  $('panel-classes').classList.toggle('show-assignments', classesView === 'assignments');
  $('classes-view-classes').setAttribute('aria-pressed', String(classesView === 'classes'));
  $('classes-view-assignments').setAttribute('aria-pressed', String(classesView === 'assignments'));
  $('classes-view-classes').classList.toggle('active', classesView === 'classes');
  $('classes-view-assignments').classList.toggle('active', classesView === 'assignments');
  if (!filteredClasses.length) {
    list.replaceChildren();
    empty.classList.toggle('hidden', classes.length > 0 && query.length === 0);
    if (classes.length > 0 && query) empty.textContent = 'No classes match this filter.';
  } else {
    empty.classList.add('hidden');
    list.innerHTML = [...filteredClasses].sort((a, b) => a.name.localeCompare(b.name)).map(item => {
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
  paginateToFit(list, { label: 'Class pages', itemHeight: 116 });
  const assignmentCount = renderAssignmentList($('classes-assignment-list'), '');
  $('assignments-empty').classList.toggle('hidden', assignmentCount > 0);
  renderCalendar();
}

function renderCalendar() {
  const week = $('calendar-week');
  if (!week) return;
  const selectedMonth = new Date();
  selectedMonth.setDate(1);
  selectedMonth.setMonth(selectedMonth.getMonth() + calendarMonthOffset);
  const monthStart = new Date(selectedMonth);
  monthStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  $('calendar-range').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selectedMonth);
  week.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthStart);
    date.setDate(monthStart.getDate() + index);
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
    const visibleEventLimit = window.innerHeight >= 900 ? 2 : 1;
    const showDayButton = events.length > visibleEventLimit || window.innerWidth <= 768;
    const todayClass = dateKey === localDateKey(new Date()) ? 'is-today' : '';
    const outsideMonth = date.getMonth() !== selectedMonth.getMonth();
    return `
      <section class="calendar-day ${todayClass} ${outsideMonth ? 'outside-month' : ''}">
        <header><span>${escapeHtml(WEEKDAY_NAMES[date.getDay()].slice(0, 3))}</span><strong>${date.getDate()}</strong></header>
        <div class="calendar-day-events">${events.slice(0, visibleEventLimit).map(event => event.html).join('') || '<span class="calendar-no-events">No events</span>'}${showDayButton ? `<button type="button" class="calendar-more-events" data-calendar-more="${dateKey}">${events.length > visibleEventLimit ? `+${events.length - visibleEventLimit} more` : `View ${events.length} ${events.length === 1 ? 'event' : 'events'}`}</button>` : ''}</div>
      </section>
    `;
  }).join('');
  week.querySelectorAll('[data-edit-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm(button.dataset.editAssignment)));
  week.querySelectorAll('[data-calendar-more]').forEach(button => button.addEventListener('click', () => openCalendarDay(button.dataset.calendarMore)));
  const upcoming = assignments.filter(assignment => !assignment.completed).sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  const container = $('calendar-assignment-list');
  container.innerHTML = upcoming.length
    ? upcoming.map(assignmentMarkup).join('')
    : '<div class="empty-state">You are all caught up. Add an assignment to see it on your calendar.</div>';
  bindAssignmentActions(container);
  paginateToFit(container, { label: 'Upcoming assignment pages', itemHeight: 100 });
  syncReminderControls();
}

function openCalendarDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const events = [
    ...classes.filter(item => Array.isArray(item.meetingDays) && item.meetingDays.map(Number).includes(date.getDay()))
      .map(item => `<article class="calendar-event class-event"><strong>${escapeHtml(item.name)}</strong><time>${escapeHtml(item.startTime || 'Class')}${item.endTime ? `–${escapeHtml(item.endTime)}` : ''}</time><span>${escapeHtml(item.location || item.instructor || '')}</span></article>`),
    ...assignments.filter(item => localDateKey(new Date(Number(item.dueAt))) === dateKey)
      .map(item => `<article class="calendar-event assignment-event"><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatDueDate(Number(item.dueAt)))}</time><button type="button" data-edit-assignment="${escapeHtml(item.id)}">View assignment</button></article>`)
  ];
  $('calendar-day-title').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  $('calendar-day-events').innerHTML = events.join('') || '<p>No events scheduled.</p>';
  paginateToFit($('calendar-day-events'), { label: 'Calendar day event pages', itemHeight: 56 });
  $('calendar-day-dialog').showModal();
  requestAnimationFrame(() => paginateToFit($('calendar-day-events'), { label: 'Calendar day event pages', itemHeight: 56 }));
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
  paginateToFit(list, { label: 'Document pages', itemHeight: 118 });
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

function splitDocumentPages(text, container) {
  const style = getComputedStyle(container);
  const font = `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const maxLines = Math.max(4, Math.floor(container.clientHeight / lineHeight));
  const maxWidth = Math.max(80, container.clientWidth - 4);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  const lines = [];
  String(text || '').split(/\r?\n/).forEach(paragraph => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let line = '';
    paragraph.split(/\s+/).forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      if (context.measureText(line).width > maxWidth) {
        let part = '';
        for (const character of line) {
          if (part && context.measureText(part + character).width > maxWidth) {
            lines.push(part);
            part = character;
          } else part += character;
        }
        line = part;
      }
    });
    if (line) lines.push(line);
  });
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join('\n'));
  return pages.length ? pages : ['No extracted text available.'];
}

function renderDocumentPage() {
  const container = $('doc-preview');
  if (!container) return;
  documentTextPages = splitDocumentPages(container.dataset.fullText || container.textContent, container);
  documentPageIndex = Math.max(0, Math.min(documentPageIndex, documentTextPages.length - 1));
  container.textContent = documentTextPages[documentPageIndex];
  $('document-page-indicator').textContent = `Page ${documentPageIndex + 1} of ${documentTextPages.length}`;
  $('document-page-jump').max = String(documentTextPages.length);
  $('document-page-jump').value = String(documentPageIndex + 1);
  $('document-page-prev').disabled = documentPageIndex === 0;
  $('document-page-next').disabled = documentPageIndex >= documentTextPages.length - 1;
  const doc = documents.find(item => item.id === currentPreviewDocId);
  if (doc) {
    doc.readingProgress = Math.round(((documentPageIndex + 1) / documentTextPages.length) * 100);
    $('doc-progress').value = String(doc.readingProgress);
    idbSet('documents', documents);
  }
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
  $('doc-preview').dataset.fullText = String(showOriginalDocumentText ? originalText : doc.extractedText).slice(0, 120000) || 'No extracted text available.';
  documentTextPages = splitDocumentPages($('doc-preview').dataset.fullText, $('doc-preview'));
  documentPageIndex = Math.min(documentTextPages.length - 1, Math.floor(((doc.readingProgress || 0) / 100) * documentTextPages.length));
  renderDocumentPage();
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

function renderTutorScopeOptions() {
  const select = $('tutor-study-scope');
  if (!select) return;
  const current = select.value || 'all';
  const options = ['<option value="all">All study material</option>'];
  const courses = [...new Set([
    ...documents.map(item => item.course),
    ...notes.map(item => item.tag),
    ...cards.map(item => item.subject),
    ...classes.map(item => item.name)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  courses.forEach(course => options.push(`<option value="course:${escapeHtml(course)}">Course: ${escapeHtml(course)}</option>`));
  documents.forEach(item => options.push(`<option value="document:${escapeHtml(item.id)}">Document: ${escapeHtml(item.title)}</option>`));
  select.innerHTML = options.join('');
  select.value = [...select.options].some(option => option.value === current) ? current : 'all';
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
    if (studyMaterialIndex.get(key)?.signature === signature) return;
    const text = record.body || record.extractedText || record.text
      || (type === 'card' ? `${record.front || ''}\n${record.back || ''}` : '');
    const chunks = type === 'document' || type === 'note' ? splitStudyText(text) : [String(text || '')];
    studyMaterialIndex.set(key, {
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
  [...studyMaterialIndex.keys()].forEach(key => {
    if (key.startsWith(`${type}:`) && !activeIds.has(key)) studyMaterialIndex.delete(key);
  });
}

function updateStudyMaterialIndex() {
  indexStudyMaterial('document', documents.map(item => ({
    ...item, title: item.title, course: item.course, extractedText: item.extractedText
  })));
  indexStudyMaterial('note', notes.map(item => ({
    ...item, title: item.title || 'Untitled note', course: item.tag, body: item.body
  })));
  indexStudyMaterial('card', cards);
  indexStudyMaterial('quiz', quizResults);
  indexStudyMaterial('assignment', assignments.map(item => ({
    ...item, title: item.title, course: classForAssignment(item)?.name || 'General',
    text: `${item.title || 'Assignment'} ${item.details || ''} due ${new Date(Number(item.dueAt)).toLocaleString()} ${item.completed ? 'completed' : 'open'}`
  })));
  indexStudyMaterial('class', classes.map(item => ({
    ...item, course: item.name, text: `${item.name} ${item.instructor || ''} ${item.location || ''} ${formatMeetingDays(item.meetingDays)} ${item.startTime || ''} ${item.endTime || ''}`
  })));
  indexStudyMaterial('session', timerSessions.map(item => ({
    ...item, title: `${item.course || 'General'} study session`,
    text: `${Math.round((Number(item.seconds) || 0) / 60)} minutes ${item.unit || ''} ${new Date(Number(item.completedAt)).toLocaleString()}`
  })));
  indexStudyMaterial('progress', [{
    id: 'aggregate',
    title: 'Study progress',
    text: `${documents.filter(item => (item.readingProgress || 0) >= 100).length} documents completed. `
      + `${cards.filter(item => item.mastered).length} of ${cards.length} flashcards mastered. `
      + `${quizResults.length ? Math.round(quizResults.reduce((total, item) => total + item.score, 0) / quizResults.length) : 0}% average quiz accuracy. `
      + `${Math.round(timerSessions.reduce((total, item) => total + (Number(item.seconds) || 0), 0) / 60)} minutes total focus time.`
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
  const candidates = [...studyMaterialIndex.values()].flatMap(entry => entry.chunks)
    .filter(chunk => {
      if (query.startsWith('course:') && chunk.course !== query.slice(7)) return false;
      if (query.startsWith('document:')) {
        const documentId = query.slice(9);
        return (chunk.type === 'document' && chunk.sourceId === documentId)
          || (chunk.type === 'note' && notes.find(item => item.id === chunk.sourceId)?.sourceDocumentId === documentId)
          || (chunk.type === 'card' && cards.find(item => item.id === chunk.sourceId)?.sourceDocumentId === documentId);
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

function addMsg(role, text, container = $('chat-log')) {
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'user') {
    const content = document.createElement('div');
    content.className = 'user-content';
    content.textContent = text;
    div.appendChild(content);
    if (text.length > 360) {
      const showMore = document.createElement('button');
      showMore.type = 'button';
      showMore.className = 'text-btn reply-show-more';
      showMore.textContent = 'Show full question';
      showMore.addEventListener('click', () => openReplyDialog(text));
      div.appendChild(showMore);
    }
  } else {
    div.textContent = text;
  }
  container.appendChild(div);
  return div;
}

function addAssistantMsg(text, sources = [], container = $('chat-log')) {
  const message = addMsg('assistant', '', container);
  const content = document.createElement('div');
  content.className = 'assistant-content';
  content.textContent = text;
  message.appendChild(content);
  if (text.length > 360) {
    const showMore = document.createElement('button');
    showMore.type = 'button';
    showMore.className = 'text-btn reply-show-more';
    showMore.textContent = 'Show more';
    showMore.addEventListener('click', () => openReplyDialog(text));
    message.appendChild(showMore);
  }
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
      button.dataset.sourceType = source.type;
      button.dataset.sourceId = source.sourceId || '';
      button.textContent = `[${source.type === 'document' ? 'Doc' : source.type.charAt(0).toUpperCase() + source.type.slice(1)}: ${source.title}]`;
      item.appendChild(button);
      list.appendChild(item);
    });
    details.append(summary, list);
    message.appendChild(details);
  }
  return message;
}

function renderTutorChatPage() {
  const log = $('chat-log');
  log.replaceChildren();
  const exchanges = Math.max(1, Math.ceil(chatHistory.length / 2));
  chatPageIndex = Math.max(0, Math.min(chatPageIndex, exchanges - 1));
  const pairStart = chatPageIndex * 2;
  const messages = chatHistory.slice(pairStart, pairStart + 2);
  messages.forEach(message => {
    if (message.role === 'assistant') addAssistantMsg(message.content, message.sources || []);
    else addMsg('user', message.content);
  });
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.id = 'chat-empty';
    empty.textContent = 'Ask about a concept, a past-paper question, or get a worked example.';
    log.appendChild(empty);
  }
  if (chatPending && messages.at(-1)?.role === 'user') addMsg('assistant loading', 'Thinking...');
  const controls = $('chat-page-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-chat-prev ${chatPageIndex === 0 ? 'disabled' : ''}>Previous exchange</button><span aria-live="polite">Exchange ${exchanges ? chatPageIndex + 1 : 0} of ${exchanges}</span><button type="button" class="btn btn-sm" data-chat-next ${chatPageIndex >= exchanges - 1 ? 'disabled' : ''}>Next exchange</button>`;
  controls.querySelector('[data-chat-prev]').addEventListener('click', () => { chatPageIndex--; renderTutorChatPage(); });
  controls.querySelector('[data-chat-next]').addEventListener('click', () => { chatPageIndex++; renderTutorChatPage(); });
}

function renderTutorHistory() {
  const content = $('tutor-history-content');
  const pageSize = 2;
  const pageCount = Math.max(1, Math.ceil(chatHistory.length / (pageSize * 2)));
  historyPageIndex = Math.max(0, Math.min(historyPageIndex, pageCount - 1));
  const firstPair = historyPageIndex * pageSize;
  const pageMessages = chatHistory.slice(firstPair * 2, (firstPair + pageSize) * 2);
  content.replaceChildren();
  pageMessages.forEach(message => {
    const item = message.role === 'assistant'
      ? addAssistantMsg(message.content, message.sources || [], content)
      : addMsg('user', message.content, content);
    item.classList.add('history-message');
  });
  const controls = $('tutor-history-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-history-prev ${historyPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Page ${historyPageIndex + 1} of ${pageCount}</span><button type="button" class="btn btn-sm" data-history-next ${historyPageIndex >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-history-prev]').addEventListener('click', () => { historyPageIndex--; renderTutorHistory(); });
  controls.querySelector('[data-history-next]').addEventListener('click', () => { historyPageIndex++; renderTutorHistory(); });
  if (!chatHistory.length) {
    content.innerHTML = '<p class="hint">No conversation history yet.</p>';
  }
}

let replyPages = [];
let replyPageIndex = 0;

function openReplyDialog(text) {
  const content = $('reply-dialog-content');
  const pageLength = Math.max(500, Math.min(1400, Math.floor(($('reply-dialog').clientWidth || 700) * ($('reply-dialog').clientHeight || 500) / 26)));
  replyPages = [];
  for (let index = 0; index < text.length; index += pageLength) replyPages.push(text.slice(index, index + pageLength));
  replyPageIndex = 0;
  content.textContent = replyPages[0] || '';
  renderReplyControls();
  $('reply-dialog').showModal();
}

function renderReplyControls() {
  const controls = $('reply-dialog-controls');
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-reply-prev ${replyPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Part ${replyPageIndex + 1} of ${replyPages.length}</span><button type="button" class="btn btn-sm" data-reply-next ${replyPageIndex >= replyPages.length - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-reply-prev]').addEventListener('click', () => { replyPageIndex--; renderReplyPage(); });
  controls.querySelector('[data-reply-next]').addEventListener('click', () => { replyPageIndex++; renderReplyPage(); });
}

function renderReplyPage() {
  $('reply-dialog-content').textContent = replyPages[replyPageIndex] || '';
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
    classesView = type === 'assignment' ? 'assignments' : 'classes';
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

async function sendChat() {
  const q = $('chat-input').value.trim();
  if (!q || chatPending) return;
  chatPending = true;
  $('chat-input').value = '';
  $('chat-send').disabled = true;
  chatHistory.push({ role: 'user', content: q });
  chatPageIndex = Math.ceil(chatHistory.length / 2) - 1;
  renderTutorChatPage();
  renderTutorOverview();
  try {
    const references = $('tutor-use-material').checked ? retrieveStudyReferences(q) : [];
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: q, history: chatHistory.slice(0, -1), references })
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
    chatHistory.push({ role: 'assistant', content: textBlock, sources: Array.isArray(data.sources) ? data.sources : [] });
    if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
    chatPageIndex = Math.ceil(chatHistory.length / 2) - 1;
    renderTutorChatPage();
    renderTutorOverview();
  } catch (err) {
    chatHistory.push({ role: 'assistant', content: err.message || 'Could not reach the tutor. Check the backend server and try again.' });
    chatPageIndex = Math.ceil(chatHistory.length / 2) - 1;
    renderTutorChatPage();
  } finally {
    chatPending = false;
    $('chat-send').disabled = false;
  }
}

$('clear-chat-btn').addEventListener('click', () => {
  chatHistory = [];
  chatPageIndex = 0;
  renderTutorChatPage();
  renderTutorOverview();
});

function cardLabel(card) {
  if (card.format === 'definition') return 'Definition';
  if (card.format === 'fill_blank') return 'Fill blank';
  return 'Basic';
}
function renderDeckBar() {
  const select = $('card-course-filter');
  if (!select) return;
  const courses = [...new Set(cards.map(card => card.subject || 'General'))].sort((a, b) => a.localeCompare(b));
  const previous = select.value || 'all';
  select.innerHTML = `<option value="all">All courses</option>${courses.map(course => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join('')}`;
  select.value = courses.includes(previous) ? previous : 'all';
}
function filteredCards() {
  const course = $('card-course-filter').value;
  const unit = $('card-unit-filter').value;
  const mastery = $('card-mastery-filter').value;
  const query = $('card-search').value.trim().toLocaleLowerCase();
  return cards.filter(card =>
    (course === 'all' || (card.subject || 'General') === course)
    && (unit === 'all' || (card.unit || 'General') === unit)
    && (mastery === 'all' || (mastery === 'mastered' ? card.mastered : !card.mastered))
    && (!query || `${card.front} ${card.back} ${card.subject} ${card.unit}`.toLocaleLowerCase().includes(query))
  );
}

function renderCardFilters() {
  const units = [...new Set(cards.map(card => card.unit || 'General'))].sort();
  const select = $('card-unit-filter');
  const previous = select.value || 'all';
  select.innerHTML = `<option value="all">All units</option>${units.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = units.includes(previous) ? previous : 'all';
}

function cardMarkup(card) {
  return `
    <article class="card-row" data-card-id="${escapeHtml(card.id)}">
      <div class="meta-line">
        <span class="card-course-label">${escapeHtml(card.subject || 'General')}</span>
        <i class="mastery-dot ${card.mastered ? 'mastered' : ''}" role="img" aria-label="${card.mastered ? 'Mastered' : 'Still learning'}"></i>
      </div>
      <button type="button" class="card-face" data-flip-card="${escapeHtml(card.id)}" aria-pressed="false" aria-label="Show answer">
        <span class="card-front">${escapeHtml(card.front)}</span>
        <span class="card-back">${escapeHtml(card.back)}</span>
      </button>
      <details class="card-more">
        <summary aria-label="More flashcard details">···</summary>
        <div class="card-more-menu">
          <span>Unit: ${escapeHtml(card.unit || 'General')}</span>
          <span>Type: ${escapeHtml(cardLabel(card))}</span>
          <span>${card.aiGenerated ? 'AI generated' : 'Added by you'}</span>
          ${card.sourceDocumentTitle ? `<span>Source: ${escapeHtml(card.sourceDocumentTitle)}</span>` : ''}
          <button type="button" data-edit-card="${escapeHtml(card.id)}">Edit card</button>
          <button type="button" data-delete-card="${escapeHtml(card.id)}">Delete card</button>
        </div>
      </details>
    </article>
  `;
}

function renderCardList() {
  const list = $('card-list');
  const empty = $('cards-empty');
  const fc = filteredCards().sort((a, b) => (a.subject || 'General').localeCompare(b.subject || 'General'));
  if (fc.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = fc.map(cardMarkup).join('');
  list.querySelectorAll('[data-flip-card]').forEach(button => button.addEventListener('click', () => {
    const flipped = !button.classList.contains('flipped');
    button.classList.toggle('flipped', flipped);
    button.setAttribute('aria-pressed', String(flipped));
    button.setAttribute('aria-label', flipped ? 'Show question' : 'Show answer');
  }));
  list.querySelectorAll('[data-delete-card]').forEach(btn => btn.addEventListener('click', () => {
    const card = cards.find(item => item.id === btn.dataset.deleteCard);
    if (!card || !confirm('Delete this flashcard?')) return;
    cards = cards.filter(card => card.id !== btn.dataset.deleteCard);
    idbSet('cards', cards);
    renderEverything();
  }));
  list.querySelectorAll('[data-edit-card]').forEach(btn => btn.addEventListener('click', () => openCardForm(btn.dataset.editCard)));
  paginateToFit(list, { label: 'Flashcard pages', itemHeight: 154 });
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
  $('flip-card').focus();
}
function renderStudyCard() {
  if (studyIndex >= studyDeck.length) {
    $('card-study-progress').textContent = 'Session complete.';
    $('flip-card').textContent = 'Nice work. The deck is cleared for now.';
    $('flip-card').classList.remove('flipped');
    $('flip-card').setAttribute('aria-pressed', 'false');
    $('flip-card').setAttribute('aria-label', 'Study session complete.');
    studyFlipped = false;
    return;
  }
  studyFlipped = false;
  $('card-study-progress').textContent = `Card ${studyIndex + 1} of ${studyDeck.length}`;
  $('flip-card').classList.remove('flipped');
  $('flip-card').setAttribute('aria-pressed', 'false');
  $('flip-card').setAttribute('aria-label', 'Flashcard. Press Space to flip.');
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
  $('flip-card').focus();
}
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function renderNotes() {
  const query = $('notes-search').value.trim().toLocaleLowerCase();
  const sort = $('notes-sort').value;
  const filtered = notes.filter(note => !query
    || `${note.title} ${note.body} ${note.tag} ${note.unit} ${normalizeNoteTags(note.tags).join(' ')}`.toLocaleLowerCase().includes(query));
  filtered.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || (sort === 'title' ? (a.title || '').localeCompare(b.title || '')
      : sort === 'course' ? (a.tag || '').localeCompare(b.tag || '') || (a.title || '').localeCompare(b.title || '')
        : (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));
  if (!filtered.some(note => note.id === selectedNoteId)) selectedNoteId = filtered[0]?.id || null;
  $('notes-empty').classList.toggle('hidden', filtered.length > 0);
  $('note-grid').innerHTML = filtered.map(note => `
    <button class="note-card ${note.id === selectedNoteId ? 'selected' : ''}" type="button" data-select-note="${escapeHtml(note.id)}" aria-pressed="${note.id === selectedNoteId}">
      <span class="note-card-topline"><span class="note-card-course">${escapeHtml(note.tag || 'General')}</span>${note.pinned ? '<span aria-label="Pinned">★</span>' : ''}</span>
      <strong>${escapeHtml(note.title || 'Untitled')}</strong>
      <span class="note-card-preview">${escapeHtml(String(note.body || '').replace(/\s+/g, ' ').trim())}</span>
      <span class="note-card-meta">${escapeHtml(new Date(note.updatedAt || note.createdAt || Date.now()).toLocaleDateString())}</span>
    </button>
  `).join('');
  $('note-grid').querySelectorAll('[data-select-note]').forEach(button => button.addEventListener('click', () => selectNote(button.dataset.selectNote)));
  paginateToFit($('note-grid'), { label: 'Note pages', itemHeight: 110 });
  renderNoteDetail();
}

function cleanNoteBody(value) {
  let body = String(value || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, '\t')
    .replace(/\r\n?/g, '\n');
  const fenced = body.trim().match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) body = fenced[1];
  return body.trim();
}

function normalizeNoteTags(value) {
  const tags = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(tags
    .filter(tag => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean))].slice(0, 20);
}

function noteHeadings(markdown) {
  const counts = new Map();
  return String(markdown || '').split('\n').flatMap(line => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return [];
    const slug = slugify(match[2]);
    const count = counts.get(slug) || 0;
    counts.set(slug, count + 1);
    return [{ level: match[1].length, title: match[2].trim(), id: count ? `${slug}-${count + 1}` : slug }];
  });
}

function slugify(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'note-section';
}

function renderMarkdown(markdown) {
  const lines = cleanNoteBody(markdown).split('\n');
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listType = '';
  let codeLines = [];
  let codeLanguage = '';
  let inCode = false;
  let tableRows = [];
  let quoteLines = [];
  let headingCounts = new Map();
  const inline = value => {
    const code = [];
    let output = escapeHtml(value).replace(/`([^`]+)`/g, (_, content) => {
      code.push(`<code>${content}</code>`);
      return `\u0000${code.length - 1}\u0000`;
    });
    output = output
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return output.replace(/\u0000(\d+)\u0000/g, (_, index) => code[Number(index)] || '');
  };
  const flushParagraph = () => {
    if (paragraph.length) {
      const words = paragraph.join(' ').split(/\s+/);
      const chunks = [];
      let chunk = '';
      words.forEach(word => {
        if (chunk && chunk.length + word.length + 1 > 520) {
          chunks.push(chunk);
          chunk = '';
        }
        chunk += `${chunk ? ' ' : ''}${word}`;
      });
      if (chunk) chunks.push(chunk);
      chunks.forEach(text => blocks.push(`<p>${inline(text)}</p>`));
    }
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) {
      const tag = listType === 'ol' ? 'ol' : 'ul';
      blocks.push(`<${tag}>${list.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
    }
    list = [];
    listType = '';
  };
  const flushQuote = () => {
    if (quoteLines.length) blocks.push(`<blockquote>${quoteLines.map(line => `<p>${inline(line)}</p>`).join('')}</blockquote>`);
    quoteLines = [];
  };
  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows.forEach(row => blocks.push(`<p>${inline(row)}</p>`));
      tableRows = [];
      return;
    }
    const cells = row => row.replace(/^\s*\|?|\|?\s*$/g, '').split('|').map(cell => cell.trim());
    const header = cells(tableRows[0]);
    const bodyRows = tableRows.slice(1).filter(row => !/^\s*\|?\s*:?-{3,}/.test(row)).map(cells);
    blocks.push(`<div class="markdown-table-wrap"><table><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map(row => `<tr>${header.map((_, index) => `<td>${inline(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    tableRows = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); flushTable(); };
  lines.forEach(line => {
    const fence = line.trim().match(/^```([a-z0-9_+-]*)\s*$/i);
    if (fence) {
      flushAll();
      if (inCode) {
        const index = blocks.length;
        blocks.push(`<section class="markdown-code-block"><header class="markdown-code-header"><span>${escapeHtml(codeLanguage || 'Code')}</span><button type="button" data-copy-code="${index}">Copy code</button></header><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></section>`);
        codeLines = [];
        codeLanguage = '';
      } else {
        codeLanguage = fence[1];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (line.includes('|') && /^\s*\|?.+\|.+/.test(line)) {
      flushParagraph(); flushList(); flushQuote();
      tableRows.push(line);
    } else {
      flushTable();
      if (!line.trim()) {
        flushParagraph(); flushList(); flushQuote();
      } else if (heading) {
        flushAll();
        const level = heading[1].length;
        const title = heading[2].trim();
        const slug = slugify(title);
        const count = headingCounts.get(slug) || 0;
        headingCounts.set(slug, count + 1);
        blocks.push(`<h${level} id="${escapeHtml(count ? `${slug}-${count + 1}` : slug)}">${inline(title)}</h${level}>`);
      } else if (/^\s*>\s?/.test(line)) {
        flushParagraph(); flushList();
        quoteLines.push(line.replace(/^\s*>\s?/, '').trim());
      } else if (bullet || ordered) {
        flushParagraph(); flushQuote();
        const nextType = ordered ? 'ol' : 'ul';
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        list.push((bullet || ordered)[1]);
      } else {
        flushList(); flushQuote();
        paragraph.push(line.trim());
      }
    }
  });
  if (inCode) {
    const index = blocks.length;
    blocks.push(`<section class="markdown-code-block"><header class="markdown-code-header"><span>${escapeHtml(codeLanguage || 'Code')}</span><button type="button" data-copy-code="${index}">Copy code</button></header><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></section>`);
  }
  flushAll();
  return blocks.join('');
}

function bindMarkdownCodeButtons(container) {
  container.querySelectorAll('[data-copy-code]').forEach(button => button.addEventListener('click', async () => {
    const code = button.closest('.markdown-code-block').querySelector('code').dataset.fullCode
      || button.closest('.markdown-code-block').querySelector('pre').textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy unavailable';
    }
  }));
  container.querySelectorAll('.markdown-code-block').forEach(block => {
    const code = block.querySelector('code');
    const fullCode = code.textContent;
    code.dataset.fullCode = fullCode;
    const lines = fullCode.split('\n');
    if (lines.length <= 12 || block.querySelector('[data-expand-code]')) return;
    code.textContent = lines.slice(0, 12).join('\n');
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'text-btn';
    expand.dataset.expandCode = '';
    expand.textContent = `Show all ${lines.length} lines`;
    expand.addEventListener('click', () => openCodeDialog(fullCode));
    block.appendChild(expand);
  });
}

let codeDialogPages = [];
let codeDialogPageIndex = 0;

function openCodeDialog(code) {
  const dialog = $('code-dialog');
  dialog.showModal();
  const maxCharacters = Math.max(12, Math.floor((dialog.clientWidth - 48) / 8));
  const visualLines = String(code).split('\n').flatMap(line => {
    if (!line) return [''];
    const pieces = [];
    for (let index = 0; index < line.length; index += maxCharacters) {
      pieces.push(line.slice(index, index + maxCharacters));
    }
    return pieces;
  });
  const linesPerPage = Math.max(4, Math.floor((dialog.clientHeight - 130) / 20));
  codeDialogPages = [];
  for (let index = 0; index < visualLines.length; index += linesPerPage) {
    codeDialogPages.push(visualLines.slice(index, index + linesPerPage).join('\n'));
  }
  codeDialogPageIndex = 0;
  renderCodeDialogPage();
}

function renderCodeDialogPage() {
  $('code-dialog-content').textContent = codeDialogPages[codeDialogPageIndex] || '';
  const controls = $('code-dialog-controls');
  const pageCount = Math.max(1, codeDialogPages.length);
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-code-prev ${codeDialogPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Part ${codeDialogPageIndex + 1} of ${pageCount}</span><button type="button" class="btn btn-sm" data-code-next ${codeDialogPageIndex >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-code-prev]').addEventListener('click', () => {
    codeDialogPageIndex--;
    renderCodeDialogPage();
  });
  controls.querySelector('[data-code-next]').addEventListener('click', () => {
    codeDialogPageIndex++;
    renderCodeDialogPage();
  });
}

function renderNoteDetail() {
  const note = notes.find(item => item.id === selectedNoteId);
  const detail = $('note-detail');
  releaseFitPaginator(detail.querySelector('.markdown-body'));
  $('note-editor-empty').classList.toggle('hidden', Boolean(note));
  if (!note) {
    $('note-editor-empty').querySelector('strong').textContent = notes.length ? 'No matching notes' : 'No notes yet';
    $('note-editor-empty').querySelector('span:last-child').textContent = notes.length
      ? 'Try another search or create a note.'
      : 'Create a note or generate one from a document.';
  }
  detail.classList.toggle('hidden', !note || ! $('note-form').classList.contains('hidden'));
  if (!note || ! $('note-form').classList.contains('hidden')) return;
  const headings = noteHeadings(note.body);
  const date = new Date(note.updatedAt || note.createdAt || Date.now());
  const toc = headings.length >= 3
    ? `<details class="note-toc"><summary>On this page</summary><ul>${headings.map(item => `<li class="toc-level-${item.level}"><a href="#${escapeHtml(item.id)}">${escapeHtml(item.title)}</a></li>`).join('')}</ul></details>`
    : '';
  detail.innerHTML = `
    <header class="note-detail-header">
      <div><h2>${escapeHtml(note.title || 'Untitled note')}</h2>
      <div class="note-detail-tags"><span class="pill">${escapeHtml(note.tag || 'General')}</span><span class="pill">${escapeHtml(note.unit || 'General')}</span>${normalizeNoteTags(note.tags).map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}${note.aiGenerated ? '<span class="pill ai">AI generated</span>' : ''}</div>
        <p class="note-card-meta">Edited ${escapeHtml(date.toLocaleString())}</p>
      </div>
      <div class="note-detail-actions">
        <button class="btn btn-sm" type="button" data-note-edit="${escapeHtml(note.id)}">Edit</button>
        <button class="btn btn-sm" type="button" data-note-pin="${escapeHtml(note.id)}" aria-pressed="${Boolean(note.pinned)}">${note.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn btn-sm" type="button" data-note-cards="${escapeHtml(note.id)}">Make flashcards</button>
        <button class="btn btn-sm" type="button" data-note-quiz="${escapeHtml(note.id)}">Quiz me</button>
        <button class="btn btn-sm" type="button" data-note-tutor="${escapeHtml(note.id)}">Ask tutor</button>
        <button class="btn btn-sm" type="button" data-note-export="${escapeHtml(note.id)}">Export Markdown</button>
        <button class="btn btn-sm" type="button" data-note-json="${escapeHtml(note.id)}">Export JSON</button>
        <button class="icon-btn btn-danger" type="button" data-note-delete="${escapeHtml(note.id)}" aria-label="Delete note" title="Delete">×</button>
      </div>
    </header>
    ${toc}
    <div class="note-detail-body markdown-body">${renderMarkdown(note.body) || '<p class="hint">This note is empty. Edit it to add content.</p>'}</div>
  `;
  bindMarkdownCodeButtons(detail);
  const markdown = detail.querySelector('.markdown-body');
  if (markdown) paginateToFit(markdown, { label: 'Note section pages', itemHeight: 64 });
  detail.querySelector('[data-note-edit]').addEventListener('click', () => openNoteForm(note.id));
  detail.querySelector('[data-note-pin]').addEventListener('click', async () => {
    note.pinned = !note.pinned;
    note.updatedAt = Date.now();
    await idbSet('notes', notes);
    renderNotes();
  });
  detail.querySelector('[data-note-cards]').addEventListener('click', () => makeFlashcardsFromNote(note.id));
  detail.querySelector('[data-note-quiz]').addEventListener('click', () => quizFromNote(note.id));
  detail.querySelector('[data-note-tutor]').addEventListener('click', () => askTutorAboutNote(note.id));
  detail.querySelector('[data-note-export]').addEventListener('click', () => exportNoteMarkdown(note));
  detail.querySelector('[data-note-json]').addEventListener('click', () => downloadJSON(note, `${safeFileName(note.title || 'note')}.json`));
  detail.querySelector('[data-note-delete]').addEventListener('click', () => deleteNoteWithUndo(note.id));
}

function selectNote(id) {
  if (!notes.some(note => note.id === id)) return;
  selectedNoteId = id;
  $('notes-workspace').classList.add('mobile-detail-open');
  $('notes-back-btn').classList.remove('hidden');
  $('note-form').classList.add('hidden');
  renderNotes();
}

function renderNotePreview() {
  if (!editingNoteId) return;
  const note = notes.find(item => item.id === editingNoteId);
  if (!note) return;
  note.title = $('note-title').value.trim();
  note.tag = $('note-tag').value.trim();
  note.unit = $('note-unit').value.trim();
  note.tags = normalizeNoteTags($('note-tags-input').value);
  note.body = cleanNoteBody($('note-body').value);
  note.updatedAt = Date.now();
  $('note-save-status').textContent = 'Unsaved changes';
  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = setTimeout(saveNote, 650);
}

function openNoteForm(id) {
  let note = notes.find(item => item.id === id);
  if (!note) {
    const now = Date.now();
    note = { id: uid(), title: '', tag: '', unit: '', tags: [], body: '', aiGenerated: false, createdAt: now, updatedAt: now };
    notes.push(note);
  }
  selectedNoteId = note.id;
  editingNoteId = note.id;
  $('notes-workspace').classList.add('mobile-detail-open');
  $('notes-back-btn').classList.remove('hidden');
  $('note-form').classList.remove('hidden');
  $('note-detail').classList.add('hidden');
  $('note-title').value = note.title || '';
  $('note-tag').value = note.tag || '';
  $('note-unit').value = note.unit || '';
  $('note-tags-input').value = normalizeNoteTags(note.tags).join(', ');
  $('note-body').value = cleanNoteBody(note.body);
  $('note-save-status').textContent = 'Saved';
  renderNotes();
  $('note-title').focus();
}

async function saveNote() {
  clearTimeout(noteAutosaveTimer);
  if (!editingNoteId) return;
  const note = notes.find(item => item.id === editingNoteId);
  if (!note) return;
  note.title = $('note-title').value.trim();
  note.tag = $('note-tag').value.trim();
  note.unit = $('note-unit').value.trim();
  note.tags = normalizeNoteTags($('note-tags-input').value);
  note.body = cleanNoteBody($('note-body').value);
  note.updatedAt = Date.now();
  await idbSet('notes', notes);
  $('note-save-status').textContent = 'Saved';
  updateStudyMaterialIndex();
  renderTaxonomy();
  renderNoteListOnly();
}

function renderNoteListOnly() {
  renderNotes();
}

function closeNoteForm() {
  if (editingNoteId) saveNote();
  $('note-form').classList.add('hidden');
  editingNoteId = null;
  renderNotes();
}

function safeFileName(value) {
  return String(value).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'note';
}

function exportNoteMarkdown(note) {
  const content = `# ${note.title || 'Untitled note'}\n\n${note.body || ''}\n`;
  downloadText(content, `${safeFileName(note.title || 'note')}.md`, 'text/markdown');
}

function downloadText(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

let deletedNoteUndo = null;
let deletedNoteUndoTimer = null;
async function deleteNoteWithUndo(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  deletedNoteUndo = note;
  notes = notes.filter(item => item.id !== id);
  selectedNoteId = notes.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0]?.id || null;
  await idbSet('notes', notes);
  renderNotes();
  $('notes-action-message').textContent = 'Note deleted.';
  const undo = $('note-undo-delete');
  undo.classList.remove('hidden');
  undo.onclick = async () => {
    if (deletedNoteUndo) notes.push(deletedNoteUndo);
    deletedNoteUndo = null;
    clearTimeout(deletedNoteUndoTimer);
    undo.classList.add('hidden');
    $('notes-action-message').textContent = 'Note restored.';
    await idbSet('notes', notes);
    renderNotes();
  };
  clearTimeout(deletedNoteUndoTimer);
  deletedNoteUndoTimer = setTimeout(() => {
    deletedNoteUndo = null;
    $('note-undo-delete').classList.add('hidden');
  }, 8000);
}

async function makeFlashcardsFromNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note?.body.trim()) return;
  setStatus('notes-ai-status', 'Generating flashcards from note...');
  try {
    const data = await callAI('/api/generate-flashcards', { document: {
      title: note.title || 'Study note', course: note.tag || 'General',
      unit: note.unit || 'General', text: truncateText(note.body, 14000)
    } });
    const generated = Array.isArray(data.cards) ? data.cards : [];
    generated.filter(card => card && typeof card.front === 'string' && typeof card.back === 'string')
      .forEach(card => cards.push({
        id: uid(), front: card.front.trim(), back: card.back.trim(),
        subject: note.tag || '', unit: note.unit || '',
        format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
        aiGenerated: true, sourceNoteId: note.id, sourceNoteTitle: note.title || 'Study note',
        mastered: false, createdAt: Date.now()
      }));
    await idbSet('cards', cards);
    activatePage('cards');
    renderEverything();
    setStatus('cards-ai-status', `Added ${generated.length} cards from ${note.title || 'your note'}.`);
  } catch (error) {
    setStatus('notes-ai-status', error.message || 'Could not generate flashcards.');
  }
}

async function quizFromNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note?.body.trim()) return;
  setStatus('notes-ai-status', 'Preparing a quiz from note...');
  try {
    const data = await callAI('/api/generate-quiz', { document: {
      id: note.id, title: note.title || 'Study note', course: note.tag || 'General',
      unit: note.unit || 'General', text: truncateText(note.body, 14000)
    } });
    const questions = normalizeGeneratedQuestions(data.questions);
    if (!questions.length) throw new Error('No complete quiz questions could be made from this note.');
    renderQuiz({ id: note.id, title: note.title || 'Study note', course: note.tag, unit: note.unit }, questions);
    activatePage('quiz');
  } catch (error) {
    setStatus('notes-ai-status', error.message || 'Could not create a quiz from this note.');
  }
}

function askTutorAboutNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  activatePage('tutor');
  $('tutor-use-material').checked = true;
  localStorage.setItem(TUTOR_MATERIAL_KEY, 'true');
  $('settings-tutor-material').checked = true;
  $('tutor-study-scope').value = 'all';
  $('chat-input').value = `Help me understand the main ideas in my note "${note.title || 'Untitled note'}".`;
  $('chat-input').focus();
}

async function generateNotesFromDocument() {
  const doc = documents.find(d => d.id === $('notes-doc-select').value);
  if (!doc) return setStatus('notes-ai-status', 'Upload a document first. (No document selected)');

  setStatus('notes-ai-status', 'Generating notes...');
  $('generate-notes-btn').disabled = true;
  try {
    const data = await callAI('/api/generate-notes', { document: aiDocumentPayload(doc) });
    const bodyParts = [
      typeof data.summary === 'string' && data.summary.trim() ? `## Summary\n${cleanNoteBody(data.summary).trim()}` : '',
      Array.isArray(data.keyConcepts) && data.keyConcepts.some(value => typeof value === 'string' && value.trim())
        ? `## Key concepts\n${data.keyConcepts.filter(value => typeof value === 'string' && value.trim()).map(value => `- ${cleanNoteBody(value).trim()}`).join('\n')}`
        : '',
      typeof data.body === 'string' && data.body.trim() ? `## Detailed notes\n${cleanNoteBody(data.body).trim()}` : ''
    ].filter(Boolean);
    if (!bodyParts.length) throw new Error('The AI returned an empty note. Try again with a document that has more study content.');
    notes.push({
      id: uid(),
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : `${doc.title} notes`,
      tag: doc.course,
      unit: doc.unit,
      body: cleanNoteBody(bodyParts.join('\n\n')),
      aiGenerated: true,
      sourceDocumentId: doc.id,
      sourceDocumentTitle: doc.title,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    selectedNoteId = notes.at(-1).id;
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
      topic: question.topic || question.question,
      correctAnswer: question.correctAnswer || question.answer || '',
      explanation: question.explanation || ''
    };
  });
  const correct = currentQuiz.results.filter(result => result.correct).length;
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  currentQuiz.graded = true;
  quizResults.push({
    id: uid(),
    documentId: doc.id,
    documentTitle: doc.title,
    course: doc.course,
    unit: doc.unit,
    score,
    correct,
    total: questions.length,
    mistakes: currentQuiz.results.filter(result => !result.correct).map(result => ({
      question: result.question,
      answer: result.answer,
      correctAnswer: result.correctAnswer,
      explanation: result.explanation
    })),
    takenAt: Date.now()
  });
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
        ${weakTopics.length ? '<button class="btn" id="quiz-mistakes-open">Review mistakes</button>' : ''}
        <button class="btn" id="retake-quiz-btn">Retake quiz</button>
        </div>
    </section>
  `;
  $('mistakes-to-cards-btn')?.addEventListener('click', makeFlashcardsFromMistakes);
  $('quiz-mistakes-open')?.addEventListener('click', () => {
    const list = $('quiz-mistake-list');
    list.innerHTML = weakTopics.map(result => `<li><strong>${escapeHtml(result.question)}</strong><span>Your answer: ${escapeHtml(result.answer || 'No answer')}</span><span>Correct answer: ${escapeHtml(result.correctAnswer || 'Not recorded')}</span>${result.explanation ? `<p>${escapeHtml(result.explanation)}</p>` : ''}</li>`).join('');
    paginateToFit(list, { label: 'Quiz mistake pages', itemHeight: 72 });
    $('quiz-mistakes-dialog').showModal();
    requestAnimationFrame(() => paginateToFit(list, { label: 'Quiz mistake pages', itemHeight: 72 }));
  });
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
  paginateToFit($('progress-list'), { label: 'Course progress pages', itemHeight: 86 });
  paginateToFit($('session-list'), { label: 'Study session pages', itemHeight: 62 });
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
  renderTutorScopeOptions();
  renderReminderBadge();
  updateStudyMaterialIndex();
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
$('document-list-view').addEventListener('click', () => {
  $('panel-documents').classList.remove('show-document-reader');
  $('document-list-view').classList.add('active');
  $('document-list-view').setAttribute('aria-pressed', 'true');
  $('document-reader-view').classList.remove('active');
  $('document-reader-view').setAttribute('aria-pressed', 'false');
});
$('document-reader-view').addEventListener('click', () => {
  $('panel-documents').classList.add('show-document-reader');
  $('document-list-view').classList.remove('active');
  $('document-list-view').setAttribute('aria-pressed', 'false');
  $('document-reader-view').classList.add('active');
  $('document-reader-view').setAttribute('aria-pressed', 'true');
});
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
$('document-page-prev').addEventListener('click', () => changeDocumentPage(documentPageIndex - 1));
$('document-page-next').addEventListener('click', () => changeDocumentPage(documentPageIndex + 1));
$('document-page-jump').addEventListener('change', event => {
  const page = Number(event.target.value);
  if (!Number.isInteger(page) || page < 1 || page > documentTextPages.length) {
    event.target.value = String(documentPageIndex + 1);
    return;
  }
  changeDocumentPage(page - 1);
});
if (typeof ResizeObserver !== 'undefined') {
  const documentPreviewObserver = new ResizeObserver(() => {
    if (!currentPreviewDocId) return;
    const previousPage = documentPageIndex;
    documentTextPages = splitDocumentPages($('doc-preview').dataset.fullText || '', $('doc-preview'));
    documentPageIndex = Math.min(previousPage, documentTextPages.length - 1);
    renderDocumentPage();
  });
  documentPreviewObserver.observe($('doc-preview'));
}
$('chat-send').addEventListener('click', sendChat);
$('access-token-input').value = localStorage.getItem(ACCESS_TOKEN_KEY) || '';
function updateTokenVisibilityButton(showing) {
  $('toggle-access-token-btn').setAttribute('aria-label', showing ? 'Hide access token' : 'Show access token');
  $('toggle-access-token-btn').innerHTML = showing
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a14 14 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 3-.4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
}
$('toggle-access-token-btn').addEventListener('click', () => {
  const input = $('access-token-input');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  updateTokenVisibilityButton(!showing);
});
$('copy-access-token-btn').addEventListener('click', async () => {
  const token = $('access-token-input').value;
  if (!token) {
    setStatus('access-token-status', 'Enter a token before copying.');
    return;
  }
  try {
    await navigator.clipboard.writeText(token);
    setStatus('access-token-status', 'Access token copied to clipboard.');
  } catch {
    setStatus('access-token-status', 'Clipboard access is unavailable in this browser.');
  }
});
function maskAccessToken() {
  $('access-token-input').type = 'password';
  updateTokenVisibilityButton(false);
}
window.addEventListener('blur', maskAccessToken);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) maskAccessToken();
});
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
$('card-course-filter').addEventListener('change', renderCardList);
$('close-card-dialog').addEventListener('click', () => $('card-dialog').close());
$('cancel-card-dialog').addEventListener('click', () => $('card-dialog').close());
$('card-dialog').addEventListener('close', resetCardForm);
$('add-card-btn').addEventListener('click', saveCard);
$('card-unit-filter').addEventListener('change', renderCardList);
$('card-mastery-filter').addEventListener('change', renderCardList);
$('card-search').addEventListener('input', renderCardList);
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
$('start-card-study-toolbar-btn').addEventListener('click', startCardStudy);
$('cards-study').addEventListener('keydown', event => {
  if (!studyDeck.length || event.target.matches('button, input, textarea, select')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    $('flip-card').click();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (studyIndex < studyDeck.length) studyIndex++;
    renderStudyCard();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    studyIndex = Math.max(0, studyIndex - 1);
    renderStudyCard();
  }
});
$('flip-card').addEventListener('click', () => {
  if (studyIndex >= studyDeck.length) return;
  studyFlipped = !studyFlipped;
  $('flip-card').classList.toggle('flipped', studyFlipped);
  $('flip-card').setAttribute('aria-pressed', String(studyFlipped));
  $('flip-card').setAttribute('aria-label', studyFlipped ? 'Answer shown. Press Space to show question.' : 'Question shown. Press Space to show answer.');
  $('flip-card').textContent = studyFlipped ? studyDeck[studyIndex].back : studyDeck[studyIndex].front;
});
$('card-got-it-btn').addEventListener('click', () => markStudyCard(true));
$('card-again-btn').addEventListener('click', () => markStudyCard(false));
$('card-study-exit-btn').addEventListener('click', () => {
  $('cards-study').classList.add('hidden');
  $('start-card-study-toolbar-btn').focus();
});
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
$('notes-sort').addEventListener('change', renderNotes);
$('note-title').addEventListener('input', renderNotePreview);
$('note-tag').addEventListener('input', renderNotePreview);
$('note-unit').addEventListener('input', renderNotePreview);
$('note-tags-input').addEventListener('input', renderNotePreview);
$('note-body').addEventListener('input', renderNotePreview);
$('notes-back-btn').addEventListener('click', () => {
  $('notes-workspace').classList.remove('mobile-detail-open');
  $('notes-back-btn').classList.add('hidden');
  $('notes-search').focus();
});
$('generate-notes-btn').addEventListener('click', generateNotesFromDocument);
$('export-notes-btn').addEventListener('click', () => downloadJSON(notes, 'margin-notes.json'));
$('import-notes-btn').addEventListener('click', () => $('import-notes-file').click());
$('import-notes-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
  if (Array.isArray(data)) {
    data.forEach(n => notes.push({ id: uid(), title: n.title || '', tag: n.tag || '', unit: n.unit || '', tags: normalizeNoteTags(n.tags), body: cleanNoteBody(n.body), aiGenerated: !!n.aiGenerated, createdAt: n.createdAt || Date.now(), updatedAt: n.updatedAt || Date.now() }));
    selectedNoteId = notes.at(-1)?.id || selectedNoteId;
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
$('classes-view-classes').addEventListener('click', () => {
  classesView = 'classes';
  renderClasses();
});
$('classes-view-assignments').addEventListener('click', () => {
  classesView = 'assignments';
  renderClasses();
});
$('classes-search').addEventListener('input', renderClasses);
$('calendar-prev-week').addEventListener('click', () => {
  calendarMonthOffset--;
  renderCalendar();
});
$('calendar-next-week').addEventListener('click', () => {
  calendarMonthOffset++;
  renderCalendar();
});
$('calendar-this-week').addEventListener('click', () => {
  calendarMonthOffset = 0;
  renderCalendar();
});
$('calendar-agenda-open').addEventListener('click', () => {
  $('calendar-agenda-dialog').showModal();
  renderCalendar();
});
$('calendar-agenda-close').addEventListener('click', () => $('calendar-agenda-dialog').close());
$('calendar-day-close').addEventListener('click', () => $('calendar-day-dialog').close());
$('calendar-day-dialog').addEventListener('click', event => {
  const button = event.target.closest('[data-edit-assignment]');
  if (!button) return;
  $('calendar-day-dialog').close();
  openAssignmentForm(button.dataset.editAssignment);
});
$('tutor-history-open').addEventListener('click', () => {
  historyPageIndex = 0;
  renderTutorHistory();
  $('tutor-history-dialog').showModal();
});
$('tutor-history-close').addEventListener('click', () => $('tutor-history-dialog').close());
$('reply-dialog-close').addEventListener('click', () => $('reply-dialog').close());
$('code-dialog-close').addEventListener('click', () => $('code-dialog').close());
$('quiz-mistakes-close').addEventListener('click', () => $('quiz-mistakes-dialog').close());
$('clear-chat-btn').addEventListener('click', () => {
  chatHistory = [];
  chatPageIndex = 0;
  historyPageIndex = 0;
  renderTutorChatPage();
  renderTutorOverview();
});
$('tutor-study-scope').addEventListener('change', () => {
  $('tutor-study-scope').setAttribute('aria-label', 'Study material scope');
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
  if (await idbGet(NOTE_CLEANUP_KEY) !== 1) {
    notes = notes.map(note => ({ ...note, body: cleanNoteBody(note.body) }));
    await idbSet('notes', notes);
    await idbSet(NOTE_CLEANUP_KEY, 1);
  }
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
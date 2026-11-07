import { state } from '../shared/state.js';
import { SIDEBAR_COLLAPSE_KEY } from '../shared/constants.js';

const $ = id => document.getElementById(id);
const MOBILE_MENU_QUERY = window.matchMedia('(max-width: 768px)');
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
const PAGE_PANEL_IDS = { assignments: 'classes', sessions: 'progress' };
let dependencies;

export function updatePageDate() {
  $('page-date').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());
}

export function closeMobileMenu(restoreFocus = true) {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
  $('sidebar-overlay').setAttribute('aria-hidden', 'true');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
  if (restoreFocus && MOBILE_MENU_QUERY.matches) $('menu-toggle').focus();
}

export function activatePage(page) {
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
    dependencies.renderClasses();
  }
  if (page === 'dashboard') dependencies.renderDashboard();
  if (panelId === 'progress') {
    dependencies.renderProgress();
    dependencies.loadProgressDeckStats();
  }
  if (page === 'tutor') dependencies.renderTutorOverview();
  if (page === 'calendar') dependencies.renderCalendar();
  if (page === 'classes') dependencies.renderClasses();
}

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

export function init(deps = {}) {
  dependencies = deps;
  $('reminders-bell').addEventListener('click', () => activatePage('calendar'));
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
    dependencies.setFlashcardsView(button.dataset.goFlashcards);
  }));
  document.addEventListener('click', event => {
    const prompt = event.target instanceof Element ? event.target.closest('.quick-prompt') : null;
    if (!prompt) return;
    $('chat-input').value = prompt.dataset.prompt;
    $('chat-input').dispatchEvent(new Event('input', { bubbles: true }));
    $('chat-input').focus();
  });
  updatePageDate();
  activatePage('dashboard');
}

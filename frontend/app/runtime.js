import { createApiClient } from '../services/api.js';
import { idbGet, idbSet } from '../services/storage.js';
import {
  calendarEventsForDate as collectCalendarEvents,
  getNextCalendarEvent as findNextCalendarEvent,
  localDateKey
} from '../features/calendar-data.js';
import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_LOCAL_SETTINGS,
  BACKUP_VERSION,
  mergeRecords,
  validateBackup
} from '../features/backup-data.js';
import { renderTutorMarkdown } from '../features/tutor-markdown.js';

const TUTOR_MATERIAL_KEY = 'studybuddy-tutor-material';
const NOTE_CLEANUP_KEY = 'studybuddy-note-cleanup-version';
const NOTES_NOTEBOOK_KEY = 'studybuddy-notes-active-notebook';
const NOTES_SELECTED_NOTE_KEY = 'studybuddy-notes-selected-note';
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REMINDERS_ENABLED_KEY = 'studybuddy-assignment-reminders';
const FLASHCARD_IMPORT_DONE_KEY = 'studybuddy-flashcards-neon-imported';
const FLASHCARD_VIEW_KEY = 'studybuddy-flashcards-active-view';
let documents = [];
let cards = [];
let decks = [];
let flashcardDueCount = 0;
let dashboardFlashcardStatus = 'loading';
let dashboardFlashcardError = '';
let currentFlashcardDeckFilter = 'all';
let flashcardPastedSource = '';
let flashcardSelectedSource = 'paste';
let notes = [];
let quizResults = [];
let timerSessions = [];
let progressDataLoading = true;
let progressDeckStatsRequest = 0;
let classes = [];
let assignments = [];
let activeSubject = 'all';
let showOriginalDocumentText = false;
let editingNoteId = null;
let editingCardId = null;
let currentPreviewDocId = null;
let chatHistory = [];
let tutorConversations = [];
let activeConversationId = null;
let studyDeck = [];
let studyDeckName = '';
let studyIndex = 0;
let studyFlipped = false;
let studySessionResults = { mastered: 0, review: 0 };
let currentQuiz = null;
let editingClassId = null;
let editingAssignmentId = null;
let reminderIntervalId = null;
let selectedNoteId = sessionStorage.getItem(NOTES_SELECTED_NOTE_KEY) || null;
let activeNotebookKey = sessionStorage.getItem(NOTES_NOTEBOOK_KEY) || '';
let noteAutosaveTimer = null;
let chatPending = false;
let chatAbortController = null;
let chatWakeTimer = 0;
let chatWakeMessage = '';
let chatStreamingReply = '';
let chatStreamingMessageElement = null;
let chatAtLatest = true;
let lastTutorQuestion = '';
let appInitialization = null;
let loginPending = false;
let learningPreviewCards = [];
let learningReviewCards = [];
let learningReviewIndex = 0;
let learningReviewDueCount = 0;
let learningReviewShownAt = 0;
let learningReviewGraded = false;
let learningReviewLoading = false;
let learningStatsLoading = false;
let studyMaterialIndex = new Map();
let calendarMonthOffset = 0;
let calendarSelectedDateKey = '';
let calendarView = 'month';
let classesView = 'classes';
let historyPageIndex = 0;
let documentPageIndex = 0;
let documentTextPages = [];
const fitPaginations = new Map();
const fitPaginationObservers = new Map();

function confirmDeletion({ title, description, affected = '', choices, bulk = false }) {
  const dialog = $('confirm-delete-dialog');
  const actions = $('confirm-delete-actions');
  const typing = $('confirm-delete-typing');
  const bulkControls = $('bulk-delete-confirm');
  $('confirm-delete-title').textContent = title;
  $('confirm-delete-description').textContent = description;
  $('confirm-delete-affected').textContent = affected;
  $('confirm-delete-affected').classList.toggle('hidden', !affected);
  bulkControls.classList.toggle('hidden', !bulk);
  typing.value = '';
  actions.replaceChildren();

  return new Promise(resolve => {
    let settled = false;
    const bulkButtons = [];
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      typing.oninput = null;
      dialog.close();
      resolve(value);
    };
    const onCancel = event => {
      event.preventDefault();
      finish(null);
    };
    const onClose = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finish(null));
    actions.append(cancel);
    (choices || [{ key: 'delete', label: 'Delete' }]).forEach(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn ${choice.danger === false ? 'btn-secondary' : 'btn-danger'}`;
      button.textContent = choice.label;
      button.disabled = bulk;
      button.addEventListener('click', () => finish(choice.key));
      actions.append(button);
      if (bulk) bulkButtons.push(button);
    });
    typing.oninput = () => bulkButtons.forEach(button => { button.disabled = typing.value !== 'DELETE'; });
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    $('confirm-delete-close').onclick = () => finish(null);
    $('export-backup-first').onclick = event => {
      event.preventDefault();
      $('export-all-data-btn').click();
    };
    dialog.showModal();
    cancel.focus();
  });
}

const undoableCollections = {
  get documents() { return documents; },
  set documents(value) { documents = value; },
  get cards() { return cards; },
  set cards(value) { cards = value; },
  get notes() { return notes; },
  set notes(value) { notes = value; },
  get quizResults() { return quizResults; },
  set quizResults(value) { quizResults = value; },
  get timerSessions() { return timerSessions; },
  set timerSessions(value) { timerSessions = value; },
  get classes() { return classes; },
  set classes(value) { classes = value; },
  get assignments() { return assignments; },
  set assignments(value) { assignments = value; },
  get tutorConversations() { return tutorConversations; },
  set tutorConversations(value) { tutorConversations = value; }
};
let deletedRecords = [];
const undoTimers = new Map();
const apiFetch = createApiClient({
  onUnauthorized: () => showLoginScreen('Session expired, please sign in again')
});

async function softDeleteRecords(changes, message, updates = []) {
  const snapshot = { id: uid(), entries: [], rollback: [], expiresAt: Date.now() + 8000 };
  updates.forEach(update => {
    const collection = undoableCollections[update.collection];
    if (!Array.isArray(collection)) throw new Error(`Unknown collection: ${update.collection}`);
    snapshot.rollback.push({ collection: update.collection, records: collection });
    undoableCollections[update.collection] = update.records;
    if (update.collection !== 'cards') idbSet(update.collection, update.records);
  });
  for (const change of changes) {
    const collection = undoableCollections[change.collection];
    if (!Array.isArray(collection)) throw new Error(`Unknown collection: ${change.collection}`);
    const removeIds = new Set(change.ids);
    const removed = collection.filter(record => removeIds.has(record.id));
    if (!removed.length) continue;
    if (change.collection === 'cards') {
      await Promise.all(removed.map(card => flashcardApi(`/api/cards/${encodeURIComponent(card.id)}`, undefined, 'DELETE')));
    }
    snapshot.entries.push({ collection: change.collection, records: removed });
    undoableCollections[change.collection] = collection.filter(record => !removeIds.has(record.id));
    if (change.collection !== 'cards') idbSet(change.collection, undoableCollections[change.collection]);
  }
  if (!snapshot.entries.length) return;
  if (snapshot.entries.some(entry => entry.collection === 'cards')) {
    try {
      await refreshFlashcardData(false);
    } catch (error) {
      setStatus('flashcards-storage-status', error.message || 'The deleted card count could not be refreshed.');
    }
  }
  deletedRecords.push(snapshot);
  await idbSet('deletedRecords', deletedRecords);
  showUndoToast(snapshot, message);
  renderEverything();
  undoTimers.set(snapshot.id, setTimeout(() => purgeUndoSnapshot(snapshot.id), 8000));
}

function showUndoToast(snapshot, message) {
  $('undo-toast-message').textContent = message;
  $('undo-toast').classList.remove('hidden');
  $('undo-toast-action').onclick = () => undoDelete(snapshot.id);
}

async function purgeUndoSnapshot(id) {
  const snapshot = deletedRecords.find(item => item.id === id);
  if (snapshot) {
    try {
      const deletedCards = snapshot.entries.find(entry => entry.collection === 'cards')?.records || [];
      await Promise.all(deletedCards.map(card => flashcardApi(
        `/api/cards/${encodeURIComponent(card.id)}?purge=true`,
        undefined,
        'DELETE'
      )));
    } catch (error) {
      console.error('Could not permanently delete flashcards', error);
      setStatus('flashcards-storage-status', error.message || 'A deleted flashcard could not be permanently removed yet.');
      snapshot.expiresAt = Date.now() + 8000;
      undoTimers.set(snapshot.id, setTimeout(() => purgeUndoSnapshot(snapshot.id), 8000));
      await idbSet('deletedRecords', deletedRecords);
      return;
    }
  }
  undoTimers.delete(id);
  deletedRecords = deletedRecords.filter(snapshot => snapshot.id !== id);
  await idbSet('deletedRecords', deletedRecords);
  if (deletedRecords.length) showUndoToast(deletedRecords.at(-1), 'An item was deleted.');
  else $('undo-toast').classList.add('hidden');
}

async function undoDelete(id) {
  const index = deletedRecords.findIndex(snapshot => snapshot.id === id);
  if (index < 0) return;
  const [snapshot] = deletedRecords.splice(index, 1);
  clearTimeout(undoTimers.get(id));
  undoTimers.delete(id);
  try {
    const deletedCards = snapshot.entries.find(entry => entry.collection === 'cards')?.records || [];
    await Promise.all(deletedCards.map(card => flashcardApi(
      `/api/cards/${encodeURIComponent(card.id)}/restore`,
      {},
      'POST'
    )));
  } catch (error) {
    deletedRecords.splice(index, 0, snapshot);
    console.error('Could not restore flashcards', error);
    setStatus('flashcards-storage-status', error.message || 'Could not undo the flashcard deletion.');
    return;
  }
  snapshot.entries.forEach(entry => {
    const current = undoableCollections[entry.collection];
    const existing = new Set(current.map(record => record.id));
    undoableCollections[entry.collection] = [...current, ...entry.records.filter(record => !existing.has(record.id))];
    if (entry.collection !== 'cards') idbSet(entry.collection, undoableCollections[entry.collection]);
  });
  snapshot.rollback?.forEach(entry => {
    undoableCollections[entry.collection] = entry.records;
    if (entry.collection !== 'cards') idbSet(entry.collection, entry.records);
  });
  if (snapshot.entries.some(entry => entry.collection === 'cards')) {
    try {
      await refreshFlashcardData(false);
    } catch (error) {
      setStatus('flashcards-storage-status', error.message || 'The restored card count could not be refreshed.');
    }
  }
  await idbSet('deletedRecords', deletedRecords);
  renderEverything();
  if (deletedRecords.length) showUndoToast(deletedRecords.at(-1), 'An item was deleted.');
  else $('undo-toast').classList.add('hidden');
}

function confirmBulkDeletion(description) {
  return confirmDeletion({
    title: 'Confirm bulk deletion',
    description,
    affected: 'This action cannot be undone. Export a backup first if you may need these records.',
    bulk: true
  });
}

function changeDocumentPage(index) {
  documentPageIndex = Math.max(0, Math.min(Number(index) || 0, documentTextPages.length - 1));
  renderDocumentPage();
}

const $ = id => document.getElementById(id);
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
const customSelects = new WeakMap();
let activeCustomSelect = null;
let selectTypeahead = '';
let selectTypeaheadTimer = 0;

function selectAccessibleName(select, trigger) {
  if (select.getAttribute('aria-label')) return select.getAttribute('aria-label');
  const label = select.labels?.[0];
  if (label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('select, .custom-select-wrap').forEach(element => element.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }
  return trigger.textContent.trim() || 'Choose an option';
}

function syncCustomSelect(select) {
  const state = customSelects.get(select);
  if (!state) return;
  const selected = select.selectedOptions[0];
  state.value.textContent = selected?.label || selected?.textContent || 'Select';
  state.trigger.disabled = select.disabled;
  state.trigger.setAttribute('aria-label', selectAccessibleName(select, state.trigger));
  state.trigger.setAttribute('aria-expanded', String(state.popover.classList.contains('open')));
  state.trigger.setAttribute('aria-controls', state.list.id);
  state.trigger.setAttribute('aria-haspopup', 'listbox');
  state.trigger.setAttribute('role', 'combobox');
  renderCustomSelectOptions(select);
}

function renderCustomSelectOptions(select) {
  const state = customSelects.get(select);
  if (!state) return;
  const options = [...select.options];
  state.list.replaceChildren();
  state.searchWrap.hidden = options.length <= 8;
  const fragment = document.createDocumentFragment();
  options.forEach((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.id = `${state.list.id}-option-${index}`;
    item.className = 'custom-select-option';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    item.setAttribute('aria-disabled', String(option.disabled));
    item.tabIndex = -1;
    item.disabled = option.disabled;
    item.dataset.optionIndex = String(index);
    item.textContent = option.label || option.textContent;
    item.addEventListener('click', () => {
      if (option.disabled) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncCustomSelect(select);
      closeCustomSelect(state, true);
    });
    fragment.append(item);
  });
  state.list.append(fragment);
  state.empty.hidden = options.length > 0;
  const query = state.search.value.trim().toLocaleLowerCase();
  if (query) filterCustomSelectOptions(state);
}

function filterCustomSelectOptions(state) {
  const query = state.search.value.trim().toLocaleLowerCase();
  let visibleCount = 0;
  state.list.querySelectorAll('[role="option"]').forEach(option => {
    const visible = option.textContent.toLocaleLowerCase().includes(query);
    option.hidden = !visible;
    if (visible) visibleCount++;
  });
  state.empty.hidden = visibleCount > 0;
}

function positionCustomSelect(state) {
  const bounds = state.trigger.getBoundingClientRect();
  const margin = 8;
  const below = window.innerHeight - bounds.bottom;
  const above = bounds.top;
  const maxHeight = Math.min(360, window.innerHeight - margin * 2);
  const openAbove = below < Math.min(240, maxHeight) && above > below;
  state.popover.style.maxHeight = `${maxHeight}px`;
  state.popover.style.width = `${Math.max(180, bounds.width)}px`;
  state.popover.style.left = `${Math.min(Math.max(margin, bounds.left), window.innerWidth - Math.max(180, bounds.width) - margin)}px`;
  state.popover.style.top = openAbove
    ? `${Math.max(margin, bounds.top - Math.min(state.popover.offsetHeight, above - margin))}px`
    : `${Math.min(window.innerHeight - margin - state.popover.offsetHeight, bounds.bottom)}px`;
}

function closeCustomSelect(state, restoreFocus = false) {
  state.popover.classList.remove('open');
  state.popover.setAttribute('aria-hidden', 'true');
  state.trigger.setAttribute('aria-expanded', 'false');
  if (activeCustomSelect === state) activeCustomSelect = null;
  if (restoreFocus) state.trigger.focus();
}

function openCustomSelect(state) {
  if (activeCustomSelect && activeCustomSelect !== state) closeCustomSelect(activeCustomSelect);
  activeCustomSelect = state;
  syncCustomSelect(state.select);
  state.search.value = '';
  filterCustomSelectOptions(state);
  state.popover.classList.add('open');
  state.popover.setAttribute('aria-hidden', 'false');
  state.trigger.setAttribute('aria-expanded', 'true');
  positionCustomSelect(state);
  const selectedIndex = state.select.selectedIndex;
  const selectedOption = state.list.querySelector(`[data-option-index="${selectedIndex}"]`);
  const firstOption = state.list.querySelector('[role="option"]:not([hidden]):not(:disabled)');
  const active = selectedOption && !selectedOption.hidden && !selectedOption.disabled ? selectedOption : firstOption;
  active?.classList.add('active');
  if (state.searchWrap.hidden) active?.focus();
  else state.search.focus();
}

function moveCustomSelectFocus(state, direction) {
  const options = [...state.list.querySelectorAll('[role="option"]:not([hidden]):not(:disabled)')];
  if (!options.length) return;
  const current = options.indexOf(document.activeElement);
  const next = current < 0
    ? Math.max(0, options.findIndex(option => option.getAttribute('aria-selected') === 'true'))
    : (current + direction + options.length) % options.length;
  options.forEach(option => option.classList.toggle('active', options[next] === option));
  options[next].focus();
  options[next].scrollIntoView({ block: 'nearest' });
}

function handleCustomSelectKeydown(state, event) {
  const { key } = event;
  if (key === 'Escape') {
    event.preventDefault();
    closeCustomSelect(state, true);
    return;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    if (!state.popover.classList.contains('open')) {
      openCustomSelect(state);
      return;
    }
    moveCustomSelectFocus(state, key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (key === 'Home' || key === 'End') {
    if (!state.popover.classList.contains('open')) return;
    event.preventDefault();
    const options = [...state.list.querySelectorAll('[role="option"]:not([hidden]):not(:disabled)')];
    const target = key === 'Home' ? options[0] : options.at(-1);
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (key === 'Enter' || key === ' ') {
    if (!state.popover.classList.contains('open')) {
      event.preventDefault();
      openCustomSelect(state);
    } else if (event.target.matches('[role="option"]')) {
      event.preventDefault();
      event.target.click();
    } else if (key === 'Enter') {
      const active = state.list.querySelector('.active:not([hidden]):not(:disabled)');
      if (active) {
        event.preventDefault();
        active.click();
      }
    }
    return;
  }
  if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!state.popover.classList.contains('open')) openCustomSelect(state);
    if (!state.searchWrap.hidden) {
      if (event.target !== state.search) {
        event.preventDefault();
        state.search.value = key;
        filterCustomSelectOptions(state);
        state.search.focus();
      }
      return;
    }
    selectTypeahead += key.toLocaleLowerCase();
    clearTimeout(selectTypeaheadTimer);
    selectTypeaheadTimer = setTimeout(() => { selectTypeahead = ''; }, 700);
    const options = [...state.list.querySelectorAll('[role="option"]:not(:disabled)')];
    const activeIndex = options.indexOf(document.activeElement);
    const start = activeIndex < 0 ? 0 : activeIndex + 1;
    const ordered = [...options.slice(start), ...options.slice(0, start)];
    const match = ordered.find(option => option.textContent.trim().toLocaleLowerCase().startsWith(selectTypeahead));
    if (match) {
      state.list.querySelectorAll('.active').forEach(option => option.classList.remove('active'));
      match.classList.add('active');
      match.focus();
      match.scrollIntoView({ block: 'nearest' });
    }
  }
}

function enhanceSelect(select) {
  if (customSelects.has(select)) return;
  const wrap = document.createElement('span');
  wrap.className = `custom-select-wrap ${[...select.classList].join(' ')}`.trim();
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  const value = document.createElement('span');
  value.className = 'custom-select-value';
  const chevron = document.createElement('span');
  chevron.className = 'custom-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';
  trigger.append(value, chevron);
  const popover = document.createElement('div');
  popover.className = 'custom-select-popover';
  popover.setAttribute('aria-hidden', 'true');
  const searchWrap = document.createElement('div');
  searchWrap.className = 'custom-select-search-wrap';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'custom-select-search';
  search.placeholder = 'Search options';
  search.setAttribute('aria-label', 'Search dropdown options');
  const list = document.createElement('div');
  list.className = 'custom-select-list';
  list.id = `custom-select-list-${uid()}`;
  list.setAttribute('role', 'listbox');
  const empty = document.createElement('p');
  empty.className = 'custom-select-empty';
  empty.textContent = 'No matching options';
  empty.hidden = true;
  searchWrap.append(search);
  popover.append(searchWrap, list, empty);
  const state = { select, wrap, trigger, value, popover, searchWrap, search, list, empty };
  customSelects.set(select, state);
  select.parentNode.insertBefore(wrap, select.nextSibling);
  wrap.append(trigger);
  (select.closest('dialog') || document.body).append(popover);
  select.classList.add('custom-select-native');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  trigger.addEventListener('click', () => {
    if (popover.classList.contains('open')) closeCustomSelect(state);
    else openCustomSelect(state);
  });
  trigger.addEventListener('keydown', event => handleCustomSelectKeydown(state, event));
  list.addEventListener('keydown', event => handleCustomSelectKeydown(state, event));
  search.addEventListener('input', () => {
    filterCustomSelectOptions(state);
    const first = list.querySelector('[role="option"]:not([hidden]):not(:disabled)');
    list.querySelectorAll('.active').forEach(option => option.classList.remove('active'));
    first?.classList.add('active');
  });
  search.addEventListener('keydown', event => handleCustomSelectKeydown(state, event));
  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'value'] });
  state.observer = observer;
  syncCustomSelect(select);
}

function initializeCustomControls() {
  document.querySelectorAll('select').forEach(enhanceSelect);
  const switchIds = ['calendar-reminders-enabled', 'tutor-use-material', 'settings-tutor-material', 'timer-sound-enabled', 'timer-notification-enabled'];
  switchIds.forEach(id => {
    const input = $(id);
    if (!input) return;
    const label = input.closest('label');
    if (!label || input.classList.contains('app-switch-input')) return;
    input.classList.add('app-switch-input');
    input.setAttribute('role', 'switch');
    const track = document.createElement('span');
    track.className = 'app-switch-track';
    track.setAttribute('aria-hidden', 'true');
    input.after(track);
    label.classList.add('app-switch-label');
    const sync = () => input.setAttribute('aria-checked', String(input.checked));
    input.addEventListener('change', sync);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    sync();
  });
  document.addEventListener('pointerdown', event => {
    if (activeCustomSelect && !activeCustomSelect.popover.contains(event.target) && !activeCustomSelect.wrap.contains(event.target)) {
      closeCustomSelect(activeCustomSelect);
    }
  });
  window.addEventListener('resize', () => {
    if (activeCustomSelect) positionCustomSelect(activeCustomSelect);
  });
  window.addEventListener('scroll', () => {
    if (activeCustomSelect) positionCustomSelect(activeCustomSelect);
  }, true);
}

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
  if (!appInitialization) {
    appInitialization = init().catch(error => {
      appInitialization = null;
      console.error('StudyBuddy could not initialize after sign-in.', error);
      showLoginScreen('Could not load your study desk. Please sign in again.');
    });
  }
  return appInitialization;
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
  if (loginPending) return;
  loginPending = true;
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
    loginPending = false;
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
  idbSet('documents', documents);
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
const THEME_KEY = 'studybuddy-theme';
const SIDEBAR_COLLAPSE_KEY = 'studybuddy-sidebar-collapsed';
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
    classes.filter(item => Array.isArray(item.meetingDays)
      && item.meetingDays.some(day => Number(day) === now.getDay()))
      .forEach(item => priorities.push({
        kind: 'Class',
        time: item.startTime || 'Today',
        title: item.name || 'Class meeting',
        detail: item.location || item.instructor || 'Class meeting',
        sortKey: item.startTime || '99:99'
      }));
    assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
      && Number(assignment.dueAt) < todayStart.getTime())
      .forEach(assignment => priorities.push({
        kind: 'Overdue',
        time: 'Overdue',
        title: assignment.title || 'Untitled assignment',
        detail: classForAssignment(assignment)?.name || 'General',
        assignmentId: assignment.id,
        sortKey: '00:00'
      }));
    assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
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
      classes.filter(item => Array.isArray(item.meetingDays)
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
    assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
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
      ...timerSessions.map(session => ({
        timestamp: Number(session.completedAt),
        title: `${session.course || 'General'}${session.unit ? ` · ${session.unit}` : ''}`,
        detail: `${Math.max(1, Math.round((Number(session.seconds) || 0) / 60))} min focus session`,
        kind: 'Focus'
      })),
      ...documents.filter(documentItem => Number(documentItem.lastOpened) > 0).map(documentItem => ({
        timestamp: Number(documentItem.lastOpened),
        title: documentItem.title || 'Untitled document',
        detail: `${documentItem.course || 'General'} · opened document`,
        kind: 'Reading'
      })),
      ...quizResults.map(result => ({
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
    const latestDocument = documents.filter(item => Number(item.readingProgress) < 100)
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
    if (dashboardFlashcardStatus === 'loading') return { state: 'loading', message: 'Checking what is ready to study…' };
    if (dashboardFlashcardStatus === 'error') return { state: 'error', message: `Learning recommendations are unavailable: ${dashboardFlashcardError}` };
    if (flashcardDueCount > 0) {
      return {
        html: `<article class="dashboard-continue-card">
          <span class="dashboard-item-kind">Flashcards</span>
          <h3>Keep your knowledge fresh</h3>
          <p>${flashcardDueCount} ${flashcardDueCount === 1 ? 'card is' : 'cards are'} ready to review.</p>
          <button class="btn btn-primary" type="button" id="dashboard-continue-button" data-review-cards>Review flashcards</button>
        </article>`
      };
    }
    return { state: 'empty' };
  });

  renderDashboardSection('progress', () => {
    const rows = [];
    if (documents.length) {
      const average = documents.reduce((sum, item) => sum + Math.max(0, Math.min(100, Number(item.readingProgress) || 0)), 0) / documents.length;
      rows.push(dashboardProgressRow('Reading', average, `${documents.filter(item => Number(item.readingProgress) >= 100).length} of ${documents.length} documents completed`));
    }
    if (cards.length) {
      const mastered = cards.filter(card => card.mastered).length;
      rows.push(dashboardProgressRow('Flashcards', mastered / cards.length * 100, `${mastered} of ${cards.length} cards mastered`));
    }
    if (quizResults.length) {
      const average = quizResults.reduce((sum, result) => sum + (Number(result.score) || 0), 0) / quizResults.length;
      rows.push(dashboardProgressRow('Quiz average', average, `${quizResults.length} ${quizResults.length === 1 ? 'attempt' : 'attempts'}`));
    }
    if (!rows.length) return { state: 'empty' };
    return { html: rows.join('') };
  });

  renderDashboardSection('revision', () => {
    if (dashboardFlashcardStatus === 'loading') return { state: 'loading' };
    if (dashboardFlashcardStatus === 'error') return { state: 'error', message: `Flashcard reminders are unavailable: ${dashboardFlashcardError}` };
    if (!flashcardDueCount) return { state: 'empty' };
    return {
      html: `<div class="dashboard-reminder-count">${flashcardDueCount}</div>
        <p>${flashcardDueCount === 1 ? 'flashcard is' : 'flashcards are'} due for review.</p>
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
    classesView = page === 'assignments' ? 'assignments' : 'classes';
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

function dateTimeInputValue(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
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

function cardFontSize(text) {
  return `${Math.max(12, Math.min(20, 20 - Math.floor(String(text || '').length / 90)))}px`;
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
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
  container.querySelectorAll('[data-delete-assignment]').forEach(button => button.addEventListener('click', async () => {
    const assignment = assignments.find(item => item.id === button.dataset.deleteAssignment);
    if (!assignment) return;
    const confirmed = await confirmDeletion({
      title: 'Delete assignment?',
      description: `Delete "${assignment.title}"?`,
      affected: 'The assignment will be removed from its class and calendar views.'
    });
    if (confirmed) await softDeleteRecords([{ collection: 'assignments', ids: [assignment.id] }], 'Assignment deleted.');
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
    list.querySelectorAll('[data-delete-class]').forEach(button => button.addEventListener('click', async () => {
      const item = classes.find(course => course.id === button.dataset.deleteClass);
      if (!item) return;
      const linked = assignments.filter(assignment => assignment.classId === item.id);
      const choice = await confirmDeletion({
        title: `Delete class "${item.name}"?`,
        description: linked.length
          ? `This class has ${linked.length} linked ${linked.length === 1 ? 'assignment' : 'assignments'}.`
          : 'This class has no linked assignments.',
        affected: linked.length ? 'Choose whether its assignments should remain in your list without a class or be deleted too.' : '',
        choices: linked.length
          ? [
            { key: 'keep', label: 'Delete class only' },
            { key: 'all', label: `Delete class and ${linked.length} assignments` }
          ]
          : [{ key: 'all', label: 'Delete class' }]
      });
      if (!choice) return;
      const updates = choice === 'keep'
        ? [{ collection: 'assignments', records: assignments.map(assignment => assignment.classId === item.id ? { ...assignment, classId: '' } : assignment) }]
        : [];
      const changes = [{ collection: 'classes', ids: [item.id] }];
      if (choice === 'all' && linked.length) changes.push({ collection: 'assignments', ids: linked.map(assignment => assignment.id) });
      await softDeleteRecords(changes, 'Class deleted.', updates);
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
  if (!calendarSelectedDateKey) calendarSelectedDateKey = localDateKey(new Date());
  const selectedDate = new Date(`${calendarSelectedDateKey}T12:00:00`);
  const todayKey = localDateKey(new Date());
  const selectedMonth = new Date();
  selectedMonth.setDate(1);
  selectedMonth.setMonth(selectedMonth.getMonth() + calendarMonthOffset);
  const weekdays = $('calendar-weekdays');
  const renderWeekdayLabels = (firstDate, count = 7) => {
    weekdays.innerHTML = Array.from({ length: count }, (_, index) => {
      const date = new Date(firstDate);
      date.setDate(date.getDate() + index);
      const label = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
      return `<span>${escapeHtml(label)}</span>`;
    }).join('');
  };
  const viewButtons = document.querySelectorAll('[data-calendar-view]');
  viewButtons.forEach(button => {
    const active = button.dataset.calendarView === calendarView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  week.dataset.view = calendarView;
  weekdays.classList.toggle('hidden', calendarView === 'year' || calendarView === 'day');
  weekdays.style.gridTemplateColumns = calendarView === 'day' ? '1fr' : '';
  week.style.gridTemplateRows = '';
  $('calendar-selected-title').textContent = formatCalendarHeading(selectedDate);
  const nextEvent = getNextCalendarEvent(new Date());
  $('calendar-next-event').textContent = nextEvent
    ? `${nextEvent.type === 'class' ? 'Class' : 'Assignment'} · ${nextEvent.title} · ${nextEvent.when}`
    : 'No upcoming events scheduled.';
  week.setAttribute('aria-label', `${calendarView[0].toUpperCase()}${calendarView.slice(1)} schedule`);

  if (calendarView === 'year') {
    const year = selectedDate.getFullYear();
    $('calendar-range').textContent = String(year);
    week.innerHTML = Array.from({ length: 12 }, (_, monthIndex) => {
      const monthDate = new Date(year, monthIndex, 1, 12);
      const monthStart = new Date(year, monthIndex, 1, 12);
      monthStart.setDate(monthStart.getDate() - monthStart.getDay());
      const days = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(monthStart);
        date.setDate(monthStart.getDate() + index);
        const dateKey = localDateKey(date);
        const outsideMonth = date.getMonth() !== monthIndex;
        const hasEvents = calendarEventsForDate(date).length > 0;
        return `<button type="button" class="calendar-year-date ${outsideMonth ? 'outside-month' : ''} ${dateKey === todayKey ? 'is-today' : ''} ${dateKey === calendarSelectedDateKey ? 'is-selected' : ''} ${hasEvents ? 'has-events' : ''}" data-calendar-date="${dateKey}" aria-label="${escapeHtml(formatCalendarHeading(date))}${hasEvents ? ', events scheduled' : ''}">${date.getDate()}</button>`;
      }).join('');
      return `<section class="calendar-year-month"><h3>${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'long' }).format(monthDate))}</h3><div class="calendar-year-weekdays" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-year-dates">${days}</div></section>`;
    }).join('');
  } else {
    let startDate;
    let daysToRender;
    if (calendarView === 'day') {
      startDate = new Date(selectedDate);
      daysToRender = 1;
      $('calendar-range').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(selectedDate);
    } else if (calendarView === 'week') {
      startDate = new Date(selectedDate);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      daysToRender = 7;
      renderWeekdayLabels(startDate);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      $('calendar-range').textContent = `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(startDate)} – ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(endDate)}`;
    } else {
      startDate = new Date(selectedMonth);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      renderWeekdayLabels(startDate);
      const daysInMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
      daysToRender = Math.ceil((selectedMonth.getDay() + daysInMonth) / 7) * 7;
      week.style.gridTemplateRows = `repeat(${daysToRender / 7}, minmax(0, 1fr))`;
      $('calendar-range').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selectedMonth);
    }
    week.innerHTML = Array.from({ length: daysToRender }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const dateKey = localDateKey(date);
      const events = calendarEventsForDate(date);
      const visibleLimit = calendarView === 'month' ? 4 : 12;
      const outsideMonth = calendarView === 'month' && date.getMonth() !== selectedMonth.getMonth();
      const dayClasses = [
        'calendar-day',
        dateKey === todayKey ? 'is-today' : '',
        dateKey === calendarSelectedDateKey ? 'is-selected' : '',
        outsideMonth ? 'outside-month' : ''
      ].filter(Boolean).join(' ');
      const chips = events.slice(0, visibleLimit).map(event => calendarEventMarkup(event, dateKey)).join('');
      const more = events.length > visibleLimit
        ? `<button type="button" class="calendar-more-events" data-calendar-more="${dateKey}" aria-label="View ${events.length - visibleLimit} more events">+${events.length - visibleLimit}</button>`
        : '';
      return `<article class="${dayClasses}" data-calendar-cell="${dateKey}">
        <div class="calendar-day-header">
          <button type="button" class="calendar-date-number" data-calendar-date="${dateKey}" aria-label="Open ${escapeHtml(formatCalendarHeading(date))}">${date.getDate()}</button>
          ${more}
        </div>
        <div class="calendar-day-events" data-event-count="${events.length}">${chips}</div>
      </article>`;
    }).join('');
  }
  week.querySelectorAll('[data-edit-assignment]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openAssignmentForm(button.dataset.editAssignment);
  }));
  week.querySelectorAll('[data-calendar-more]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openCalendarDay(button.dataset.calendarMore);
  }));
  week.querySelectorAll('[data-calendar-date]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (calendarView === 'year') {
      calendarSelectedDateKey = button.dataset.calendarDate;
      const selectedYearDate = new Date(`${calendarSelectedDateKey}T12:00:00`);
      const currentMonth = new Date();
      calendarMonthOffset = (selectedYearDate.getFullYear() - currentMonth.getFullYear()) * 12
        + selectedYearDate.getMonth() - currentMonth.getMonth();
      calendarView = 'month';
      renderCalendar();
      return;
    }
    openCalendarDay(button.dataset.calendarDate);
  }));
  week.querySelectorAll('[data-calendar-cell]').forEach(cell => cell.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    openCalendarDay(cell.dataset.calendarCell);
  }));
  const upcoming = assignments.filter(assignment => !assignment.completed).sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  const container = $('calendar-assignment-list');
  container.innerHTML = upcoming.length
    ? upcoming.map(assignmentMarkup).join('')
    : '<div class="empty-state">You are all caught up. Add an assignment to see it on your calendar.</div>';
  bindAssignmentActions(container);
  paginateToFit(container, { label: 'Upcoming assignment pages', itemHeight: 100 });
  syncReminderControls();
}

function shiftCalendarPeriod(direction) {
  const selectedDate = new Date(`${calendarSelectedDateKey || localDateKey(new Date())}T12:00:00`);
  if (calendarView === 'day' || calendarView === 'week') {
    selectedDate.setDate(selectedDate.getDate() + direction * (calendarView === 'week' ? 7 : 1));
  } else {
    const monthDelta = direction * (calendarView === 'year' ? 12 : 1);
    const day = selectedDate.getDate();
    selectedDate.setDate(1);
    selectedDate.setMonth(selectedDate.getMonth() + monthDelta);
    const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    selectedDate.setDate(Math.min(day, lastDay));
  }
  calendarSelectedDateKey = localDateKey(selectedDate);
  const currentMonth = new Date();
  calendarMonthOffset = (selectedDate.getFullYear() - currentMonth.getFullYear()) * 12
    + selectedDate.getMonth() - currentMonth.getMonth();
  renderCalendar();
}

function formatCalendarHeading(date) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
  const day = date.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return `${weekday}, ${month} ${day}${suffix}`;
}

function calendarEventsForDate(date) {
  return collectCalendarEvents(date, classes, assignments);
}

function getNextCalendarEvent(fromDate) {
  return findNextCalendarEvent(fromDate, classes, assignments);
}

function calendarEventMarkup(event, dateKey) {
  const upcoming = event.type === 'assignment' && !event.completed && !event.past;
  const className = `calendar-event ${event.type}-event ${upcoming ? 'is-upcoming' : ''} ${event.completed || event.past ? 'is-muted' : ''}`.trim();
  if (event.type === 'assignment') {
    return `<button type="button" class="${className}" data-edit-assignment="${escapeHtml(event.id)}" aria-label="Edit ${escapeHtml(event.title)}"><span class="calendar-event-kind">${event.completed ? 'Completed' : 'Assignment'}</span><strong>${escapeHtml(event.title)}</strong><span class="calendar-event-time">${escapeHtml(event.detail)}</span></button>`;
  }
  return `<button type="button" class="${className}" data-calendar-more="${dateKey}" aria-label="View ${escapeHtml(event.title)}"><span class="calendar-event-kind">Class</span><strong>${escapeHtml(event.title)}</strong>${event.detail ? `<span class="calendar-event-time">${escapeHtml(event.detail)}</span>` : ''}</button>`;
}

function openCalendarDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  calendarSelectedDateKey = dateKey;
  const selectedMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const currentMonth = new Date();
  calendarMonthOffset = (selectedMonth.getFullYear() - currentMonth.getFullYear()) * 12
    + selectedMonth.getMonth() - currentMonth.getMonth();
  renderCalendar();
  const events = calendarEventsForDate(date).map(event => event.type === 'assignment'
    ? `<article class="calendar-event assignment-event ${event.completed ? 'is-muted' : ''}"><strong>${escapeHtml(event.title)}</strong><time>${escapeHtml(formatDueDate(Number(assignments.find(item => item.id === event.id)?.dueAt)))}</time><button type="button" data-edit-assignment="${escapeHtml(event.id)}">Edit assignment</button></article>`
    : `<article class="calendar-event class-event"><strong>${escapeHtml(event.title)}</strong><time>${escapeHtml(event.detail || 'Class')}</time></article>`);
  $('calendar-day-title').textContent = formatCalendarHeading(date);
  $('calendar-day-events').innerHTML = events.join('') || '<p>No events scheduled.</p>';
  $('calendar-day-add').dataset.calendarAddDate = dateKey;
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

function openAssignmentForm(id = null, classId = '', dueAt = null) {
  const assignment = assignments.find(item => item.id === id);
  editingAssignmentId = assignment?.id || null;
  $('assignment-dialog-title').textContent = assignment ? 'Edit assignment' : 'Add an assignment';
  $('save-assignment-btn').textContent = assignment ? 'Save changes' : 'Save assignment';
  $('assignment-title').value = assignment?.title || '';
  $('assignment-details').value = assignment?.details || '';
  $('assignment-due').value = dateTimeInputValue(assignment
    ? Number(assignment.dueAt)
    : dueAt == null ? NaN : Number(dueAt));
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
  list.querySelectorAll('[data-delete-doc]').forEach(btn => btn.addEventListener('click', async () => {
    const doc = documents.find(item => item.id === btn.dataset.deleteDoc);
    if (!doc) return;
    const linked = cards.filter(card => card.sourceDocumentId === doc.id);
    const choice = await confirmDeletion({
      title: `Delete document "${doc.title}"?`,
      description: 'The extracted text and reading progress for this document will be removed.',
      affected: linked.length ? `${linked.length} flashcard${linked.length === 1 ? '' : 's'} reference this document. Choose whether to keep or delete them.` : '',
      choices: linked.length
        ? [
          { key: 'document', label: 'Delete document only' },
          { key: 'all', label: `Delete document and ${linked.length} cards` }
        ]
        : [{ key: 'document', label: 'Delete document' }]
    });
    if (!choice) return;
    if (currentPreviewDocId === doc.id) currentPreviewDocId = null;
    const changes = [{ collection: 'documents', ids: [doc.id] }];
    if (choice === 'all') changes.push({ collection: 'cards', ids: linked.map(card => card.id) });
    await softDeleteRecords(changes, 'Document deleted.');
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
  const options = ['<option value="all">All material</option>'];
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
    avatar.textContent = 'S';
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
      notes.push({
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
      selectedNoteId = notes.at(-1).id;
      activeNotebookKey = noteNotebookKey(notes.at(-1));
      persistNotesReaderPosition();
      await idbSet('notes', notes);
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
      const saved = chatHistory.find(item => item.timestamp === messageData.timestamp);
      if (saved) saved.feedback = saved.feedback === 'up' ? '' : 'up';
      await persistTutorConversations();
      renderTutorChatPage();
    }],
    ['Not helpful', '👎', async () => {
      const saved = chatHistory.find(item => item.timestamp === messageData.timestamp);
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
  chatStreamingMessageElement = null;
  const latestAssistantIndex = chatHistory.reduce((latest, message, index) =>
    message.role === 'assistant' && !message.retry ? index : latest, -1);
  chatHistory.forEach((message, index) => {
    if (message.role === 'assistant') {
      addAssistantMsg(message.content, message.sources || [], log, {
        ...message,
        isLatest: index === latestAssistantIndex
      });
    } else {
      addMsg('user', message.content, log, message);
    }
  });
  if (!chatHistory.length) {
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
  if (chatPending && chatHistory.at(-1)?.role === 'user') {
    const loading = addMsg('assistant', chatStreamingReply, log);
    chatStreamingMessageElement = loading;
    if (!chatStreamingReply) loading.classList.add('loading');
    if (!chatStreamingReply) {
      const indicator = document.createElement('div');
      indicator.className = 'assistant-content loading-content';
      indicator.innerHTML = '<span class="typing-indicator" aria-label="Tutor is thinking"><i></i><i></i><i></i></span>';
      loading.insertBefore(indicator, loading.querySelector('.msg-time'));
    }
    if (chatWakeMessage) {
      const wakeMessage = document.createElement('span');
      wakeMessage.className = 'chat-wake-message';
      wakeMessage.textContent = chatWakeMessage;
      const content = loading.querySelector('.assistant-content');
      if (content) content.appendChild(wakeMessage);
      else loading.insertBefore(wakeMessage, loading.querySelector('.msg-time'));
    }
  }
  const title = tutorConversations.find(item => item.id === activeConversationId)?.title || 'New chat';
  $('tutor-conversation-title').value = title;
  const note = $('chat-log').querySelector('.chat-material-note');
  if (note) note.textContent = $('tutor-use-material').checked
    ? 'Study material is on. Relevant excerpts may be sent with your question.'
    : 'Study material is off. Your questions are sent without local excerpts.';
  updateTutorConnectionStatus();
  $('chat-jump-latest').classList.toggle('hidden', chatAtLatest || chatHistory.length === 0);
  requestAnimationFrame(() => {
    if (chatAtLatest) log.scrollTop = log.scrollHeight;
    else log.scrollTop = previousScrollTop;
  });
}

function updateTutorStreamingReply(text) {
  chatStreamingReply = text;
  if (!chatStreamingMessageElement?.isConnected) {
    renderTutorChatPage();
    return;
  }

  const message = chatStreamingMessageElement;
  const content = message.querySelector('.assistant-content');
  if (text) {
    message.classList.remove('loading');
    const renderedContent = content || document.createElement('div');
    renderedContent.className = 'assistant-content';
    renderedContent.innerHTML = renderTutorMarkdown(text);
    if (!content) message.insertBefore(renderedContent, message.querySelector('.msg-time'));
    bindMarkdownCodeButtons(renderedContent, { truncateLongCode: false });
    renderMathInElementSafe(renderedContent);
    if (chatWakeMessage) {
      const wakeMessage = document.createElement('span');
      wakeMessage.className = 'chat-wake-message';
      wakeMessage.textContent = chatWakeMessage;
      renderedContent.append(wakeMessage);
    }
  }
  requestAnimationFrame(() => {
    if (chatAtLatest) $('chat-log').scrollTop = $('chat-log').scrollHeight;
  });
}

function renderTutorHistory() {
  const content = $('tutor-history-content');
  const query = $('tutor-history-search').value.trim().toLocaleLowerCase();
  const filtered = tutorConversations.filter(conversation =>
    `${conversation.title || ''} ${conversation.messages.map(message => message.content || '').join(' ')}`
      .toLocaleLowerCase().includes(query));
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  historyPageIndex = Math.max(0, Math.min(historyPageIndex, pageCount - 1));
  content.replaceChildren();
  const pageConversations = filtered
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(historyPageIndex * pageSize, (historyPageIndex + 1) * pageSize);
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
  controls.innerHTML = `<button type="button" class="btn btn-sm" data-history-prev ${historyPageIndex === 0 ? 'disabled' : ''}>Previous</button><span aria-live="polite">Page ${historyPageIndex + 1} of ${pageCount}</span><button type="button" class="btn btn-sm" data-history-next ${historyPageIndex >= pageCount - 1 ? 'disabled' : ''}>Next</button>`;
  controls.querySelector('[data-history-prev]').addEventListener('click', () => { historyPageIndex--; renderTutorHistory(); });
  controls.querySelector('[data-history-next]').addEventListener('click', () => { historyPageIndex++; renderTutorHistory(); });
  if (!filtered.length) {
    content.innerHTML = `<p class="hint">${tutorConversations.length ? 'No conversations match your search.' : 'No conversations yet. Start a new chat to begin.'}</p>`;
    controls.classList.add('hidden');
  } else {
    controls.classList.remove('hidden');
  }
}

function createTutorConversation() {
  const conversation = { id: uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  tutorConversations.push(conversation);
  activeConversationId = conversation.id;
  chatHistory = conversation.messages;
  localStorage.setItem('studybuddy-active-conversation', activeConversationId);
  persistTutorConversations();
  chatAtLatest = true;
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
  const conversation = tutorConversations.find(item => item.id === activeConversationId);
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
  const active = tutorConversations.find(item => item.id === activeConversationId);
  if (active) {
    active.messages = chatHistory;
    active.updatedAt = Date.now();
    const firstQuestion = chatHistory.find(message => message.role === 'user')?.content;
    if (active.title === 'New chat' && firstQuestion) {
      active.title = firstQuestion.trim().replace(/\s+/g, ' ').slice(0, 48) || 'New chat';
    }
  }
  await idbSet('tutorConversations', tutorConversations);
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
  if (!q || chatPending) return;
  if (retryTimestamp) {
    const failedIndex = chatHistory.findIndex(message => message.timestamp === retryTimestamp && message.retry);
    if (failedIndex >= 0) {
      const start = chatHistory[failedIndex - 1]?.role === 'user' ? failedIndex - 1 : failedIndex;
      chatHistory.splice(start);
      await persistTutorConversations();
    }
  }
  if (!tutorConversations.some(item => item.id === activeConversationId)) createTutorConversation();
  chatPending = true;
  lastTutorQuestion = q;
  chatWakeMessage = '';
  chatStreamingReply = '';
  chatAbortController = new AbortController();
  $('chat-input').value = '';
  $('chat-input').style.height = 'auto';
  $('chat-send').disabled = true;
  $('chat-send').classList.add('hidden');
  $('chat-stop-btn').classList.remove('hidden');
  setChatRequestStatus('');
  clearTimeout(chatWakeTimer);
  chatWakeTimer = setTimeout(() => {
    if (chatPending) {
      chatWakeMessage = 'Waking up the server, this can take up to a minute...';
      renderTutorChatPage();
    }
  }, 5000);
  chatHistory.push({ role: 'user', content: q, timestamp: Date.now() });
  chatAtLatest = true;
  await persistTutorConversations();
  renderTutorChatPage();
  renderTutorOverview();
  $('chat-input').focus();
  try {
    const references = $('tutor-use-material').checked ? retrieveStudyReferences(q) : [];
    const res = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: q, history: chatHistory.slice(0, -1), references, stream: true }),
      signal: chatAbortController.signal
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
    chatHistory.push({
      role: 'assistant',
      content: textBlock,
      sources: Array.isArray(data.sources) ? data.sources : [],
      question: q,
      timestamp: Date.now()
    });
    if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
    await persistTutorConversations();
    updateTutorConnectionStatus('connected');
    renderTutorChatPage();
    renderTutorOverview();
  } catch (err) {
    const stopped = chatAbortController?.signal.aborted;
    if (stopped) {
      if (chatStreamingReply.trim()) {
        chatHistory.push({
          role: 'assistant',
          content: chatStreamingReply,
          question: q,
          timestamp: Date.now()
        });
        await persistTutorConversations();
      }
      chatStreamingReply = '';
      chatPending = false;
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
      chatHistory.push({
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
    clearTimeout(chatWakeTimer);
    chatWakeMessage = '';
    chatStreamingReply = '';
    chatPending = false;
    chatAbortController = null;
    $('chat-send').classList.remove('hidden');
    $('chat-stop-btn').classList.add('hidden');
    $('chat-send').disabled = !$('chat-input').value.trim();
    $('chat-input').focus();
  }
}

$('chat-stop-btn').addEventListener('click', () => chatAbortController?.abort());

function cardLabel(card) {
  if (card.format === 'definition') return 'Definition';
  if (card.format === 'fill_blank') return 'Fill blank';
  return 'Basic';
}

function updateFlashcardDueBadge(count = flashcardDueCount) {
  flashcardDueCount = Math.max(0, Number(count) || 0);
  const badge = $('flashcards-due-badge');
  badge.textContent = flashcardDueCount > 99 ? '99+' : String(flashcardDueCount);
  badge.classList.toggle('hidden', flashcardDueCount === 0);
  badge.setAttribute('aria-label', `${flashcardDueCount} flashcards due`);
  renderDashboard();
}

function renderDeckBar() {
  const select = $('card-course-filter');
  if (!select) return;
  const courses = [...new Set(cards.map(card => card.subject || 'General'))].sort((a, b) => a.localeCompare(b));
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
  if (currentFlashcardDeckFilter !== 'all'
    && !decks.some(deck => deck.id === currentFlashcardDeckFilter)) {
    currentFlashcardDeckFilter = 'all';
  }
  container.replaceChildren();
  const all = document.createElement('button');
  all.type = 'button';
  all.className = `flashcard-deck-pill${currentFlashcardDeckFilter === 'all' ? ' active' : ''}`;
  all.dataset.deckFilter = 'all';
  all.innerHTML = `<span>All decks</span><small>${cards.length}</small>`;
  container.appendChild(all);
  decks.forEach(deck => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `flashcard-deck-pill${currentFlashcardDeckFilter === deck.id ? ' active' : ''}`;
    item.dataset.deckFilter = deck.id;
    item.innerHTML = `<span>${escapeHtml(deck.name)}</span><small>${Number(deck.due_count) || 0} due</small>`;
    container.appendChild(item);
  });
  container.querySelectorAll('[data-deck-filter]').forEach(button => button.addEventListener('click', () => {
    currentFlashcardDeckFilter = button.dataset.deckFilter;
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
    $('learning-topic').innerHTML = `${decks.map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join('')}<option value="new">New deck…</option>`;
    $('learning-topic').value = decks.some(deck => deck.id === selectedGenerateDeck)
      ? selectedGenerateDeck
      : decks[0]?.id || 'new';
    syncCustomSelect($('learning-topic'));
  }
  if ($('learning-review-deck')) {
    $('learning-review-deck').innerHTML = `<option value="all">All decks</option>${decks.map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)}</option>`).join('')}`;
    $('learning-review-deck').value = selectedReviewDeck === 'all' || decks.some(deck => deck.id === selectedReviewDeck)
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
  return cards.filter(card =>
    (currentFlashcardDeckFilter === 'all' || card.deck_id === currentFlashcardDeckFilter)
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
  const deck = decks.find(item => String(item.id) === String(card.deck_id));
  return deck?.name || card.subject || 'General';
}

function renderCardFilters() {
  const units = [...new Set(cards.map(card => card.unit || 'General'))].sort();
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
    const card = cards.find(item => item.id === button.dataset.deleteCard);
    if (!card) return;
    const confirmed = await confirmDeletion({
      title: 'Delete flashcard?',
      description: `Delete the question "${card.front}" and its answer?`,
      affected: 'This card will be removed from its course deck and future study sessions.'
    });
    if (!confirmed) return;
    await softDeleteRecords([{ collection: 'cards', ids: [card.id] }], 'Flashcard deleted.');
    if (!$('cards-study').classList.contains('hidden')) {
      studyDeck = studyDeck.filter(item => item.id !== card.id);
      if (!studyDeck.length) {
        exitCardStudy();
      } else {
        studyIndex = Math.min(studyIndex, studyDeck.length - 1);
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
  const card = cards.find(item => item.id === id);
  const activeDeck = decks.find(deck => deck.id === currentFlashcardDeckFilter);
  editingCardId = card ? card.id : null;
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
  const existing = cards.find(item => item.id === editingCardId);
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
      studyDeck = studyDeck.map(studyCard => cards.find(card => card.id === studyCard.id)).filter(Boolean);
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
  studyDeck = filteredCards()
    .filter(card => flashcardDeckKey(card) === deckKey)
    .sort((a, b) => (a.front || '').localeCompare(b.front || ''));
  if (studyDeck.length === 0) return;
  studyDeckName = flashcardDeckName(studyDeck[0]);
  studyIndex = 0;
  studySessionResults = { mastered: 0, review: 0 };
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
  $('study-deck-title').textContent = studyDeckName;
  if (studyIndex >= studyDeck.length) {
    $('card-study-progress').textContent = 'Session complete.';
    face.classList.add('hidden');
    $('study-card-more').replaceChildren();
    summary.classList.remove('hidden');
    summary.textContent = `You reviewed ${studyDeck.length} ${studyDeck.length === 1 ? 'card' : 'cards'}: ${studySessionResults.mastered} marked as known and ${studySessionResults.review} to review again.`;
    previous.disabled = studyDeck.length === 0;
    next.disabled = true;
    $('card-got-it-btn').disabled = true;
    $('card-again-btn').disabled = true;
    progress.setAttribute('aria-valuenow', '100');
    $('card-study-progress-fill').style.width = '100%';
    studyFlipped = false;
    return;
  }
  studyFlipped = false;
  $('card-study-progress').textContent = `Card ${studyIndex + 1} of ${studyDeck.length}`;
  face.classList.remove('hidden', 'flipped');
  summary.classList.add('hidden');
  face.setAttribute('aria-pressed', 'false');
  face.setAttribute('aria-label', 'Question shown. Press Space to show answer.');
  face.innerHTML = `<span class="card-front">${renderInlineMarkdown(studyDeck[studyIndex].front)}</span><span class="card-back">${renderInlineMarkdown(studyDeck[studyIndex].back)}</span>`;
  face.style.setProperty('--study-card-font-size', cardFontSize(studyDeck[studyIndex].front));
  $('study-card-more').innerHTML = cardMoreMarkup(studyDeck[studyIndex]);
  bindCardActions($('study-card-more'));
  previous.disabled = studyIndex === 0;
  next.disabled = false;
  $('card-got-it-btn').disabled = false;
  $('card-again-btn').disabled = false;
  const percent = Math.round((studyIndex / studyDeck.length) * 100);
  progress.setAttribute('aria-valuenow', String(percent));
  $('card-study-progress-fill').style.width = `${percent}%`;
}
function exitCardStudy() {
  $('cards-study').classList.add('hidden');
  $('panel-cards').classList.remove('studying');
  $('card-list').querySelector('[data-study-deck]')?.focus();
}
function navigateStudyCard(direction) {
  studyIndex = Math.max(0, Math.min(studyDeck.length, studyIndex + direction));
  renderStudyCard();
}
async function markStudyCard(mastered) {
  if (studyIndex >= studyDeck.length) return;
  const card = cards.find(c => c.id === studyDeck[studyIndex].id);
  if (!card) return;
  try {
    await saveFlashcardRecord({ ...card, mastered }, card.id);
    const current = cards.find(item => item.id === card.id);
    if (current) current.mastered = mastered;
  } catch (error) {
    setStatus('flashcards-storage-status', error.message || 'Could not update flashcard mastery.');
    return;
  }
  studySessionResults[mastered ? 'mastered' : 'review']++;
  studyIndex++;
  renderProgress();
  renderStudyCard();
  if (studyIndex < studyDeck.length) $('flip-card').focus();
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
  const filtered = sortNotes(notes.filter(note => !query || noteMatchesQuery(note, query)));
  const notebookGrid = $('notes-notebook-grid');
  const searchResults = $('notes-search-results');
  const workspace = $('notes-workspace');
  const readerNav = $('notes-reader-nav');
  const notebook = filteredNotesForNotebook(activeNotebookKey);
  if (activeNotebookKey && !notebook.length) {
    activeNotebookKey = '';
    sessionStorage.removeItem(NOTES_NOTEBOOK_KEY);
  }

  if (query) {
    $('notes-notebooks-view').classList.add('hidden');
    searchResults.classList.remove('hidden');
    workspace.classList.add('hidden');
    readerNav.classList.add('hidden');
    $('notes-search-empty').classList.toggle('hidden', filtered.length > 0);
    $('notes-search-grid').innerHTML = filtered.map(note => noteListMarkup(note, true)).join('');
    bindNoteSelection($('notes-search-grid'), true);
    return;
  }

  searchResults.classList.add('hidden');
  $('notes-search-empty').classList.add('hidden');
  $('notes-search-grid').replaceChildren();
  if (!activeNotebookKey) {
    $('notes-notebooks-view').classList.remove('hidden');
    workspace.classList.add('hidden');
    readerNav.classList.add('hidden');
    $('notes-empty').classList.toggle('hidden', notes.length > 0);
    renderNotebookTiles();
    return;
  }

  $('notes-notebooks-view').classList.add('hidden');
  $('notes-empty').classList.add('hidden');
  workspace.classList.remove('hidden');
  workspace.classList.remove('mobile-detail-open');
  readerNav.classList.remove('hidden');
  if (!notebook.some(note => note.id === selectedNoteId)) {
    selectedNoteId = notebook[0]?.id || null;
    persistNotesReaderPosition();
  }
  $('notebook-note-list').innerHTML = notebook.map(note => noteListMarkup(note)).join('');
  bindNoteSelection($('notebook-note-list'));
  renderNotebookReaderNav(notebook);
  renderNoteDetail();
}

function noteNotebookName(note) {
  return String(note.tag || '').trim() || 'General';
}

function noteNotebookKey(note) {
  return noteNotebookName(note).toLocaleLowerCase();
}

function noteMatchesQuery(note, query) {
  return `${note.title} ${note.body} ${note.tag} ${note.unit} ${normalizeNoteTags(note.tags).join(' ')}`
    .toLocaleLowerCase().includes(query);
}

function sortNotes(items) {
  const sort = $('notes-sort').value;
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || (sort === 'title' ? (a.title || '').localeCompare(b.title || '')
      : sort === 'course' ? noteNotebookName(a).localeCompare(noteNotebookName(b)) || (a.title || '').localeCompare(b.title || '')
        : (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)));
}

function filteredNotesForNotebook(key) {
  if (!key) return [];
  return sortNotes(notes.filter(note => key === 'pinned'
    ? Boolean(note.pinned)
    : noteNotebookKey(note) === key));
}

function noteEditedDate(note) {
  return new Date(note.updatedAt || note.createdAt || Date.now()).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function notePlainText(value) {
  return String(value || '')
    .replace(/```(?:[\w+-]+)?\s*\n?([\s\S]*?)```/g, '$1 ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(`{1,3}|\*\*?|__?)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function noteListMarkup(note, searchResult = false) {
  const notebookLabel = noteNotebookName(note);
  const title = escapeHtml(note.title || 'Untitled');
  const notebook = searchResult || activeNotebookKey === 'pinned'
    ? `<span class="note-card-course">${escapeHtml(notebookLabel)}</span>`
    : '';
  const preview = notePlainText(note.body);
  return `<button class="note-card notebook-note-item ${note.id === selectedNoteId ? 'selected' : ''}" type="button" data-select-note="${escapeHtml(note.id)}" aria-pressed="${note.id === selectedNoteId}">
    <span class="note-card-topline">${notebook}<span class="note-item-pin" ${note.pinned ? 'aria-label="Pinned"' : 'aria-hidden="true"'}>${note.pinned ? '★' : ''}</span></span>
    <strong>${title}</strong>
    ${preview ? `<span class="note-card-preview">${escapeHtml(preview.slice(0, 150))}${preview.length > 150 ? '…' : ''}</span>` : ''}
    <span class="note-card-meta">Edited ${escapeHtml(noteEditedDate(note))}</span>
  </button>`;
}

function bindNoteSelection(container, fromSearch = false) {
  container.querySelectorAll('[data-select-note]').forEach(button => button.addEventListener('click', () => {
    const note = notes.find(item => item.id === button.dataset.selectNote);
    if (!note) return;
    selectNote(note.id, fromSearch ? noteNotebookKey(note) : null);
  }));
}

function renderNotebookTiles() {
  const groups = new Map();
  notes.forEach(note => {
    const key = noteNotebookKey(note);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  });
  const notebooks = [...groups.entries()]
    .sort((a, b) => noteNotebookName(a[1][0]).localeCompare(noteNotebookName(b[1][0])));
  const tiles = [];
  const pinnedNotes = notes.filter(note => note.pinned);
  if (pinnedNotes.length) tiles.push(['pinned', 'Pinned', pinnedNotes]);
  notebooks.forEach(([key, group]) => tiles.push([key, noteNotebookName(group[0]), group]));
  $('notes-notebook-grid').innerHTML = tiles.map(([key, name, group]) => {
    const units = [...new Set(group.map(note => String(note.unit || '').trim()).filter(Boolean))];
    const latest = Math.max(...group.map(note => Number(note.updatedAt || note.createdAt) || 0));
    const date = latest ? new Date(latest).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No edit date';
    const icon = key === 'pinned' ? '★' : '▤';
    return `<button type="button" class="deck-tile notebook-tile" data-open-notebook="${escapeHtml(key)}">
      <span class="deck-tile-icon" aria-hidden="true">${icon}</span>
      <span class="deck-tile-copy"><strong>${escapeHtml(name)}</strong><span>${group.length} ${group.length === 1 ? 'note' : 'notes'}</span><span class="notebook-unit-list">${units.length ? escapeHtml(units.join(' · ')) : 'No units added'}</span></span>
      <span class="notebook-tile-meta">Edited ${escapeHtml(date)}</span>
      <span class="deck-tile-open">Open notebook →</span>
    </button>`;
  }).join('');
  $('notes-notebook-grid').querySelectorAll('[data-open-notebook]').forEach(button => button.addEventListener('click', () => {
    activeNotebookKey = button.dataset.openNotebook;
    const notebook = filteredNotesForNotebook(activeNotebookKey);
    selectedNoteId = notebook.find(note => note.id === selectedNoteId)?.id || notebook[0]?.id || null;
    persistNotesReaderPosition();
    renderNotes();
  }));
}

function persistNotesReaderPosition() {
  if (activeNotebookKey) sessionStorage.setItem(NOTES_NOTEBOOK_KEY, activeNotebookKey);
  else sessionStorage.removeItem(NOTES_NOTEBOOK_KEY);
  if (selectedNoteId) sessionStorage.setItem(NOTES_SELECTED_NOTE_KEY, selectedNoteId);
  else sessionStorage.removeItem(NOTES_SELECTED_NOTE_KEY);
}

function renderNotebookReaderNav(notebook) {
  const selectedIndex = notebook.findIndex(note => note.id === selectedNoteId);
  const index = selectedIndex < 0 ? 0 : selectedIndex;
  $('notes-position').textContent = notebook.length ? `Note ${index + 1} of ${notebook.length}` : 'No notes';
  $('notes-prev-btn').disabled = index <= 0;
  $('notes-next-btn').disabled = index >= notebook.length - 1;
  $('notebook-note-select').innerHTML = notebook.map((note, noteIndex) => {
    const prefix = activeNotebookKey === 'pinned' ? `${noteNotebookName(note)} · ` : '';
    return `<option value="${escapeHtml(note.id)}">${noteIndex + 1}. ${escapeHtml(prefix + (note.title || 'Untitled'))}</option>`;
  }).join('');
  $('notebook-note-select').value = selectedNoteId || '';
}

function navigateNotebookNote(direction) {
  if (editingNoteId) return;
  const notebook = filteredNotesForNotebook(activeNotebookKey);
  const index = notebook.findIndex(note => note.id === selectedNoteId);
  const next = notebook[index + direction];
  if (next) selectNote(next.id);
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

function normalizeTutorReply(value) {
  return String(value || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\t/g, '\t')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function renderMathInElementSafe(container) {
  if (typeof window.renderMathInElement !== 'function') return;
  window.renderMathInElement(container, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
  });
}

function bindMarkdownCodeButtons(container, { truncateLongCode = true } = {}) {
  container.querySelectorAll('[data-copy-code]').forEach(button => button.addEventListener('click', async () => {
    const codeElement = button.closest('.markdown-code-block').querySelector('code');
    const code = codeElement.dataset.fullCode ?? codeElement.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
      button.setAttribute('aria-label', 'Code copied to clipboard');
    } catch {
      button.textContent = 'Copy unavailable';
      button.setAttribute('aria-label', 'Copy unavailable');
    }
    clearTimeout(button.copyFeedbackTimeout);
    button.copyFeedbackTimeout = setTimeout(() => {
      const block = button.closest('.markdown-code-block');
      if (!block) return;
      button.textContent = 'Copy code';
      const language = block.querySelector('.markdown-code-header span').textContent;
      button.setAttribute('aria-label', language && language !== 'Code' ? `Copy ${language} code` : 'Copy code');
    }, 1800);
  }));
  container.querySelectorAll('.markdown-code-block').forEach(block => {
    const code = block.querySelector('code');
    const fullCode = code.textContent;
    code.dataset.fullCode = fullCode;
    const lines = fullCode.split('\n');
    if (!truncateLongCode || lines.length <= 20 || block.querySelector('[data-expand-code]')) return;
    code.textContent = lines.slice(0, 20).join('\n');
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'text-btn';
    expand.dataset.expandCode = '';
    expand.textContent = `Show more (${lines.length - 20} lines)`;
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

async function selectNote(id, notebookKey = null) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  const targetNotebookKey = notebookKey || activeNotebookKey || noteNotebookKey(note);
  if (editingNoteId && editingNoteId !== id) {
    await saveNote();
    editingNoteId = null;
  }
  activeNotebookKey = targetNotebookKey;
  selectedNoteId = id;
  persistNotesReaderPosition();
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
  if (activeNotebookKey !== 'pinned') activeNotebookKey = noteNotebookKey(note);
  $('note-save-status').textContent = 'Unsaved changes';
  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = setTimeout(saveNote, 650);
}

function openNoteForm(id) {
  let note = notes.find(item => item.id === id);
  if (!note) {
    const now = Date.now();
    const defaultTag = activeNotebookKey === 'pinned'
      ? notes.find(item => item.id === selectedNoteId)?.tag || ''
      : notes.find(item => noteNotebookKey(item) === activeNotebookKey)?.tag || '';
    note = { id: uid(), title: '', tag: defaultTag, unit: '', tags: [], body: '', aiGenerated: false, createdAt: now, updatedAt: now };
    notes.push(note);
  }
  selectedNoteId = note.id;
  if (activeNotebookKey !== 'pinned') activeNotebookKey = noteNotebookKey(note);
  persistNotesReaderPosition();
  editingNoteId = note.id;
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
  if (activeNotebookKey !== 'pinned') activeNotebookKey = noteNotebookKey(note);
  persistNotesReaderPosition();
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

async function backToNotebooks() {
  if (editingNoteId) {
    await saveNote();
    editingNoteId = null;
    $('note-form').classList.add('hidden');
  }
  activeNotebookKey = '';
  persistNotesReaderPosition();
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

async function deleteNoteWithUndo(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  const confirmed = await confirmDeletion({
    title: `Delete note "${note.title || 'Untitled note'}"?`,
    description: 'This will remove the saved note and its formatted content.',
    affected: 'Flashcards or quiz results created from this note are not changed.'
  });
  if (!confirmed) return;
  selectedNoteId = notes.filter(item => item.id !== id).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0]?.id || null;
  await softDeleteRecords([{ collection: 'notes', ids: [id] }], 'Note deleted.');
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
    const records = generated.filter(card => card && typeof card.front === 'string' && typeof card.back === 'string')
      .map(card => ({
        front: card.front.trim(), back: card.back.trim(),
        subject: note.tag || '', unit: note.unit || '',
        format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
        aiGenerated: true, sourceNoteId: note.id, sourceNoteTitle: note.title || 'Study note',
        mastered: false
      }));
    await importFlashcardRecords(records);
    activatePage('cards');
    setFlashcardsView('cards');
    setStatus('cards-ai-status', `Added ${records.length} cards from ${note.title || 'your note'}.`);
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
  const records = mistakes.map(result => ({
    front: result.question,
    back: result.answer ? `Your answer: ${result.answer}\nCorrect answer: ${currentQuiz.questions.find(question => question.question === result.question)?.correctAnswer || ''}` : `Correct answer: ${currentQuiz.questions.find(question => question.question === result.question)?.correctAnswer || 'Review this topic.'}`,
    subject: currentQuiz.doc.course || 'General',
    unit: currentQuiz.doc.unit || '',
    format: 'basic',
    aiGenerated: false,
    mastered: false
  }));
  const added = await importFlashcardRecords(records);
  currentQuiz.madeFlashcards = true;
  setStatus('quiz-status', `Added ${added} flashcards from your mistakes.`);
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

function formatStudyDuration(seconds) {
  const minutes = Math.round(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours) return `${hours} h${remainingMinutes ? ` ${remainingMinutes} min` : ''}`;
  return `${minutes} min`;
}

function pluralizeCount(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
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
  if (progressDataLoading) {
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
    const seconds = timerSessions.reduce((total, session) => {
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
  const attempts = quizResults.slice().sort((a, b) => Number(a.takenAt) - Number(b.takenAt)).slice(-8);
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
  if (!cards.length) {
    showChartEmpty(container, 'No flashcards available. Add cards to track mastery.', 'Flashcard mastery: no cards available.');
    return;
  }
  const mastered = cards.filter(card => card.mastered).length;
  const notMastered = cards.length - mastered;
  const percent = Math.round((mastered / cards.length) * 100);
  const summary = `Flashcard mastery: ${mastered} mastered, ${notMastered} not yet mastered, ${cards.length} total.`;
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
  masteredSegment.style.width = `${(mastered / cards.length) * 100}%`;
  const remainingSegment = document.createElement('span');
  remainingSegment.className = 'mastery-segment not-mastered';
  remainingSegment.style.width = `${(notMastered / cards.length) * 100}%`;
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
  const totalSeconds = timerSessions.reduce((sum, session) => sum + (Number(session.seconds) || 0), 0);
  const completedDocs = documents.filter(document => (document.readingProgress || 0) >= 100).length;
  const quizAvg = quizResults.length ? Math.round(quizResults.reduce((sum, result) => sum + (Number(result.score) || 0), 0) / quizResults.length) : 0;
  const masteredCount = cards.filter(card => card.mastered).length;
  const mastery = cards.length ? Math.round((masteredCount / cards.length) * 100) : 0;
  $('stat-hours').textContent = formatStudyDuration(totalSeconds);
  $('stat-hours-help').textContent = `${formatStudyDuration(totalSeconds)} across completed focus sessions.`;
  $('stat-docs').textContent = String(completedDocs);
  $('stat-docs-help').textContent = `${completedDocs} of ${documents.length} ${documents.length === 1 ? 'document' : 'documents'} at 100% reading.`;
  $('stat-quiz').textContent = `${quizAvg}%`;
  $('stat-quiz-help').textContent = quizResults.length
    ? `Average across ${pluralizeCount(quizResults.length, 'recorded attempt')}.`
    : 'Take a quiz to record an accuracy score.';
  $('stat-cards').textContent = `${mastery}%`;
  $('stat-cards-help').textContent = `${masteredCount} of ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} mastered.`;

  renderProgressChart('study-time-chart', renderStudyTimeChart, 'Study time chart could not be rendered.');
  renderProgressChart('quiz-accuracy-chart', renderQuizAccuracyChart, 'Quiz accuracy chart could not be rendered.');
  if (progressDataLoading) {
    showChartLoading($('flashcard-mastery-chart'));
  } else if (dashboardFlashcardStatus === 'error' && !cards.length) {
    const container = $('flashcard-mastery-chart');
    showChartError(container, dashboardFlashcardError || 'Flashcard mastery could not be loaded.', () => {
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
  documents.forEach(document => makeProgressGroup(groups, document.course).docs.push(document));
  notes.forEach(note => makeProgressGroup(groups, note.tag).notes.push(note));
  cards.forEach(card => makeProgressGroup(groups, card.subject).cards.push(card));
  quizResults.forEach(result => makeProgressGroup(groups, result.course).quizzes.push(result));
  timerSessions.forEach(session => makeProgressGroup(groups, session.course).sessions.push(session));
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

  const recent = timerSessions.slice().sort((a, b) => Number(b.completedAt) - Number(a.completedAt));
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
    const session = timerSessions.find(item => item.id === button.dataset.deleteSession);
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
  const requestId = ++progressDeckStatsRequest;
  container.setAttribute('aria-busy', 'true');
  container.replaceChildren();
  const skeleton = document.createElement('div');
  skeleton.className = 'progress-deck-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  container.appendChild(skeleton);
  try {
    const data = await learningApi('/api/stats/topics');
    if (requestId !== progressDeckStatsRequest) return;
    container.setAttribute('aria-busy', 'false');
    renderProgressWeakDecks(data.decks || data.topics || []);
  } catch (error) {
    console.error('Loading weak deck stats failed', error);
    if (requestId !== progressDeckStatsRequest) return;
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
      merged.cards = cards;
      return;
    }
    merged[key] = mergeRecords(
      { documents, cards, notes, quizResults, timerSessions, classes, assignments, tutorConversations }[key],
      backup[key]
    );
  });
  await importFlashcardRecords(backup.cards);
  merged.cards = cards;
  await saveBackupCollections(merged);
  documents = merged.documents;
  notes = merged.notes;
  quizResults = merged.quizResults;
  timerSessions = merged.timerSessions;
  classes = merged.classes;
  assignments = merged.assignments;
  tutorConversations = merged.tutorConversations;
  activeConversationId = tutorConversations.some(item => item.id === activeConversationId)
    ? activeConversationId
    : tutorConversations[0]?.id || null;
  chatHistory = tutorConversations.find(item => item.id === activeConversationId)?.messages || [];
  await persistTutorConversations();
  Object.entries(backup.localSettings).forEach(([key, value]) => localStorage.setItem(key, value));
  if (backup.localSettings[THEME_KEY]) setTheme(backup.localSettings[THEME_KEY]);
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
    const selectedDeck = decks.find(deck => deck.id === currentFlashcardDeckFilter);
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
    cards = cardData.cards.map(mapServerCard);
    decks = deckData.decks;
    dashboardFlashcardStatus = 'ready';
    dashboardFlashcardError = '';
    updateFlashcardDueBadge(decks.reduce((sum, deck) => sum + (Number(deck.due_count) || 0), 0));
    if (render) {
      renderDeckBar();
      renderCardFilters();
      renderCardList();
      renderTutorOverview();
      renderProgress();
    }
  } catch (error) {
    dashboardFlashcardStatus = 'error';
    dashboardFlashcardError = error.message || 'Could not load flashcards.';
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
  let deck = decks.find(item => item.name.toLocaleLowerCase() === deckName.toLocaleLowerCase())
    || decks.find(item => item.id === input.deck_id);
  if (!deck) {
    const created = await flashcardApi('/api/decks', { name: deckName });
    deck = created.deck;
    decks.push(deck);
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
  notesSelect.innerHTML = notes.length
    ? notes.map(note => `<option value="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled note')}</option>`).join('')
    : '<option value="">No saved notes</option>';
  docsSelect.innerHTML = documents.length
    ? documents.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || 'Untitled document')}</option>`).join('')
    : '<option value="">No documents</option>';
  syncCustomSelect(notesSelect);
  syncCustomSelect(docsSelect);
}

function loadFlashcardSourceText() {
  const type = $('flashcard-source-type').value;
  $('flashcard-note-source-wrap').classList.toggle('hidden', type !== 'note');
  $('flashcard-document-source-wrap').classList.toggle('hidden', type !== 'document');
  const content = type === 'note'
    ? notes.find(note => note.id === $('flashcard-note-source').value)?.body || ''
    : type === 'document'
      ? documents.find(item => item.id === $('flashcard-document-source').value)?.extractedText || ''
      : flashcardPastedSource;
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
    dashboardFlashcardStatus = 'error';
    dashboardFlashcardError = error.message || 'Could not load flashcards from the server.';
    setStatus('flashcards-storage-status', `${dashboardFlashcardError} Your local backup is still available.`);
  }
}

function renderLearningPreview() {
  const container = $('learning-preview-list');
  container.replaceChildren();
  learningPreviewCards.forEach((card, index) => {
    const article = document.createElement('article');
    article.className = 'learning-preview-card';
    const selected = document.createElement('input');
    selected.type = 'checkbox';
    selected.checked = card.selected !== false;
    selected.setAttribute('aria-label', `Select card ${index + 1} to save`);
    selected.addEventListener('change', () => {
      card.selected = selected.checked;
      $('learning-save-btn').disabled = !learningPreviewCards.some(item => item.selected !== false);
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
      learningPreviewCards.splice(index, 1);
      renderLearningPreview();
    });
    article.append(selected, fields, remove);
    container.appendChild(article);
  });
  $('learning-save-btn').disabled = !learningPreviewCards.some(card => card.selected !== false);
}

async function generateLearningCards() {
  const notesText = $('learning-notes').value.trim();
  const deck = decks.find(item => item.id === $('learning-topic').value);
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
    learningPreviewCards = data.cards.map(card => ({ ...card, selected: true }));
    renderLearningPreview();
    setStatus('learning-generate-status', `Preview ready: ${learningPreviewCards.length} cards for ${data.topic}. Review or edit them before saving.`);
  } catch (error) {
    console.error('Flashcard generation failed', error);
    setStatus('learning-generate-status', error.message || 'Could not generate cards. Please try again.');
  } finally {
    button.disabled = false;
  }
}

async function saveLearningCards() {
  const deck = decks.find(item => item.id === $('learning-topic').value);
  const selected = learningPreviewCards
    .filter(card => card.selected !== false)
    .map(({ front, back }) => ({
      front: front.trim(),
      back: back.trim(),
      aiGenerated: true,
      subject: deck?.name || 'General',
      sourceNoteId: $('flashcard-source-type').value === 'note' ? $('flashcard-note-source').value : '',
      sourceNoteTitle: $('flashcard-source-type').value === 'note'
        ? notes.find(note => note.id === $('flashcard-note-source').value)?.title || ''
        : '',
      sourceDocumentId: $('flashcard-source-type').value === 'document' ? $('flashcard-document-source').value : '',
      sourceDocumentTitle: $('flashcard-source-type').value === 'document'
        ? documents.find(item => item.id === $('flashcard-document-source').value)?.title || ''
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
    learningPreviewCards = learningPreviewCards.filter(card => card.selected === false);
    renderLearningPreview();
    await refreshFlashcardData();
    setStatus('learning-generate-status', `Saved ${savedCount} ${savedCount === 1 ? 'card' : 'cards'} to ${deck.name}.`);
    loadLearningStats();
  } catch (error) {
    console.error('Saving flashcards failed', error);
    setStatus('learning-generate-status', error.message || 'Could not save cards. Please try again.');
  } finally {
    button.disabled = !learningPreviewCards.some(card => card.selected !== false);
  }
}

function renderLearningReviewCard() {
  const card = learningReviewCards[learningReviewIndex];
  const cardElement = $('learning-review-card');
  const empty = $('learning-nothing-due');
  cardElement.classList.toggle('hidden', !card);
  empty.classList.toggle('hidden', Boolean(card) || learningReviewLoading);
  $('learning-due-count').textContent = learningReviewLoading
    ? 'Checking due cards…'
    : `${learningReviewDueCount} ${learningReviewDueCount === 1 ? 'card' : 'cards'} due`;
  if (!card) return;
  $('learning-review-topic').textContent = card.topic;
  $('learning-review-front').textContent = card.front;
  $('learning-review-answer').value = '';
  $('learning-submit-answer').classList.remove('hidden');
  $('learning-submit-answer').disabled = learningReviewLoading;
  $('learning-grade-result').classList.add('hidden');
  learningReviewGraded = false;
  learningReviewShownAt = Date.now();
}

async function loadLearningReview() {
  if (learningReviewLoading) return;
  learningReviewLoading = true;
  setStatus('learning-review-status', 'Loading due cards… The database may take a moment to wake up.');
  renderLearningReviewCard();
  try {
    const selectedDeck = $('learning-review-deck').value;
    const query = selectedDeck && selectedDeck !== 'all'
      ? `?limit=10&deck_id=${encodeURIComponent(selectedDeck)}`
      : '?limit=10';
    const data = await learningApi(`/api/review/next${query}`);
    learningReviewCards = data.cards;
    learningReviewIndex = 0;
    learningReviewDueCount = data.total_due;
    setStatus('learning-review-status', '');
  } catch (error) {
    learningReviewCards = [];
    learningReviewDueCount = 0;
    setStatus('learning-review-status', error.message || 'Could not load due cards.');
  } finally {
    learningReviewLoading = false;
    renderLearningReviewCard();
  }
}

async function submitLearningAnswer() {
  const card = learningReviewCards[learningReviewIndex];
  if (!card || learningReviewGraded || learningReviewLoading) return;
  const button = $('learning-submit-answer');
  button.disabled = true;
  setStatus('learning-review-status', 'Checking your answer…');
  try {
    const result = await learningApi('/api/review/grade', {
      card_id: card.id,
      user_answer: $('learning-review-answer').value,
      response_ms: Math.max(0, Date.now() - learningReviewShownAt)
    });
    learningReviewGraded = true;
    learningReviewDueCount = Math.max(0, learningReviewDueCount - 1);
    const reviewedDeck = decks.find(deck => deck.id === card.deck_id);
    if (reviewedDeck) reviewedDeck.due_count = Math.max(0, Number(reviewedDeck.due_count) - 1);
    updateFlashcardDueBadge(Math.max(0, flashcardDueCount - 1));
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
  if (!learningReviewGraded || learningReviewLoading) return;
  learningReviewIndex++;
  if (learningReviewIndex >= learningReviewCards.length) {
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
  if (learningStatsLoading) return;
  learningStatsLoading = true;
  setStatus('learning-stats-status', 'Loading deck stats… The database may take a moment to wake up.');
  try {
    const data = await learningApi('/api/stats/topics');
    renderLearningStats(data);
    setStatus('learning-stats-status', '');
  } catch (error) {
    console.error('Loading deck stats failed', error);
    setStatus('learning-stats-status', error.message || 'Could not load deck stats.');
  } finally {
    learningStatsLoading = false;
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
  if (flashcardSelectedSource === 'paste') flashcardPastedSource = $('learning-notes').value;
  flashcardSelectedSource = event.target.value;
  loadFlashcardSourceText();
});
$('flashcard-note-source').addEventListener('change', loadFlashcardSourceText);
$('flashcard-document-source').addEventListener('change', loadFlashcardSourceText);
$('learning-notes').addEventListener('input', () => {
  if ($('flashcard-source-type').value === 'paste') {
    flashcardPastedSource = $('learning-notes').value.slice(0, 6000);
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
    appInitialization = null;
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
  $('chat-send').disabled = chatPending || !input.value.trim();
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
  chatAtLatest = log.scrollHeight - log.clientHeight - log.scrollTop <= 48;
  $('chat-jump-latest').classList.toggle('hidden', chatAtLatest || chatHistory.length === 0);
});
$('chat-jump-latest').addEventListener('click', () => {
  chatAtLatest = true;
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
    downloadJSON(cards, 'margin-flashcards.json');
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
  if (!studyDeck.length || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (event.code === 'Space' && (event.target === $('flip-card') || !event.target.matches('button, a'))) {
    event.preventDefault();
    $('flip-card').click();
  } else if (event.key === 'ArrowRight' && studyIndex < studyDeck.length) {
    event.preventDefault();
    navigateStudyCard(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateStudyCard(-1);
  }
});
$('flip-card').addEventListener('click', () => {
  if (studyIndex >= studyDeck.length) return;
  studyFlipped = !studyFlipped;
  $('flip-card').classList.toggle('flipped', studyFlipped);
  $('flip-card').setAttribute('aria-pressed', String(studyFlipped));
  $('flip-card').setAttribute('aria-label', studyFlipped ? 'Answer shown. Press Space to show question.' : 'Question shown. Press Space to show answer.');
});
$('card-got-it-btn').addEventListener('click', () => markStudyCard(true));
$('card-again-btn').addEventListener('click', () => markStudyCard(false));
$('card-study-prev-btn').addEventListener('click', () => navigateStudyCard(-1));
$('card-study-next-btn').addEventListener('click', () => navigateStudyCard(1));
$('card-study-exit-btn').addEventListener('click', exitCardStudy);
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
$('notes-back-btn').addEventListener('click', backToNotebooks);
$('notes-prev-btn').addEventListener('click', () => navigateNotebookNote(-1));
$('notes-next-btn').addEventListener('click', () => navigateNotebookNote(1));
$('notebook-note-select').addEventListener('change', event => selectNote(event.target.value));
document.addEventListener('keydown', event => {
  if (!activeNotebookKey
    || $('notes-workspace').classList.contains('hidden')
    || editingNoteId
    || document.querySelector('dialog[open]')) return;
  if (event.target instanceof Element
    && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigateNotebookNote(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateNotebookNote(-1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    backToNotebooks();
  }
});
$('generate-notes-btn').addEventListener('click', generateNotesFromDocument);
$('export-notes-btn').addEventListener('click', () => downloadJSON(notes, 'margin-notes.json'));
$('import-notes-btn').addEventListener('click', () => $('import-notes-file').click());
$('import-notes-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
  if (Array.isArray(data)) {
    data.forEach(n => notes.push({ id: uid(), title: n.title || '', tag: n.tag || '', unit: n.unit || '', tags: normalizeNoteTags(n.tags), body: cleanNoteBody(n.body), aiGenerated: !!n.aiGenerated, createdAt: n.createdAt || Date.now(), updatedAt: n.updatedAt || Date.now() }));
    selectedNoteId = notes.at(-1)?.id || selectedNoteId;
    if (selectedNoteId) activeNotebookKey = noteNotebookKey(notes.find(note => note.id === selectedNoteId));
    persistNotesReaderPosition();
    idbSet('notes', notes);
    renderEverything();
  }
}));
$('export-all-data-btn').addEventListener('click', () => {
  (async () => {
    try {
    await refreshFlashcardData(false);
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: { documents, cards, notes, quizResults, timerSessions, classes, assignments, tutorConversations },
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
$('add-class-btn').addEventListener('click', () => openClassForm());
$('classes-add-assignment').addEventListener('click', () => openAssignmentForm());
$('calendar-add-assignment').addEventListener('click', () => openAssignmentForm());
$('calendar-add-fab').addEventListener('click', () => {
  const selected = new Date(`${calendarSelectedDateKey || localDateKey(new Date())}T09:00:00`);
  openAssignmentForm(null, '', selected.getTime());
});
$('classes-view-classes').addEventListener('click', () => {
  activatePage('classes');
});
$('classes-view-assignments').addEventListener('click', () => {
  activatePage('assignments');
});
$('classes-search').addEventListener('input', renderClasses);
$('calendar-prev-week').addEventListener('click', () => shiftCalendarPeriod(-1));
$('calendar-next-week').addEventListener('click', () => shiftCalendarPeriod(1));
$('calendar-this-week').addEventListener('click', () => {
  calendarMonthOffset = 0;
  calendarSelectedDateKey = localDateKey(new Date());
  renderCalendar();
});
document.querySelectorAll('[data-calendar-view]').forEach(button => button.addEventListener('click', () => {
  calendarView = button.dataset.calendarView;
  renderCalendar();
}));
$('calendar-day-add').addEventListener('click', event => {
  $('calendar-day-dialog').close();
  const selected = new Date(`${event.currentTarget.dataset.calendarAddDate}T09:00:00`);
  openAssignmentForm(null, '', selected.getTime());
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
  $('tutor-history-search').value = '';
  renderTutorHistory();
  $('tutor-history-dialog').showModal();
  $('tutor-history-search').focus();
});
$('tutor-history-search').addEventListener('input', () => {
  historyPageIndex = 0;
  renderTutorHistory();
});
$('new-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  createTutorConversation();
  $('chat-input').focus();
});
$('rename-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  renameTutorConversation(tutorConversations.find(item => item.id === activeConversationId));
});
$('export-chat-btn').addEventListener('click', () => {
  $('tutor-menu').open = false;
  exportTutorConversation();
});
$('tutor-conversation-title').addEventListener('change', async event => {
  const conversation = tutorConversations.find(item => item.id === activeConversationId);
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
    event.currentTarget.value = tutorConversations.find(item => item.id === activeConversationId)?.title || 'New chat';
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
  tutorConversations = [];
  chatHistory = [];
  activeConversationId = null;
  await idbSet('tutorConversations', tutorConversations);
  createTutorConversation();
  renderTutorHistory();
});
$('clear-quiz-history-btn').addEventListener('click', async () => {
  if (!quizResults.length) {
    setStatus('all-data-status', 'There is no quiz history to clear.');
    return;
  }
  const confirmed = await confirmBulkDeletion(`Delete all ${quizResults.length} quiz attempts? Quiz accuracy charts and course averages will be recalculated.`);
  if (!confirmed) return;
  const previous = quizResults;
  quizResults = [];
  if (!await idbSet('quizResults', quizResults)) {
    quizResults = previous;
    setStatus('all-data-status', 'Quiz history could not be cleared. Your data was restored.');
    return;
  }
  renderEverything();
  setStatus('all-data-status', 'Quiz history cleared.');
});
$('clear-timer-sessions-btn').addEventListener('click', async () => {
  if (!timerSessions.length) {
    setStatus('all-data-status', 'There are no timer sessions to clear.');
    return;
  }
  const confirmed = await confirmBulkDeletion(`Delete all ${timerSessions.length} timer sessions? Study-time totals, charts, and course progress will be recalculated.`);
  if (!confirmed) return;
  const previous = timerSessions;
  timerSessions = [];
  if (!await idbSet('timerSessions', timerSessions)) {
    timerSessions = previous;
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
    const conversation = tutorConversations.find(item => item.id === openButton.dataset.openConversation);
    if (!conversation) return;
    await persistTutorConversations();
    activeConversationId = conversation.id;
    chatHistory = conversation.messages;
    localStorage.setItem('studybuddy-active-conversation', activeConversationId);
    chatAtLatest = true;
    renderTutorChatPage();
    renderTutorOverview();
    $('tutor-history-dialog').close();
    return;
  }
  if (renameButton) {
    const conversation = tutorConversations.find(item => item.id === renameButton.dataset.renameConversation);
    if (!conversation) return;
    renameTutorConversation(conversation);
    return;
  }
  if (deleteButton) {
    const conversation = tutorConversations.find(item => item.id === deleteButton.dataset.deleteConversation);
    if (!conversation) return;
    const confirmed = await confirmDeletion({
      title: `Delete conversation "${conversation.title || 'New chat'}"?`,
      description: `This removes the conversation and its ${conversation.messages.length} messages from this browser.`,
      affected: 'Saved notes and flashcards created from replies are not changed.'
    });
    if (!confirmed) return;
    if (activeConversationId === conversation.id) {
      activeConversationId = tutorConversations.find(item => item.id !== conversation.id)?.id || null;
      chatHistory = tutorConversations.find(item => item.id === activeConversationId)?.messages || [];
    }
    localStorage.setItem('studybuddy-active-conversation', activeConversationId || '');
    await softDeleteRecords([{ collection: 'tutorConversations', ids: [conversation.id] }], 'Conversation deleted.');
    if (!activeConversationId) createTutorConversation();
    renderTutorChatPage();
    renderTutorOverview();
    renderTutorHistory();
  }
});
$('reply-dialog-close').addEventListener('click', () => $('reply-dialog').close());
$('code-dialog-close').addEventListener('click', () => $('code-dialog').close());
$('quiz-mistakes-close').addEventListener('click', () => $('quiz-mistakes-dialog').close());
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
  initializeCustomControls();
  documents = await idbGet('documents') || [];
  cards = [];
  notes = await idbGet('notes') || [];
  quizResults = await idbGet('quizResults') || [];
  timerSessions = await idbGet('timerSessions') || [];
  if (timerSessions.some(session => !session.id)) {
    timerSessions = timerSessions.map(session => session.id ? session : { ...session, id: uid() });
    await idbSet('timerSessions', timerSessions);
  }
  classes = await idbGet('classes') || [];
  assignments = await idbGet('assignments') || [];
  tutorConversations = await idbGet('tutorConversations') || [];
  let migratedTutorTimestamps = false;
  tutorConversations.forEach(conversation => {
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
  if (migratedTutorTimestamps) await idbSet('tutorConversations', tutorConversations);
  deletedRecords = (await idbGet('deletedRecords') || []).filter(snapshot => snapshot.expiresAt > Date.now());
  await idbSet('deletedRecords', deletedRecords);
  const savedConversationId = localStorage.getItem('studybuddy-active-conversation');
  activeConversationId = tutorConversations.some(item => item.id === savedConversationId)
    ? savedConversationId
    : tutorConversations.at(-1)?.id || null;
  chatHistory = tutorConversations.find(item => item.id === activeConversationId)?.messages || [];
  if (!activeConversationId) {
    const conversation = { id: uid(), title: 'New chat', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    tutorConversations.push(conversation);
    activeConversationId = conversation.id;
    chatHistory = conversation.messages;
    localStorage.setItem('studybuddy-active-conversation', activeConversationId);
    await persistTutorConversations();
  }
  if (await idbGet(NOTE_CLEANUP_KEY) !== 1) {
    notes = notes.map(note => ({ ...note, body: cleanNoteBody(note.body) }));
    await idbSet('notes', notes);
    await idbSet(NOTE_CLEANUP_KEY, 1);
  }
  await loadFlashcardsFromServer();
  progressDataLoading = false;
  renderTimer();
  renderEverything();
  renderFlashcardSourceOptions();
  setFlashcardsView(sessionStorage.getItem(FLASHCARD_VIEW_KEY) || 'cards');
  renderTutorChatPage();
  deletedRecords.forEach(snapshot => {
    const remaining = Math.max(0, snapshot.expiresAt - Date.now());
    undoTimers.set(snapshot.id, setTimeout(() => purgeUndoSnapshot(snapshot.id), remaining));
  });
  if (deletedRecords.length) showUndoToast(deletedRecords.at(-1), 'An item was deleted.');
  if (documents[0]) previewDocument(documents[0].id);
  syncReminderControls();
  if (reminderIntervalId) clearInterval(reminderIntervalId);
  reminderIntervalId = setInterval(checkAssignmentReminders, 30000);
  checkAssignmentReminders();
  $('export-all-data-btn').disabled = false;
  $('import-all-data-btn').disabled = false;
}
checkAuthentication();
import { state } from '../shared/state.js';
import { emit, on } from '../shared/bus.js';
import {
  bindMarkdownCodeButtons,
  cleanMarkdownBody,
  renderMarkdown,
  renderMathInElementSafe
} from '../shared/markdown.js';
const NOTE_CLEANUP_KEY = 'studybuddy-note-cleanup-version';
const NOTES_NOTEBOOK_KEY = 'studybuddy-notes-active-notebook';
const NOTES_SELECTED_NOTE_KEY = 'studybuddy-notes-selected-note';
const NOTEBOOKS_KEY = 'studybuddy-notebooks';
let notes = state.notes;
let selectedNoteId = sessionStorage.getItem(NOTES_SELECTED_NOTE_KEY) || null;
let activeNotebookKey = sessionStorage.getItem(NOTES_NOTEBOOK_KEY) || '';
let editingNoteId = null;
let editingNoteOriginal = null;
let editingNoteIsNew = false;
let noteBeforeEditId = null;
let notebooks = [];
let overviewScrollTop = 0;
let notebookListScrollTop = 0;
let lastRenderedSelectedNoteId = selectedNoteId;
let lastRenderedNotebookKey = '';
let dependencies;
const $ = id => document.getElementById(id);
const uid = (...args) => dependencies.uid(...args);
const idbSet = (...args) => dependencies.idbSet(...args);
const idbSetMany = (...args) => dependencies.idbSetMany(...args);
const callAI = (...args) => dependencies.callAI(...args);
const aiDocumentPayload = (...args) => dependencies.aiDocumentPayload(...args);
const truncateText = (...args) => dependencies.truncateText(...args);
const getDocuments = (...args) => dependencies.getDocuments(...args);
const setStatus = (...args) => dependencies.setStatus(...args);
const updateStudyMaterialIndex = (...args) => dependencies.updateStudyMaterialIndex(...args);
const renderTaxonomy = (...args) => dependencies.renderTaxonomy(...args);
const renderEverything = (...args) => dependencies.renderEverything(...args);
const releaseFitPaginator = (...args) => dependencies.releaseFitPaginator(...args);
const softDeleteRecords = (...args) => dependencies.softDeleteRecords(...args);
const confirmDeletion = (...args) => dependencies.confirmDeletion(...args);
const downloadJSON = (...args) => dependencies.downloadJSON(...args);
const readJSONFile = (...args) => dependencies.readJSONFile(...args);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

function focusSelectedNote() {
  if (!$('note-form').classList.contains('hidden')) {
    $('note-title').focus({ preventScroll: true });
    return;
  }
  if (window.matchMedia('(max-width: 760px)').matches) {
    const heading = $('note-detail').querySelector('h2');
    const emptyStateAction = $('note-create-first-btn');
    (heading || (!emptyStateAction.classList.contains('hidden') ? emptyStateAction : null)
      || $('notes-back-btn')).focus({ preventScroll: true });
    return;
  }
  const selectedButton = $('notebook-note-list').querySelector('[aria-pressed="true"]');
  (selectedButton || $('notes-back-btn')).focus({ preventScroll: true });
}

export function renderNotes() {
  notes = state.notes;
  const panel = $('panel-notes');
  const previousActiveElement = document.activeElement;
  const hadPanelFocus = panel.contains(previousActiveElement);
  const focusedNoteId = previousActiveElement.closest?.('[data-select-note]')?.dataset.selectNote || null;
  const focusedNoteMenuId = previousActiveElement.closest?.('[data-note-actions-for]')?.dataset.noteActionsFor || null;
  const focusedNotebookKey = previousActiveElement.closest?.('[data-open-notebook]')?.dataset.openNotebook || null;
  const query = $('notes-search').value.trim().toLocaleLowerCase();
  const filter = $('notes-notebook-filter').value;
  const filtered = sortNotes(notes.filter(note => (!query || noteMatchesQuery(note, query))
    && (filter === 'all' || (filter === 'pinned' ? Boolean(note.pinned) : noteNotebookKey(note) === filter))));
  const searchResults = $('notes-search-results');
  const workspace = $('notes-workspace');
  const readerNav = $('notes-reader-nav');
  const notebook = filteredNotesForNotebook(activeNotebookKey);
  const notebookList = $('notebook-note-list');
  const hasFilters = Boolean(query) || filter !== 'all';
  if (activeNotebookKey && activeNotebookKey !== 'pinned'
    && !notebooks.some(item => notebookKey(item.name) === activeNotebookKey)) {
    activeNotebookKey = '';
    sessionStorage.removeItem(NOTES_NOTEBOOK_KEY);
  }

  panel.classList.toggle('notes-workspace-active', Boolean(activeNotebookKey) && !hasFilters);
  panel.classList.toggle('scroll-region-y', !panel.classList.contains('notes-workspace-active'));
  if (panel.classList.contains('notes-workspace-active')) $('notes-back-to-top').classList.add('hidden');
  updateNotesStats();
  updateNotebookFilter();
  $('notes-notebooks-view').classList.toggle('hidden', hasFilters || Boolean(activeNotebookKey));
  searchResults.classList.toggle('hidden', !hasFilters);
  workspace.classList.toggle('hidden', !activeNotebookKey || hasFilters);
  readerNav.classList.toggle('hidden', !activeNotebookKey || hasFilters);

  if (hasFilters) {
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
    $('notes-empty').classList.toggle('hidden', notebooks.length > 0 || notes.length > 0);
    renderNotebookTiles();
    if (hadPanelFocus && (!previousActiveElement.isConnected || previousActiveElement.closest('.hidden'))) {
      requestAnimationFrame(() => {
        const noteButton = focusedNoteId
          ? [...$('notes-recent-grid').querySelectorAll('[data-select-note]')].find(button => button.dataset.selectNote === focusedNoteId)
          : null;
        const notebookButton = focusedNotebookKey
          ? [...$('notes-notebook-grid').querySelectorAll('[data-open-notebook]')].find(button => button.dataset.openNotebook === focusedNotebookKey)
          : null;
        (noteButton || notebookButton || $('notes-notebooks-view').querySelector('[data-create-notebook]'))?.focus({ preventScroll: true });
      });
    }
    return;
  }

  $('notes-empty').classList.add('hidden');
  if (!editingNoteId && !notebook.some(note => note.id === selectedNoteId)) {
    selectedNoteId = notebook[0]?.id || null;
    persistNotesReaderPosition();
  }
  const selectedNoteChanged = selectedNoteId !== lastRenderedSelectedNoteId || activeNotebookKey !== lastRenderedNotebookKey;
  notebookListScrollTop = notebookList.scrollTop;
  workspace.classList.toggle('mobile-detail-open', window.matchMedia('(max-width: 520px)').matches
    && Boolean(selectedNoteId || editingNoteId || notebook.length === 0));
  notebookList.innerHTML = notebook.map(note => noteListMarkup(note)).join('');
  bindNoteSelection(notebookList);
  renderNotebookReaderNav(notebook);
  renderNoteDetail();
  if (focusedNoteMenuId) {
    requestAnimationFrame(() => {
      [...notebookList.querySelectorAll('[data-note-actions-for]')]
        .find(menu => menu.dataset.noteActionsFor === focusedNoteMenuId)
        ?.querySelector('summary')?.focus({ preventScroll: true });
    });
  }
  if (selectedNoteChanged) {
    lastRenderedSelectedNoteId = selectedNoteId;
    lastRenderedNotebookKey = activeNotebookKey;
    requestAnimationFrame(() => {
      notebookList.querySelector('[aria-pressed="true"]')?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
      if (hadPanelFocus && (!previousActiveElement.isConnected || previousActiveElement.closest('.hidden'))) {
        focusSelectedNote();
      }
      $('note-detail-pane').scrollTop = 0;
    });
  } else {
    requestAnimationFrame(() => { notebookList.scrollTop = notebookListScrollTop; });
  }
}

function noteNotebookName(note) {
  return normalizeNotebookName(note.tag) || 'General';
}

function noteNotebookKey(note) {
  return notebookKey(noteNotebookName(note));
}

function normalizeNotebookName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function notebookKey(value) {
  return normalizeNotebookName(value).toLocaleLowerCase();
}

function updateNotesStats() {
  $('notes-stat-total').textContent = String(notes.length);
  $('notes-stat-notebooks').textContent = String(notebooks.length);
  $('notes-stat-pinned').textContent = String(notes.filter(note => note.pinned).length);
}

function updateNotebookFilter() {
  const select = $('notes-notebook-filter');
  const selected = select.value || 'all';
  const options = [
    '<option value="all">All notebooks</option>',
    '<option value="pinned">Pinned notes</option>',
    ...notebooks.map(notebook => `<option value="${escapeHtml(notebookKey(notebook.name))}">${escapeHtml(notebook.name)}</option>`)
  ];
  select.innerHTML = options.join('');
  select.value = [...select.options].some(option => option.value === selected) ? selected : 'all';
}

function clearNotesFilters() {
  $('notes-search').value = '';
  $('notes-notebook-filter').value = 'all';
  activeNotebookKey = '';
  persistNotesReaderPosition();
  renderNotes();
  $('notes-search').focus();
}

function updateNotesFilters() {
  if ($('notes-search').value.trim() || $('notes-notebook-filter').value !== 'all') {
    rememberOverviewPosition();
    activeNotebookKey = '';
    persistNotesReaderPosition();
  }
  renderNotes();
}

function rememberOverviewPosition() {
  if (!$('panel-notes').classList.contains('notes-workspace-active')) {
    overviewScrollTop = $('panel-notes').scrollTop;
  }
}

function ensureNotebooksForNotes() {
  const known = new Map(notebooks.map(notebook => [notebookKey(notebook.name), notebook]));
  notes.forEach(note => {
    const name = noteNotebookName(note);
    const key = notebookKey(name);
    if (key === 'pinned' || known.has(key)) return;
    const dates = notes.filter(item => noteNotebookKey(item) === key);
    const timestamps = dates.flatMap(item => [item.createdAt, item.updatedAt])
      .filter(value => value != null && Number.isFinite(Number(value))).map(Number);
    const createdAt = dates.map(item => item.createdAt).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
    const updatedAt = dates.map(item => item.updatedAt).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
    const record = {
      id: uid(),
      name,
      createdAt: createdAt.length ? Math.min(...createdAt) : (timestamps.length ? Math.min(...timestamps) : null),
      updatedAt: updatedAt.length ? Math.max(...updatedAt) : (timestamps.length ? Math.max(...timestamps) : null)
    };
    notebooks.push(record);
    known.set(key, record);
  });
  notebooks.sort((a, b) => a.name.localeCompare(b.name));
}

export async function initializeNotebooks() {
  const saved = await dependencies.idbGet(NOTEBOOKS_KEY);
  const initial = Array.isArray(saved) ? saved : [];
  notebooks = [];
  const keys = new Set();
  initial.forEach(item => {
    const name = normalizeNotebookName(item?.name);
    const key = notebookKey(name);
    if (!name || key === 'pinned' || keys.has(key)) return;
    keys.add(key);
    notebooks.push({
      id: typeof item.id === 'string' && item.id ? item.id : uid(),
      name,
      createdAt: item.createdAt != null && Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : null,
      updatedAt: item.updatedAt != null && Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : null
    });
  });
  const beforeNotes = JSON.stringify(notes);
  ensureNotebooksForNotes();
  notes.forEach(note => {
    const notebook = notebooks.find(item => notebookKey(item.name) === noteNotebookKey(note));
    if (notebook && note.tag && note.tag !== notebook.name) note.tag = notebook.name;
  });
  if (JSON.stringify(saved ?? []) !== JSON.stringify(notebooks) || beforeNotes !== JSON.stringify(notes)) {
    const savedSuccessfully = await idbSetMany([['notes', notes], [NOTEBOOKS_KEY, notebooks]]);
    if (!savedSuccessfully) setStatus('notes-action-message', 'Could not migrate notebooks to browser storage. Your existing notes are still available.');
  }
}

async function saveNotesAndNotebooks() {
  ensureNotebooksForNotes();
  return idbSetMany([['notes', notes], [NOTEBOOKS_KEY, notebooks]]);
}

function openCreateNotebookDialog() {
  $('create-notebook-name').value = '';
  $('create-notebook-error').textContent = '';
  $('create-notebook-dialog').showModal();
  $('create-notebook-name').focus();
}

async function createNotebook() {
  const name = normalizeNotebookName($('create-notebook-name').value);
  const error = $('create-notebook-error');
  if (!name) {
    error.textContent = 'Enter a notebook name.';
    $('create-notebook-name').focus();
    return;
  }
  if (notebookKey(name) === 'pinned' || notebooks.some(item => notebookKey(item.name) === notebookKey(name))) {
    error.textContent = notebookKey(name) === 'pinned'
      ? 'Pinned is reserved for your pinned notes.'
      : 'A notebook with this name already exists.';
    $('create-notebook-name').focus();
    return;
  }
  const record = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now() };
  notebooks.push(record);
  notebooks.sort((a, b) => a.name.localeCompare(b.name));
  if (!await saveNotesAndNotebooks()) {
    notebooks = notebooks.filter(item => item.id !== record.id);
    error.textContent = 'Could not save this notebook in browser storage. Please try again.';
    return;
  }
  $('create-notebook-dialog').close();
  setStatus('notes-action-message', `Notebook "${name}" created.`);
  renderNotes();
  requestAnimationFrame(() => {
    [...$('notes-notebook-grid').querySelectorAll('[data-open-notebook]')]
      .find(button => button.dataset.openNotebook === notebookKey(name))?.focus({ preventScroll: true });
  });
}

async function renameNotebook() {
  const id = $('rename-notebook-id').value;
  const record = notebooks.find(item => item.id === id);
  if (!record) return;
  const name = normalizeNotebookName($('rename-notebook-name').value);
  const error = $('rename-notebook-error');
  if (!name) {
    error.textContent = 'Enter a notebook name.';
    $('rename-notebook-name').focus();
    return;
  }
  const key = notebookKey(name);
  if (key === 'pinned' || notebooks.some(item => item.id !== id && notebookKey(item.name) === key)) {
    error.textContent = key === 'pinned' ? 'Pinned is reserved for your pinned notes.' : 'A notebook with this name already exists.';
    $('rename-notebook-name').focus();
    return;
  }
  const previousName = record.name;
  const previousUpdatedAt = record.updatedAt;
  const changedNotes = notes.filter(note => noteNotebookKey(note) === notebookKey(previousName))
    .map(note => ({ note, tag: note.tag, updatedAt: note.updatedAt }));
  record.name = name;
  record.updatedAt = Date.now();
  changedNotes.forEach(({ note }) => {
    note.tag = name;
    note.updatedAt = Date.now();
  });
  if (!await saveNotesAndNotebooks()) {
    record.name = previousName;
    record.updatedAt = previousUpdatedAt;
    changedNotes.forEach(({ note, tag, updatedAt }) => Object.assign(note, { tag, updatedAt }));
    error.textContent = 'Could not save this change in browser storage. Please try again.';
    return;
  }
  if (activeNotebookKey === notebookKey(previousName)) activeNotebookKey = key;
  persistNotesReaderPosition();
  $('rename-notebook-dialog').close();
  setStatus('notes-action-message', `Notebook renamed to "${name}".`);
  renderNotes();
  requestAnimationFrame(() => {
    [...$('notes-notebook-grid').querySelectorAll('[data-open-notebook]')]
      .find(button => button.dataset.openNotebook === key)?.focus({ preventScroll: true });
  });
}

async function deleteNotebook(id) {
  const record = notebooks.find(item => item.id === id);
  if (!record) return;
  const targetName = notebookKey(record.name) === 'general' ? 'Unfiled' : 'General';
  const confirmed = await confirmDeletion({
    title: `Delete notebook "${record.name}"?`,
    description: 'The notebook will be removed. Its notes will be moved to another notebook and will not be deleted.',
    affected: `Notes in this notebook will move to "${targetName}".`
  });
  if (!confirmed) return;
  const targetKey = notebookKey(targetName);
  const changedNotes = notes.filter(note => noteNotebookKey(note) === notebookKey(record.name))
    .map(note => ({ note, tag: note.tag, updatedAt: note.updatedAt }));
  let target = notebooks.find(item => notebookKey(item.name) === targetKey);
  const createdTarget = changedNotes.length > 0 && !target;
  if (createdTarget) {
    target = { id: uid(), name: targetName, createdAt: Date.now(), updatedAt: Date.now() };
    notebooks.push(target);
  }
  const now = Date.now();
  changedNotes.forEach(({ note }) => {
    note.tag = targetName;
    note.updatedAt = now;
  });
  notebooks = notebooks.filter(item => item.id !== id);
  notebooks.sort((a, b) => a.name.localeCompare(b.name));
  if (!await saveNotesAndNotebooks()) {
    notebooks.push(record);
    if (createdTarget) notebooks = notebooks.filter(item => item.id !== target.id);
    notebooks.sort((a, b) => a.name.localeCompare(b.name));
    changedNotes.forEach(({ note, tag, updatedAt }) => Object.assign(note, { tag, updatedAt }));
    setStatus('notes-action-message', 'Could not delete this notebook in browser storage. Please try again.');
    return;
  }
  if (activeNotebookKey === notebookKey(record.name)) activeNotebookKey = '';
  if (!notes.some(note => note.id === selectedNoteId)) selectedNoteId = null;
  persistNotesReaderPosition();
  setStatus('notes-action-message', `Notebook deleted. Its notes were moved to "${targetName}".`);
  renderNotes();
  $('panel-notes').scrollTop = overviewScrollTop;
  requestAnimationFrame(() => $('notes-notebooks-view').querySelector('[data-create-notebook]')?.focus({ preventScroll: true }));
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
  const query = $('notes-sidebar-search')?.value.trim().toLocaleLowerCase() || '';
  return sortNotes(notes.filter(note => (key === 'pinned'
    ? Boolean(note.pinned)
    : noteNotebookKey(note) === key) && (!query || noteMatchesQuery(note, query))));
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
  if (!searchResult) {
    return `<article class="notebook-note-row ${note.id === selectedNoteId ? 'selected' : ''}">
      <button class="note-card notebook-note-item" type="button" data-select-note="${escapeHtml(note.id)}" aria-pressed="${note.id === selectedNoteId}">
        <span class="note-row-heading"><strong>${title}</strong><span class="note-item-pin" ${note.pinned ? 'aria-label="Pinned"' : 'aria-hidden="true"'}>${note.pinned ? '★' : ''}</span></span>
        <span class="note-card-preview">${escapeHtml(preview.slice(0, 100) || 'No preview available.')}${preview.length > 100 ? '…' : ''}</span>
        <span class="note-card-meta">Edited ${escapeHtml(noteEditedDate(note))}</span>
      </button>
      <details class="note-row-actions" data-note-actions-for="${escapeHtml(note.id)}">
        <summary aria-label="Actions for ${title}" title="Note actions">•••</summary>
        <div class="note-row-actions-menu scroll-region scroll-region-y" aria-label="Actions for ${title}">
          <button type="button" data-note-menu-edit="${escapeHtml(note.id)}">Edit</button>
          <button type="button" data-note-menu-pin="${escapeHtml(note.id)}">${note.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" data-note-menu-export="${escapeHtml(note.id)}">Export Markdown</button>
          <button type="button" data-note-menu-json="${escapeHtml(note.id)}">Export JSON</button>
          <button type="button" data-note-menu-delete="${escapeHtml(note.id)}">Delete note</button>
        </div>
      </details>
    </article>`;
  }
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
  container.querySelectorAll('[data-note-menu-edit]').forEach(button => button.addEventListener('click', () => {
    void startNoteEdit(button.dataset.noteMenuEdit);
  }));
  container.querySelectorAll('[data-note-menu-pin]').forEach(button => button.addEventListener('click', () => {
    void toggleNotePin(button.dataset.noteMenuPin);
  }));
  container.querySelectorAll('[data-note-menu-export]').forEach(button => button.addEventListener('click', () => {
    const note = notes.find(item => item.id === button.dataset.noteMenuExport);
    if (note) exportNoteMarkdown(note);
  }));
  container.querySelectorAll('[data-note-menu-json]').forEach(button => button.addEventListener('click', () => {
    const note = notes.find(item => item.id === button.dataset.noteMenuJson);
    if (note) downloadJSON(note, `${safeFileName(note.title || 'note')}.json`);
  }));
  container.querySelectorAll('[data-note-menu-delete]').forEach(button => button.addEventListener('click', () => {
    void deleteNoteWithUndo(button.dataset.noteMenuDelete);
  }));
}

function renderNotebookTiles() {
  const pinnedNotes = notes.filter(note => note.pinned);
  const tiles = notebooks.slice().sort((a, b) => a.name.localeCompare(b.name)).map(notebook => {
    const key = notebookKey(notebook.name);
    const group = notes.filter(note => noteNotebookKey(note) === key);
    const units = [...new Set(group.map(note => String(note.unit || '').trim()).filter(Boolean))];
    const latest = Math.max(...group.map(note => Number(note.updatedAt || note.createdAt) || 0), 0);
    const previewNote = group.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
    const preview = previewNote ? notePlainText(previewNote.body) : '';
    const date = latest ? `Edited ${new Date(latest).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No edits yet';
    return `<article class="notes-notebook-card">
      <button type="button" class="notebook-tile" data-open-notebook="${escapeHtml(key)}" aria-label="Open ${escapeHtml(notebook.name)}, ${group.length} ${group.length === 1 ? 'note' : 'notes'}">
        <span class="deck-tile-icon" aria-hidden="true">▤</span>
        <span class="deck-tile-copy"><strong>${escapeHtml(notebook.name)}</strong><span>${group.length} ${group.length === 1 ? 'note' : 'notes'}</span><span class="notebook-unit-list">${units.length ? escapeHtml(units.join(' · ')) : 'No units added'}</span></span>
        <span class="notebook-card-preview">${escapeHtml(preview.slice(0, 100) || (group.length ? 'No preview available.' : 'No notes yet. Add one to get started.'))}${preview.length > 100 ? '…' : ''}</span>
        <span class="notebook-tile-meta">${escapeHtml(date)}</span>
        <span class="deck-tile-open">Open notebook →</span>
      </button>
      <details class="notebook-actions">
        <summary aria-label="Actions for ${escapeHtml(notebook.name)}" title="Notebook actions">•••</summary>
        <div class="notebook-actions-menu scroll-region scroll-region-y">
          <button type="button" data-rename-notebook="${escapeHtml(notebook.id)}">Rename</button>
          <button type="button" data-delete-notebook="${escapeHtml(notebook.id)}">Delete notebook</button>
        </div>
      </details>
    </article>`;
  }).join('');
  const pinnedTile = pinnedNotes.length ? `<article class="notes-notebook-card">
    <button type="button" class="notebook-tile pinned-notebook-tile" data-open-notebook="pinned" aria-label="Open Pinned notes, ${pinnedNotes.length} ${pinnedNotes.length === 1 ? 'note' : 'notes'}">
      <span class="deck-tile-icon" aria-hidden="true">★</span>
      <span class="deck-tile-copy"><strong>Pinned</strong><span>${pinnedNotes.length} ${pinnedNotes.length === 1 ? 'note' : 'notes'}</span><span class="notebook-unit-list">Your saved favorites</span></span>
      <span class="notebook-card-preview">${escapeHtml(notePlainText(pinnedNotes[0].body).slice(0, 100) || 'Your pinned notes appear here.')}</span>
      <span class="notebook-tile-meta">Pinned notes</span>
      <span class="deck-tile-open">Open collection →</span>
    </button>
  </article>` : '';
  $('notes-notebook-grid').innerHTML = `${pinnedTile}${tiles}
    <button class="notebook-create-card" type="button" data-create-notebook>
      <span aria-hidden="true">＋</span><strong>Create notebook</strong><span>Start a new subject or project</span>
    </button>`;
  $('notes-notebook-grid').querySelectorAll('[data-open-notebook]').forEach(button => button.addEventListener('click', () => {
    rememberOverviewPosition();
    $('notes-sidebar-search').value = '';
    activeNotebookKey = button.dataset.openNotebook;
    const notebook = filteredNotesForNotebook(activeNotebookKey);
    selectedNoteId = notebook.find(note => note.id === selectedNoteId)?.id || notebook[0]?.id || null;
    persistNotesReaderPosition();
    renderNotes();
    requestAnimationFrame(() => {
      focusSelectedNote();
    });
  }));
  $('notes-notebook-grid').querySelector('[data-create-notebook]').addEventListener('click', openCreateNotebookDialog);
  $('notes-notebook-grid').querySelectorAll('[data-rename-notebook]').forEach(button => button.addEventListener('click', () => {
    const notebook = notebooks.find(item => item.id === button.dataset.renameNotebook);
    if (!notebook) return;
    $('rename-notebook-id').value = notebook.id;
    $('rename-notebook-name').value = notebook.name;
    $('rename-notebook-dialog').showModal();
    $('rename-notebook-name').focus();
  }));
  $('notes-notebook-grid').querySelectorAll('[data-delete-notebook]').forEach(button => button.addEventListener('click', () => {
    deleteNotebook(button.dataset.deleteNotebook);
  }));
  renderRecentNotes();
}

function renderRecentNotes() {
  const recent = notes.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 6);
  $('notes-recent-grid').innerHTML = recent.length
    ? recent.map(note => noteListMarkup(note, true)).join('')
    : '<p class="notes-recent-empty">Your recently edited notes will appear here.</p>';
  bindNoteSelection($('notes-recent-grid'), true);
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
  $('notes-active-notebook-name').textContent = activeNotebookKey === 'pinned'
    ? 'Pinned notes'
    : notebooks.find(item => notebookKey(item.name) === activeNotebookKey)?.name || 'Notebook';
  $('notes-position').textContent = editingNoteIsNew
    ? `New note · ${notebook.length} ${notebook.length === 1 ? 'note' : 'notes'}`
    : notebook.length ? `Note ${index + 1} of ${notebook.length}` : 'No notes';
  $('notes-prev-btn').disabled = editingNoteIsNew || index <= 0;
  $('notes-next-btn').disabled = editingNoteIsNew || index >= notebook.length - 1;
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
  return cleanMarkdownBody(value);
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

export function renderNoteDetail() {
  const note = notes.find(item => item.id === selectedNoteId);
  const detail = $('note-detail');
  const actionAttributes = ['data-note-edit', 'data-note-pin', 'data-note-cards', 'data-note-quiz',
    'data-note-tutor', 'data-note-export', 'data-note-json', 'data-note-delete'];
  const focusedAction = detail.contains(document.activeElement)
    ? actionAttributes.find(attribute => document.activeElement.hasAttribute(attribute))
    : null;
  releaseFitPaginator(detail.querySelector('.markdown-body'));
  $('note-editor-empty').classList.toggle('hidden', Boolean(note || editingNoteId));
  if (!note && !editingNoteId) {
    const hasSidebarSearch = Boolean($('notes-sidebar-search').value.trim());
    const notebookNotes = filteredNotesForNotebook(activeNotebookKey);
    $('note-editor-empty').querySelector('strong').textContent = hasSidebarSearch ? 'No matching notes' : 'No notes yet';
    $('note-empty-description').textContent = hasSidebarSearch
      ? 'Try another search or create a note.'
      : 'This notebook is empty. Create your first note.';
    $('note-create-first-btn').classList.toggle('hidden',
      notebookNotes.length > 0 || hasSidebarSearch);
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
      <div><h2 tabindex="-1">${escapeHtml(note.title || 'Untitled note')}</h2>
      <div class="note-detail-tags"><span class="pill">${escapeHtml(note.tag || 'General')}</span><span class="pill">${escapeHtml(note.unit || 'General')}</span>${normalizeNoteTags(note.tags).map(tag => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}${note.aiGenerated ? '<span class="pill ai">AI generated</span>' : ''}</div>
        <p class="note-card-meta">Edited ${escapeHtml(date.toLocaleString())}</p>
      </div>
      <div class="note-detail-actions">
        <button class="btn btn-sm" type="button" data-note-edit="${escapeHtml(note.id)}">Edit</button>
        <button class="btn btn-sm" type="button" data-note-cards="${escapeHtml(note.id)}">Make flashcards</button>
        <button class="btn btn-sm" type="button" data-note-quiz="${escapeHtml(note.id)}">Quiz me</button>
        <button class="btn btn-sm" type="button" data-note-tutor="${escapeHtml(note.id)}">Ask tutor</button>
        <details class="note-detail-more">
          <summary class="btn btn-sm" aria-label="More actions for ${escapeHtml(note.title || 'Untitled note')}" title="More note actions">More</summary>
          <div class="note-detail-more-menu scroll-region scroll-region-y" aria-label="More note actions">
            <button type="button" data-note-pin="${escapeHtml(note.id)}" aria-pressed="${Boolean(note.pinned)}">${note.pinned ? 'Unpin' : 'Pin'}</button>
            <button type="button" data-note-export="${escapeHtml(note.id)}">Export Markdown</button>
            <button type="button" data-note-json="${escapeHtml(note.id)}">Export JSON</button>
            <button type="button" data-note-delete="${escapeHtml(note.id)}">Delete note</button>
          </div>
        </details>
      </div>
    </header>
    ${toc}
    <div class="note-detail-body markdown-body scroll-region scroll-region-y" role="region" aria-label="Note content" tabindex="0">${renderMarkdown(note.body) || '<p class="hint">This note is empty. Edit it to add content.</p>'}</div>
    <button class="btn note-detail-back-to-top hidden" type="button" aria-label="Back to top of note" title="Back to top">↑ Back to top</button>
  `;
  const noteBody = detail.querySelector('.note-detail-body');
  const backToTop = detail.querySelector('.note-detail-back-to-top');
  noteBody.addEventListener('scroll', () => {
    backToTop.classList.toggle('hidden', noteBody.scrollTop < noteBody.clientHeight * 0.8);
  }, { passive: true });
  backToTop.addEventListener('click', () => {
    noteBody.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  });
  bindMarkdownCodeButtons(detail);
  renderMathInElementSafe(detail);
  detail.querySelector('[data-note-edit]').addEventListener('click', () => void startNoteEdit(note.id));
  detail.querySelector('[data-note-pin]').addEventListener('click', () => void toggleNotePin(note.id));
  detail.querySelector('[data-note-cards]').addEventListener('click', () => makeFlashcardsFromNote(note.id));
  detail.querySelector('[data-note-quiz]').addEventListener('click', () => quizFromNote(note.id));
  detail.querySelector('[data-note-tutor]').addEventListener('click', () => askTutorAboutNote(note.id));
  detail.querySelector('[data-note-export]').addEventListener('click', () => exportNoteMarkdown(note));
  detail.querySelector('[data-note-json]').addEventListener('click', () => downloadJSON(note, `${safeFileName(note.title || 'note')}.json`));
  detail.querySelector('[data-note-delete]').addEventListener('click', () => deleteNoteWithUndo(note.id));
  if (focusedAction) detail.querySelector(`[${focusedAction}]`)?.focus({ preventScroll: true });
}

export async function selectNote(id, notebookKey = null) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  const shouldFocusSelectedNote = document.activeElement.matches?.('[data-select-note]') || false;
  const targetNotebookKey = notebookKey || activeNotebookKey || noteNotebookKey(note);
  rememberOverviewPosition();
  if (editingNoteId && editingNoteId !== id) {
    if (!await closeNoteForm()) return;
  }
  activeNotebookKey = targetNotebookKey;
  selectedNoteId = id;
  $('notes-sidebar-search').value = '';
  if (notebookKey) {
    $('notes-search').value = '';
    $('notes-notebook-filter').value = 'all';
  }
  persistNotesReaderPosition();
  renderNotes();
  if (shouldFocusSelectedNote) {
    requestAnimationFrame(focusSelectedNote);
  }
}

function noteEditorValues() {
  return {
    title: $('note-title').value.trim(),
    tag: $('note-tag').value.trim(),
    unit: $('note-unit').value.trim(),
    tags: normalizeNoteTags($('note-tags-input').value),
    body: cleanNoteBody($('note-body').value)
  };
}

function noteDraftHasChanges() {
  if (!editingNoteId || !editingNoteOriginal) return false;
  return JSON.stringify(noteEditorValues()) !== JSON.stringify({
    title: editingNoteOriginal.title || '',
    tag: editingNoteOriginal.tag || '',
    unit: editingNoteOriginal.unit || '',
    tags: normalizeNoteTags(editingNoteOriginal.tags),
    body: cleanNoteBody(editingNoteOriginal.body)
  });
}

function renderNotePreview() {
  if (!editingNoteId) return;
  const changed = noteDraftHasChanges();
  $('note-save-status').textContent = changed ? 'Unsaved changes' : 'Saved';
  $('note-save-status').dataset.state = changed ? 'unsaved' : 'saved';
  $('save-note-btn').textContent = editingNoteIsNew ? 'Save note' : 'Save changes';
}

async function startNoteEdit(id) {
  if (editingNoteId === id && id) {
    $('note-title').focus();
    return;
  }
  if (editingNoteId && editingNoteId !== id && !await closeNoteForm()) return;
  openNoteForm(id);
}

function openNoteForm(id) {
  rememberOverviewPosition();
  const note = id ? notes.find(item => item.id === id) : null;
  if (id && !note) return;
  const defaultTag = activeNotebookKey === 'pinned'
    ? notes.find(item => item.id === selectedNoteId)?.tag || ''
    : notebooks.find(item => notebookKey(item.name) === activeNotebookKey)?.name
      || notes.find(item => noteNotebookKey(item) === activeNotebookKey)?.tag || '';
  editingNoteIsNew = !note;
  noteBeforeEditId = selectedNoteId;
  editingNoteOriginal = note ? { ...note, tags: normalizeNoteTags(note.tags) } : {
    title: '', tag: defaultTag, unit: '', tags: [], body: ''
  };
  selectedNoteId = note?.id || uid();
  if (note && activeNotebookKey !== 'pinned') activeNotebookKey = noteNotebookKey(note);
  editingNoteId = selectedNoteId;
  persistNotesReaderPosition();
  $('note-form').classList.remove('hidden');
  $('note-detail').classList.add('hidden');
  $('note-title').value = editingNoteOriginal.title || '';
  $('note-tag').value = editingNoteOriginal.tag || '';
  $('note-unit').value = editingNoteOriginal.unit || '';
  $('note-tags-input').value = normalizeNoteTags(editingNoteOriginal.tags).join(', ');
  $('note-body').value = cleanNoteBody(editingNoteOriginal.body);
  $('note-save-status').textContent = 'Saved';
  $('note-save-status').dataset.state = 'saved';
  $('save-note-btn').textContent = editingNoteIsNew ? 'Save note' : 'Save changes';
  renderNotes();
  $('note-title').focus();
}

async function saveNote() {
  if (!editingNoteId) return;
  const values = noteEditorValues();
  const existingNote = notes.find(item => item.id === editingNoteId);
  const previousNotebookKey = activeNotebookKey;
  const previousNotebooks = notebooks.map(notebook => ({ ...notebook }));
  const note = existingNote || {
    id: editingNoteId,
    aiGenerated: false,
    createdAt: Date.now()
  };
  const previousNote = existingNote ? { ...existingNote, tags: normalizeNoteTags(existingNote.tags) } : null;
  Object.assign(note, values, { updatedAt: Date.now() });
  if (!existingNote) notes.push(note);
  if (activeNotebookKey !== 'pinned') activeNotebookKey = noteNotebookKey(note);
  $('note-save-status').textContent = 'Saving…';
  $('note-save-status').dataset.state = 'saving';
  $('save-note-btn').disabled = true;
  if (!await saveNotesAndNotebooks()) {
    if (existingNote) Object.assign(existingNote, previousNote);
    else notes.splice(notes.indexOf(note), 1);
    notebooks = previousNotebooks;
    activeNotebookKey = previousNotebookKey;
    $('note-save-status').textContent = 'Could not save. Check storage permissions, then retry.';
    $('note-save-status').dataset.state = 'error';
    $('save-note-btn').textContent = 'Retry save';
    setStatus('notes-action-message', 'Could not save this note in browser storage. Check storage permissions and try again.');
    $('save-note-btn').disabled = false;
    return false;
  }
  editingNoteIsNew = false;
  editingNoteOriginal = { ...note, tags: normalizeNoteTags(note.tags) };
  $('note-save-status').textContent = 'Saved';
  $('note-save-status').dataset.state = 'saved';
  $('save-note-btn').textContent = 'Save changes';
  $('save-note-btn').disabled = false;
  persistNotesReaderPosition();
  updateStudyMaterialIndex();
  renderTaxonomy();
  renderNoteListOnly();
  return true;
}

function renderNoteListOnly() {
  renderNotes();
}

async function closeNoteForm() {
  if (noteDraftHasChanges()
    && !window.confirm('Discard your unsaved note changes?')) return false;
  const wasNew = editingNoteIsNew;
  editingNoteId = null;
  editingNoteOriginal = null;
  editingNoteIsNew = false;
  $('note-form').classList.add('hidden');
  if (wasNew) selectedNoteId = noteBeforeEditId;
  noteBeforeEditId = null;
  renderNotes();
  return true;
}

async function toggleNotePin(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  const wasPinned = Boolean(note.pinned);
  const previousUpdatedAt = note.updatedAt;
  note.pinned = !wasPinned;
  note.updatedAt = Date.now();
  if (!await saveNotesAndNotebooks()) {
    note.pinned = wasPinned;
    note.updatedAt = previousUpdatedAt;
    setStatus('notes-action-message', 'Could not save this change in browser storage. Please try again.');
    renderNotes();
    return;
  }
  setStatus('notes-action-message', note.pinned ? 'Note pinned.' : 'Note unpinned.');
  renderNotes();
}

async function backToNotebooks() {
  if (editingNoteId && !await closeNoteForm()) return;
  const returnNotebookKey = notes.find(note => note.id === selectedNoteId)
    ? noteNotebookKey(notes.find(note => note.id === selectedNoteId))
    : null;
  activeNotebookKey = '';
  lastRenderedNotebookKey = '';
  persistNotesReaderPosition();
  renderNotes();
  requestAnimationFrame(() => {
    $('panel-notes').scrollTop = overviewScrollTop;
    const notebookButton = [...$('notes-notebook-grid').querySelectorAll('[data-open-notebook]')]
      .find(button => button.dataset.openNotebook === returnNotebookKey);
    (notebookButton || $('notes-notebooks-view').querySelector('[data-create-notebook]'))?.focus({ preventScroll: true });
  });
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
  if (editingNoteId === id && !await closeNoteForm()) return;
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
  notes = state.notes;
  if (!await saveNotesAndNotebooks()) {
    setStatus('notes-action-message', 'The note was removed, but the change could not be confirmed in browser storage.');
  }
  renderNotes();
}

function makeFlashcardsFromNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note?.body.trim()) return;
  emit('notes:make-flashcards', { note });
}

function quizFromNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note?.body.trim()) return;
  emit('notes:make-quiz', { note });
}

function askTutorAboutNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;
  emit('notes:ask-tutor', { note });
}

async function generateNotesFromDocument() {
  const doc = getDocuments().find(d => d.id === $('notes-doc-select').value);
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
    const previousSelectedNoteId = selectedNoteId;
    const previousNotebooks = notebooks.map(notebook => ({ ...notebook }));
    const generatedNote = {
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
    };
    notes.push(generatedNote);
    selectedNoteId = notes.at(-1).id;
    if (!await saveNotesAndNotebooks()) {
      notes.splice(notes.indexOf(generatedNote), 1);
      selectedNoteId = previousSelectedNoteId;
      notebooks = previousNotebooks;
      throw new Error('Could not save the generated note in browser storage. Check storage permissions and try again.');
    }
    setStatus('notes-ai-status', 'AI note added.');
    renderEverything();
  } catch (err) {
    setStatus('notes-ai-status', err.message || 'Could not generate notes.');
  } finally {
    $('generate-notes-btn').disabled = false;
  }
}


export async function initializeNoteCleanup() {
  if (await dependencies.idbGet(NOTE_CLEANUP_KEY) !== 1) {
    const cleanedNotes = notes.map(note => ({ ...note, body: cleanNoteBody(note.body) }));
    notes.splice(0, notes.length, ...cleanedNotes);
    await idbSet('notes', notes);
    await idbSet(NOTE_CLEANUP_KEY, 1);
  }
}

export function init(deps) {
  dependencies = deps;
  $('notes-notebooks-view').querySelector('[data-create-notebook]').addEventListener('click', openCreateNotebookDialog);
  $('new-note-btn').addEventListener('click', () => void startNoteEdit(null));
  $('note-create-first-btn').addEventListener('click', () => void startNoteEdit(null));
  $('cancel-note-btn').addEventListener('click', () => void closeNoteForm());
  $('save-note-btn').addEventListener('click', () => void saveNote());
  $('notes-search').addEventListener('input', updateNotesFilters);
  $('notes-notebook-filter').addEventListener('change', updateNotesFilters);
  $('notes-sidebar-search').addEventListener('input', renderNotes);
  $('notes-clear-filters').addEventListener('click', clearNotesFilters);
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
  $('create-notebook-form').addEventListener('submit', event => {
    event.preventDefault();
    void createNotebook();
  });
  $('rename-notebook-form').addEventListener('submit', event => {
    event.preventDefault();
    void renameNotebook();
  });
  document.querySelectorAll('[data-close-notebook-dialog]').forEach(button => button.addEventListener('click', () => {
    button.closest('dialog').close();
  }));
  $('panel-notes').addEventListener('scroll', () => {
    const panel = $('panel-notes');
    const toolbar = $('notes-toolbar');
    toolbar.classList.toggle('is-scrolled', panel.scrollTop > 0);
    $('notes-back-to-top').classList.toggle('hidden',
      panel.classList.contains('notes-workspace-active') || panel.scrollTop < panel.clientHeight * 0.8);
  }, { passive: true });
  $('notebook-note-list').addEventListener('scroll', () => {
    $('notes-sidebar-search').classList.toggle('is-scrolled', $('notebook-note-list').scrollTop > 0);
  }, { passive: true });
  $('panel-notes').addEventListener('keydown', event => {
    if (event.key === 'Escape' && editingNoteId) {
      event.preventDefault();
      void closeNoteForm();
      return;
    }
    const openMenu = $('panel-notes').querySelector('details[open]');
    if (!openMenu) return;
    const menuItems = [...openMenu.querySelectorAll('button:not(:disabled)')];
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      openMenu.open = false;
      openMenu.querySelector('summary').focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && menuItems.length) {
      event.preventDefault();
      const currentIndex = menuItems.indexOf(document.activeElement);
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? menuItems.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
      menuItems[nextIndex].focus();
    }
  });
  window.addEventListener('resize', () => {
    const workspace = $('notes-workspace');
    if (workspace.classList.contains('hidden')) return;
    workspace.classList.toggle('mobile-detail-open', window.matchMedia('(max-width: 520px)').matches
      && Boolean(selectedNoteId || editingNoteId || filteredNotesForNotebook(activeNotebookKey).length === 0));
  });
  $('notes-back-to-top').addEventListener('click', () => {
    $('panel-notes').scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  });
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
      const openMenu = $('notes-notebook-grid').querySelector('details[open]');
      if (openMenu) {
        openMenu.open = false;
        openMenu.querySelector('summary').focus();
        return;
      }
      event.preventDefault();
      backToNotebooks();
    }
  });
  $('generate-notes-btn').addEventListener('click', generateNotesFromDocument);
  $('export-notes-btn').addEventListener('click', () => downloadJSON(notes, 'margin-notes.json'));
  $('import-notes-btn').addEventListener('click', () => $('import-notes-file').click());
  $('import-notes-file').addEventListener('change', event => readJSONFile(event.target.files[0], async data => {
    if (Array.isArray(data)) {
      const previousLength = notes.length;
      const previousSelectedNoteId = selectedNoteId;
      const previousNotebooks = notebooks.map(notebook => ({ ...notebook }));
      data.forEach(note => notes.push({
        id: uid(),
        title: note.title || '',
        tag: note.tag || '',
        unit: note.unit || '',
        tags: normalizeNoteTags(note.tags),
        body: cleanNoteBody(note.body),
        aiGenerated: !!note.aiGenerated,
        createdAt: note.createdAt || Date.now(),
        updatedAt: note.updatedAt || Date.now()
      }));
      selectedNoteId = notes.at(-1)?.id || selectedNoteId;
      if (selectedNoteId) activeNotebookKey = noteNotebookKey(notes.find(note => note.id === selectedNoteId));
      ensureNotebooksForNotes();
      persistNotesReaderPosition();
      if (!await saveNotesAndNotebooks()) {
        notes.splice(previousLength);
        notebooks = previousNotebooks;
        selectedNoteId = previousSelectedNoteId;
        if (selectedNoteId) activeNotebookKey = noteNotebookKey(notes.find(note => note.id === selectedNoteId));
        persistNotesReaderPosition();
        setStatus('notes-action-message', 'Could not save imported notes in browser storage.');
      }
      renderEverything();
    }
  }));
  on('tutor:save-note', async ({ question, text }) => {
    const now = Date.now();
    const previousSelectedNoteId = selectedNoteId;
    const previousNotebooks = notebooks.map(notebook => ({ ...notebook }));
    notes.push({
      id: uid(),
      title: (question || 'Tutor reply').slice(0, 60),
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
    ensureNotebooksForNotes();
    persistNotesReaderPosition();
    if (!await saveNotesAndNotebooks()) {
      notes.pop();
      notebooks = previousNotebooks;
      selectedNoteId = previousSelectedNoteId;
      if (previousSelectedNoteId) activeNotebookKey = noteNotebookKey(notes.find(note => note.id === previousSelectedNoteId));
      persistNotesReaderPosition();
      dependencies.setChatRequestStatus('Could not save this note in browser storage.');
      return;
    }
    renderEverything();
    dependencies.setChatRequestStatus('Saved to notes.');
  });
}

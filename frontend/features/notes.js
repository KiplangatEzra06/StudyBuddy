import { state } from '../shared/state.js';
import { $, escapeHtml, setStatus } from '../shared/dom.js';
import { uid, truncateText, safeFileName, slugify } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbGet, idbSet } from '../services/storage.js';
import { confirmDeletion, softDeleteRecords } from '../shared/undo.js';
import { downloadJSON, downloadText, readJSONFile } from '../shared/files.js';
import { releaseFitPaginator } from '../shared/fit-paginator.js';
import { NOTE_CLEANUP_KEY, NOTES_NOTEBOOK_KEY, NOTES_SELECTED_NOTE_KEY } from '../shared/constants.js';
import { bindMarkdownCodeButtons, cleanNoteBody, renderMarkdown } from '../shared/markdown.js';

let callAI = async () => ({});
let aiDocumentPayload = doc => ({
  id: doc.id,
  title: doc.title,
  course: doc.course,
  unit: doc.unit,
  text: truncateText(doc.extractedText, 14000)
});
let renderEverything = () => {};
let updateStudyMaterialIndex = () => {};
let renderTaxonomy = () => {};

export function renderNotes() {
  const query = $('notes-search').value.trim().toLocaleLowerCase();
  const filtered = sortNotes(state.notes.filter(note => !query || noteMatchesQuery(note, query)));
  const notebookGrid = $('notes-notebook-grid');
  const searchResults = $('notes-search-results');
  const workspace = $('notes-workspace');
  const readerNav = $('notes-reader-nav');
  const notebook = filteredNotesForNotebook(state.activeNotebookKey);
  if (state.activeNotebookKey && !notebook.length) {
    state.activeNotebookKey = '';
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
  if (!state.activeNotebookKey) {
    $('notes-notebooks-view').classList.remove('hidden');
    workspace.classList.add('hidden');
    readerNav.classList.add('hidden');
    $('notes-empty').classList.toggle('hidden', state.notes.length > 0);
    renderNotebookTiles();
    return;
  }

  $('notes-notebooks-view').classList.add('hidden');
  $('notes-empty').classList.add('hidden');
  workspace.classList.remove('hidden');
  workspace.classList.remove('mobile-detail-open');
  readerNav.classList.remove('hidden');
  if (!notebook.some(note => note.id === state.selectedNoteId)) {
    state.selectedNoteId = notebook[0]?.id || null;
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

export function noteNotebookKey(note) {
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
  return sortNotes(state.notes.filter(note => key === 'pinned'
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
  const notebook = searchResult || state.activeNotebookKey === 'pinned'
    ? `<span class="note-card-course">${escapeHtml(notebookLabel)}</span>`
    : '';
  const preview = notePlainText(note.body);
  return `<button class="note-card notebook-note-item ${note.id === state.selectedNoteId ? 'selected' : ''}" type="button" data-select-note="${escapeHtml(note.id)}" aria-pressed="${note.id === state.selectedNoteId}">
    <span class="note-card-topline">${notebook}<span class="note-item-pin" ${note.pinned ? 'aria-label="Pinned"' : 'aria-hidden="true"'}>${note.pinned ? '★' : ''}</span></span>
    <strong>${title}</strong>
    ${preview ? `<span class="note-card-preview">${escapeHtml(preview.slice(0, 150))}${preview.length > 150 ? '…' : ''}</span>` : ''}
    <span class="note-card-meta">Edited ${escapeHtml(noteEditedDate(note))}</span>
  </button>`;
}

function bindNoteSelection(container, fromSearch = false) {
  container.querySelectorAll('[data-select-note]').forEach(button => button.addEventListener('click', () => {
    const note = state.notes.find(item => item.id === button.dataset.selectNote);
    if (!note) return;
    selectNote(note.id, fromSearch ? noteNotebookKey(note) : null);
  }));
}

function renderNotebookTiles() {
  const groups = new Map();
  state.notes.forEach(note => {
    const key = noteNotebookKey(note);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  });
  const notebooks = [...groups.entries()]
    .sort((a, b) => noteNotebookName(a[1][0]).localeCompare(noteNotebookName(b[1][0])));
  const tiles = [];
  const pinnedNotes = state.notes.filter(note => note.pinned);
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
    state.activeNotebookKey = button.dataset.openNotebook;
    const notebook = filteredNotesForNotebook(state.activeNotebookKey);
    state.selectedNoteId = notebook.find(note => note.id === state.selectedNoteId)?.id || notebook[0]?.id || null;
    persistNotesReaderPosition();
    renderNotes();
  }));
}

export function persistNotesReaderPosition() {
  if (state.activeNotebookKey) sessionStorage.setItem(NOTES_NOTEBOOK_KEY, state.activeNotebookKey);
  else sessionStorage.removeItem(NOTES_NOTEBOOK_KEY);
  if (state.selectedNoteId) sessionStorage.setItem(NOTES_SELECTED_NOTE_KEY, state.selectedNoteId);
  else sessionStorage.removeItem(NOTES_SELECTED_NOTE_KEY);
}

function renderNotebookReaderNav(notebook) {
  const selectedIndex = notebook.findIndex(note => note.id === state.selectedNoteId);
  const index = selectedIndex < 0 ? 0 : selectedIndex;
  $('notes-position').textContent = notebook.length ? `Note ${index + 1} of ${notebook.length}` : 'No notes';
  $('notes-prev-btn').disabled = index <= 0;
  $('notes-next-btn').disabled = index >= notebook.length - 1;
  $('notebook-note-select').innerHTML = notebook.map((note, noteIndex) => {
    const prefix = state.activeNotebookKey === 'pinned' ? `${noteNotebookName(note)} · ` : '';
    return `<option value="${escapeHtml(note.id)}">${noteIndex + 1}. ${escapeHtml(prefix + (note.title || 'Untitled'))}</option>`;
  }).join('');
  $('notebook-note-select').value = state.selectedNoteId || '';
}

function navigateNotebookNote(direction) {
  if (state.editingNoteId) return;
  const notebook = filteredNotesForNotebook(state.activeNotebookKey);
  const index = notebook.findIndex(note => note.id === state.selectedNoteId);
  const next = notebook[index + direction];
  if (next) selectNote(next.id);
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

function renderNoteDetail() {
  const note = state.notes.find(item => item.id === state.selectedNoteId);
  const detail = $('note-detail');
  releaseFitPaginator(detail.querySelector('.markdown-body'));
  $('note-editor-empty').classList.toggle('hidden', Boolean(note));
  if (!note) {
    $('note-editor-empty').querySelector('strong').textContent = state.notes.length ? 'No matching notes' : 'No notes yet';
    $('note-editor-empty').querySelector('span:last-child').textContent = state.notes.length
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
    await idbSet('notes', state.notes);
    renderNotes();
  });
  detail.querySelector('[data-note-cards]').addEventListener('click', () => makeFlashcardsFromNote(note.id));
  detail.querySelector('[data-note-quiz]').addEventListener('click', () => emit('quiz:from-note', note.id));
  detail.querySelector('[data-note-tutor]').addEventListener('click', () => askTutorAboutNote(note.id));
  detail.querySelector('[data-note-export]').addEventListener('click', () => exportNoteMarkdown(note));
  detail.querySelector('[data-note-json]').addEventListener('click', () => downloadJSON(note, `${safeFileName(note.title || 'note')}.json`));
  detail.querySelector('[data-note-delete]').addEventListener('click', () => deleteNoteWithUndo(note.id));
}

async function selectNote(id, notebookKey = null) {
  const note = state.notes.find(item => item.id === id);
  if (!note) return;
  const targetNotebookKey = notebookKey || state.activeNotebookKey || noteNotebookKey(note);
  if (state.editingNoteId && state.editingNoteId !== id) {
    await saveNote();
    state.editingNoteId = null;
  }
  state.activeNotebookKey = targetNotebookKey;
  state.selectedNoteId = id;
  persistNotesReaderPosition();
  $('note-form').classList.add('hidden');
  renderNotes();
}

function renderNotePreview() {
  if (!state.editingNoteId) return;
  const note = state.notes.find(item => item.id === state.editingNoteId);
  if (!note) return;
  note.title = $('note-title').value.trim();
  note.tag = $('note-tag').value.trim();
  note.unit = $('note-unit').value.trim();
  note.tags = normalizeNoteTags($('note-tags-input').value);
  note.body = cleanNoteBody($('note-body').value);
  note.updatedAt = Date.now();
  if (state.activeNotebookKey !== 'pinned') state.activeNotebookKey = noteNotebookKey(note);
  $('note-save-status').textContent = 'Unsaved changes';
  clearTimeout(state.noteAutosaveTimer);
  state.noteAutosaveTimer = setTimeout(saveNote, 650);
}

function openNoteForm(id) {
  let note = state.notes.find(item => item.id === id);
  if (!note) {
    const now = Date.now();
    const defaultTag = state.activeNotebookKey === 'pinned'
      ? state.notes.find(item => item.id === state.selectedNoteId)?.tag || ''
      : state.notes.find(item => noteNotebookKey(item) === state.activeNotebookKey)?.tag || '';
    note = { id: uid(), title: '', tag: defaultTag, unit: '', tags: [], body: '', aiGenerated: false, createdAt: now, updatedAt: now };
    state.notes.push(note);
  }
  state.selectedNoteId = note.id;
  if (state.activeNotebookKey !== 'pinned') state.activeNotebookKey = noteNotebookKey(note);
  persistNotesReaderPosition();
  state.editingNoteId = note.id;
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
  clearTimeout(state.noteAutosaveTimer);
  if (!state.editingNoteId) return;
  const note = state.notes.find(item => item.id === state.editingNoteId);
  if (!note) return;
  note.title = $('note-title').value.trim();
  note.tag = $('note-tag').value.trim();
  note.unit = $('note-unit').value.trim();
  note.tags = normalizeNoteTags($('note-tags-input').value);
  note.body = cleanNoteBody($('note-body').value);
  note.updatedAt = Date.now();
  if (state.activeNotebookKey !== 'pinned') state.activeNotebookKey = noteNotebookKey(note);
  persistNotesReaderPosition();
  await idbSet('notes', state.notes);
  $('note-save-status').textContent = 'Saved';
  updateStudyMaterialIndex();
  renderTaxonomy();
  renderNoteListOnly();
}

function renderNoteListOnly() {
  renderNotes();
}

function closeNoteForm() {
  if (state.editingNoteId) saveNote();
  $('note-form').classList.add('hidden');
  state.editingNoteId = null;
  renderNotes();
}

async function backToNotebooks() {
  if (state.editingNoteId) {
    await saveNote();
    state.editingNoteId = null;
    $('note-form').classList.add('hidden');
  }
  state.activeNotebookKey = '';
  persistNotesReaderPosition();
  renderNotes();
}


function exportNoteMarkdown(note) {
  const content = `# ${note.title || 'Untitled note'}\n\n${note.body || ''}\n`;
  downloadText(content, `${safeFileName(note.title || 'note')}.md`, 'text/markdown');
}


async function deleteNoteWithUndo(id) {
  const note = state.notes.find(item => item.id === id);
  if (!note) return;
  const confirmed = await confirmDeletion({
    title: `Delete note "${note.title || 'Untitled note'}"?`,
    description: 'This will remove the saved note and its formatted content.',
    affected: 'Flashcards or quiz results created from this note are not changed.'
  });
  if (!confirmed) return;
  state.selectedNoteId = state.notes.filter(item => item.id !== id).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0]?.id || null;
  await softDeleteRecords([{ collection: 'notes', ids: [id] }], 'Note deleted.');
}

async function makeFlashcardsFromNote(id) {
  const note = state.notes.find(item => item.id === id);
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
    await new Promise((resolve, reject) => {
      emit('flashcards:create-from-note', {
        records,
        noteTitle: note.title,
        onComplete: resolve,
        onError: reject
      });
    });
  } catch (error) {
    setStatus('notes-ai-status', error.message || 'Could not generate flashcards.');
  }
}

function askTutorAboutNote(id) {
  const note = state.notes.find(item => item.id === id);
  if (!note) return;
  emit('tutor:ask-about-note', { note });
}

async function generateNotesFromDocument() {
  const doc = state.documents.find(d => d.id === $('notes-doc-select').value);
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
    state.notes.push({
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
    state.selectedNoteId = state.notes.at(-1).id;
    await idbSet('notes', state.notes);
    setStatus('notes-ai-status', 'AI note added.');
    renderEverything();
  } catch (err) {
    setStatus('notes-ai-status', err.message || 'Could not generate notes.');
  } finally {
    $('generate-notes-btn').disabled = false;
  }
}

export async function cleanupStoredNotes() {
  if (await idbGet(NOTE_CLEANUP_KEY) !== 1) {
    state.notes = state.notes.map(note => ({ ...note, body: cleanNoteBody(note.body) }));
    await idbSet('notes', state.notes);
    await idbSet(NOTE_CLEANUP_KEY, 1);
  }
}

export function init(deps = {}) {
  callAI = deps.callAI || callAI;
  aiDocumentPayload = deps.aiDocumentPayload || aiDocumentPayload;
  renderEverything = deps.renderEverything || renderEverything;
  updateStudyMaterialIndex = deps.updateStudyMaterialIndex || updateStudyMaterialIndex;
  renderTaxonomy = deps.renderTaxonomy || renderTaxonomy;

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
    if (!state.activeNotebookKey
      || $('notes-workspace').classList.contains('hidden')
      || state.editingNoteId
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
  $('export-notes-btn').addEventListener('click', () => downloadJSON(state.notes, 'margin-notes.json'));
  $('import-notes-btn').addEventListener('click', () => $('import-notes-file').click());
  $('import-notes-file').addEventListener('change', e => readJSONFile(e.target.files[0], data => {
    if (Array.isArray(data)) {
      data.forEach(n => state.notes.push({ id: uid(), title: n.title || '', tag: n.tag || '', unit: n.unit || '', tags: normalizeNoteTags(n.tags), body: cleanNoteBody(n.body), aiGenerated: !!n.aiGenerated, createdAt: n.createdAt || Date.now(), updatedAt: n.updatedAt || Date.now() }));
      state.selectedNoteId = state.notes.at(-1)?.id || state.selectedNoteId;
      if (state.selectedNoteId) state.activeNotebookKey = noteNotebookKey(state.notes.find(note => note.id === state.selectedNoteId));
      persistNotesReaderPosition();
      idbSet('notes', state.notes);
      renderEverything();
    }
  }));
}

import fs from 'node:fs';

const runtimePath = 'frontend/app/runtime.js';
const raw = fs.readFileSync(runtimePath, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join(nl);
}

const notesParts = [
  slice(1920, 2105),
  slice(2120, 2138),
  slice(2369, 2618)
].join('\n\n').replace(/\r\n/g, '\n');

let notesBody = notesParts
  .replace(/^function renderNotes\(/m, 'export function renderNotes(')
  .replace(/^function noteNotebookKey\(/m, 'export function noteNotebookKey(')
  .replace(/^function persistNotesReaderPosition\(/m, 'export function persistNotesReaderPosition(')
  .replace('quizFromNote(note.id)', "emit('quiz:from-note', note.id)")
  .replace(
    `    await importFlashcardRecords(records);
    activatePage('cards');
    setFlashcardsView('cards');
    setStatus('cards-ai-status', \`Added \${records.length} cards from \${note.title || 'your note'}.\`);`,
    `    await new Promise((resolve, reject) => {
      emit('flashcards:create-from-note', {
        records,
        noteTitle: note.title,
        onComplete: resolve,
        onError: reject
      });
    });`
  )
  .replace(
    `  activatePage('tutor');
  $('tutor-use-material').checked = true;
  localStorage.setItem(TUTOR_MATERIAL_KEY, 'true');
  $('settings-tutor-material').checked = true;
  $('tutor-study-scope').value = 'all';
  $('chat-input').value = \`Help me understand the main ideas in my note "\${note.title || 'Untitled note'}".\`;
  $('chat-input').focus();`,
    `  emit('tutor:ask-about-note', { note });`
  );

const notesFile = `import { state } from '../shared/state.js';
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

${notesBody}

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
`;

let markdownBody = [slice(2107, 2118), slice(2141, 2367)].join('\n\n').replace(/\r\n/g, '\n');
markdownBody = markdownBody.replace(/^function /gm, 'export function ');

const markdownFile = `import { state } from './state.js';
import { $, escapeHtml } from './dom.js';
import { slugify } from './format.js';

${markdownBody}

export function init() {
  $('code-dialog-close').addEventListener('click', () => $('code-dialog').close());
}
`;

if (!notesBody.includes("emit('quiz:from-note', note.id)")) throw new Error('quiz emit missing');
if (!notesBody.includes("emit('flashcards:create-from-note'")) throw new Error('flashcards emit missing');
if (!notesBody.includes("emit('tutor:ask-about-note'")) throw new Error('tutor emit missing');
if (notesBody.includes('quizFromNote') || notesBody.includes('importFlashcardRecords') || notesBody.includes('activatePage')) {
  throw new Error('cross-feature calls remain in notes');
}
if (notesBody.includes('function renderMarkdown') || notesBody.includes('function cleanNoteBody')) {
  throw new Error('markdown helpers remain in notes');
}
if (!markdownBody.includes('export function cleanNoteBody') || !markdownBody.includes('export function renderMarkdown') || !markdownBody.includes('export function normalizeTutorReply')) {
  throw new Error('markdown exports missing');
}

const toNative = text => (nl === '\n' ? text : text.replace(/\n/g, nl));
fs.writeFileSync('frontend/features/notes.js', toNative(notesFile));
fs.writeFileSync('frontend/shared/markdown.js', toNative(markdownFile));

const removed = new Set();
for (let n = 1920; n <= 2618; n++) removed.add(n - 1);
const kept = lines.filter((_, index) => !removed.has(index));
let next = kept.join(nl);
if (!next.endsWith(nl) && raw.endsWith(nl)) next += nl;

const listenerStart = "$('new-note-btn').addEventListener('click', () => openNoteForm(null));";
const listenerEnd = "$('export-all-data-btn').addEventListener('click', () => {";
const start = next.indexOf(listenerStart);
const end = next.indexOf(listenerEnd);
if (start < 0 || end < 0 || end < start) throw new Error(`listener block not found ${start} ${end}`);
next = next.slice(0, start) + next.slice(end);

next = next.replace(
  "$('code-dialog-close').addEventListener('click', () => $('code-dialog').close());" + nl,
  ''
);

const cleanupBlock = [
  '  if (await idbGet(NOTE_CLEANUP_KEY) !== 1) {',
  '    state.notes = state.notes.map(note => ({ ...note, body: cleanNoteBody(note.body) }));',
  "    await idbSet('notes', state.notes);",
  '    await idbSet(NOTE_CLEANUP_KEY, 1);',
  '  }'
].join(nl);
if (!next.includes(cleanupBlock)) throw new Error('cleanup block not found');
next = next.replace(cleanupBlock, '  await cleanupStoredNotes();');

next = next.replace(
  `import { renderTutorMarkdown } from '../features/tutor-markdown.js';
import { state } from '../shared/state.js';
import {
  TUTOR_MATERIAL_KEY,
  NOTE_CLEANUP_KEY,
  NOTES_NOTEBOOK_KEY,
  NOTES_SELECTED_NOTE_KEY,
  FLASHCARD_IMPORT_DONE_KEY,`,
  `import { renderTutorMarkdown } from '../features/tutor-markdown.js';
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
  FLASHCARD_IMPORT_DONE_KEY,`
);

next = next.replace(`  safeFileName,
  normalizeAnswer,`, '  normalizeAnswer,');
next = next.replace(`  shuffle,
  slugify
} from '../shared/format.js';`, `  shuffle
} from '../shared/format.js';`);
next = next.replace(`  showFitItem,
  releaseFitPaginator
} from '../shared/fit-paginator.js';`, `  showFitItem
} from '../shared/fit-paginator.js';`);
next = next.replace(
  `import { downloadJSON, readJSONFile, downloadText } from '../shared/files.js';`,
  `import { downloadJSON } from '../shared/files.js';`
);
next = next.replace(`  init as initQuiz,
  quizFromNote
} from '../features/quiz.js';`, `  init as initQuiz
} from '../features/quiz.js';`);

const busHandlers = [
  "on('flashcards:create-from-note', async ({ records, noteTitle, onComplete, onError }) => {",
  '  try {',
  '    await importFlashcardRecords(records);',
  "    activatePage('cards');",
  "    setFlashcardsView('cards');",
  "    setStatus('cards-ai-status', `Added ${records.length} cards from ${noteTitle || 'your note'}.`);",
  '    onComplete?.();',
  '  } catch (error) {',
  '    onError?.(error);',
  '  }',
  '});',
  "on('tutor:ask-about-note', ({ note }) => {",
  "  activatePage('tutor');",
  "  $('tutor-use-material').checked = true;",
  "  localStorage.setItem(TUTOR_MATERIAL_KEY, 'true');",
  "  $('settings-tutor-material').checked = true;",
  "  $('tutor-study-scope').value = 'all';",
  "  $('chat-input').value = `Help me understand the main ideas in my note \"${note.title || 'Untitled note'}\".`;",
  "  $('chat-input').focus();",
  '});'
].join(nl);

const mistakesHandler = "on('flashcards:create-from-mistakes', async ({ records, onComplete, onError }) => {";
if (!next.includes(mistakesHandler)) throw new Error('mistakes handler missing');
next = next.replace(mistakesHandler, `${busHandlers}${nl}${mistakesHandler}`);

const initQuizCall = `  initQuiz({
    callAI,
    aiDocumentPayload,
    activatePage,
    renderProgress
  });`;
if (!next.includes(initQuizCall)) throw new Error('initQuiz call missing');
next = next.replace(initQuizCall, `${initQuizCall}${nl}  initMarkdown();${nl}  initNotes({${nl}    callAI,${nl}    aiDocumentPayload,${nl}    renderEverything,${nl}    updateStudyMaterialIndex,${nl}    renderTaxonomy${nl}  });`);

if (next.includes('NOTE_CLEANUP_KEY') || next.includes('openNoteForm') || next.includes('function renderNotes') || next.includes('quizFromNote')) {
  throw new Error('runtime still contains moved note code');
}
if (!next.includes('cleanupStoredNotes') || !next.includes('initNotes') || !next.includes("emit") && !next.includes('tutor:ask-about-note')) {
  throw new Error('runtime wiring missing');
}
if (!next.includes('tutor:ask-about-note') || !next.includes('flashcards:create-from-note')) {
  throw new Error('bus handlers missing');
}

fs.writeFileSync(runtimePath, next);
console.log('extracted', { nl: JSON.stringify(nl), notes: notesFile.length, markdown: markdownFile.length });

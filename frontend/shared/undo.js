import { state } from './state.js';
import { $, setStatus } from './dom.js';
import { uid } from './format.js';
import { idbSet } from '../services/storage.js';

let flashcardApi;
let refreshFlashcardData;
let renderEverything;

const undoableCollections = {
  get documents() { return state.documents; },
  set documents(value) { state.documents = value; },
  get cards() { return state.cards; },
  set cards(value) { state.cards = value; },
  get notes() { return state.notes; },
  set notes(value) { state.notes = value; },
  get quizResults() { return state.quizResults; },
  set quizResults(value) { state.quizResults = value; },
  get timerSessions() { return state.timerSessions; },
  set timerSessions(value) { state.timerSessions = value; },
  get classes() { return state.classes; },
  set classes(value) { state.classes = value; },
  get assignments() { return state.assignments; },
  set assignments(value) { state.assignments = value; },
  get tutorConversations() { return state.tutorConversations; },
  set tutorConversations(value) { state.tutorConversations = value; }
};

export function initUndo(deps) {
  flashcardApi = deps.flashcardApi;
  refreshFlashcardData = deps.refreshFlashcardData;
  renderEverything = deps.renderEverything;
}

export function confirmDeletion({ title, description, affected = '', choices, bulk = false }) {
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

export async function softDeleteRecords(changes, message, updates = []) {
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
  state.deletedRecords.push(snapshot);
  await idbSet('deletedRecords', state.deletedRecords);
  showUndoToast(snapshot, message);
  renderEverything();
  state.undoTimers.set(snapshot.id, setTimeout(() => purgeUndoSnapshot(snapshot.id), 8000));
}

function showUndoToast(snapshot, message) {
  $('undo-toast-message').textContent = message;
  $('undo-toast').classList.remove('hidden');
  $('undo-toast-action').onclick = () => undoDelete(snapshot.id);
}

async function purgeUndoSnapshot(id) {
  const snapshot = state.deletedRecords.find(item => item.id === id);
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
      state.undoTimers.set(snapshot.id, setTimeout(() => purgeUndoSnapshot(snapshot.id), 8000));
      await idbSet('deletedRecords', state.deletedRecords);
      return;
    }
  }
  state.undoTimers.delete(id);
  state.deletedRecords = state.deletedRecords.filter(snapshot => snapshot.id !== id);
  await idbSet('deletedRecords', state.deletedRecords);
  if (state.deletedRecords.length) showUndoToast(state.deletedRecords.at(-1), 'An item was deleted.');
  else $('undo-toast').classList.add('hidden');
}

async function undoDelete(id) {
  const index = state.deletedRecords.findIndex(snapshot => snapshot.id === id);
  if (index < 0) return;
  const [snapshot] = state.deletedRecords.splice(index, 1);
  clearTimeout(state.undoTimers.get(id));
  state.undoTimers.delete(id);
  try {
    const deletedCards = snapshot.entries.find(entry => entry.collection === 'cards')?.records || [];
    await Promise.all(deletedCards.map(card => flashcardApi(
      `/api/cards/${encodeURIComponent(card.id)}/restore`,
      {},
      'POST'
    )));
  } catch (error) {
    state.deletedRecords.splice(index, 0, snapshot);
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
  await idbSet('deletedRecords', state.deletedRecords);
  renderEverything();
  if (state.deletedRecords.length) showUndoToast(state.deletedRecords.at(-1), 'An item was deleted.');
  else $('undo-toast').classList.add('hidden');
}

export function confirmBulkDeletion(description) {
  return confirmDeletion({
    title: 'Confirm bulk deletion',
    description,
    affected: 'This action cannot be undone. Export a backup first if you may need these records.',
    bulk: true
  });
}

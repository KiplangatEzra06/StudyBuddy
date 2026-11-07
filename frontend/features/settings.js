import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_LOCAL_SETTINGS,
  BACKUP_VERSION,
  mergeRecords,
  validateBackup
} from '../shared/backup-data.js';
import { state } from '../shared/state.js';
import { $, setStatus } from '../shared/dom.js';
import { downloadJSON } from '../shared/files.js';
import { THEME_KEY } from '../shared/constants.js';
import { openDB, STORE, idbSet } from '../services/storage.js';

let dependencies;

export function effectiveTheme() {
  const selected = document.documentElement.dataset.theme || 'system';
  return selected === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : selected;
}

export function setTheme(theme) {
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

export async function saveBackupCollections(collections) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    BACKUP_COLLECTIONS.filter(key => key !== 'cards').forEach(key => tx.objectStore(STORE).put({ key, value: collections[key] }));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save imported data.'));
    tx.onabort = () => reject(tx.error || new Error('Import was cancelled before it could be saved.'));
  });
}

export async function importAllData(file) {
  const backup = validateBackup(JSON.parse(await file.text()));
  const current = {
    documents: state.documents,
    cards: state.cards,
    notes: state.notes,
    quizResults: state.quizResults,
    timerSessions: state.timerSessions,
    classes: state.classes,
    assignments: state.assignments,
    tutorConversations: state.tutorConversations
  };
  const merged = {};
  BACKUP_COLLECTIONS.forEach(key => {
    if (key === 'cards') {
      merged.cards = state.cards;
      return;
    }
    merged[key] = mergeRecords(current[key], backup[key]);
  });
  await dependencies.importFlashcardRecords(backup.cards);
  merged.cards = state.cards;
  await saveBackupCollections(merged);
  state.documents = merged.documents;
  state.notes.splice(0, state.notes.length, ...merged.notes);
  state.quizResults = merged.quizResults;
  state.timerSessions = merged.timerSessions;
  state.classes = merged.classes;
  state.assignments = merged.assignments;
  state.tutorConversations = merged.tutorConversations;
  state.activeTutorConversationId = state.tutorConversations.some(item => item.id === state.activeTutorConversationId)
    ? state.activeTutorConversationId
    : state.tutorConversations[0]?.id || null;
  state.tutorChatHistory = state.tutorConversations.find(item => item.id === state.activeTutorConversationId)?.messages || [];
  await dependencies.persistTutorConversations();
  Object.entries(backup.localSettings).forEach(([key, value]) => localStorage.setItem(key, value));
  if (backup.localSettings[THEME_KEY]) setTheme(backup.localSettings[THEME_KEY]);
  dependencies.renderEverything();
  if (!state.currentPreviewDocId && state.documents[0]) dependencies.previewDocument(state.documents[0].id);
  return BACKUP_COLLECTIONS.reduce((total, key) => total + backup[key].length, 0);
}

function exportAllData() {
  (async () => {
    try {
      await dependencies.refreshFlashcardData(false);
      const backup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          documents: state.documents,
          cards: state.cards,
          notes: state.notes,
          quizResults: state.quizResults,
          timerSessions: state.timerSessions,
          classes: state.classes,
          assignments: state.assignments,
          tutorConversations: state.tutorConversations
        },
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
}

function initClearHistory() {
  $('clear-quiz-history-btn').addEventListener('click', async () => {
    if (!state.quizResults.length) {
      setStatus('all-data-status', 'There is no quiz history to clear.');
      return;
    }
    const confirmed = await dependencies.confirmBulkDeletion(`Delete all ${state.quizResults.length} quiz attempts? Quiz accuracy charts and course averages will be recalculated.`);
    if (!confirmed) return;
    const previous = state.quizResults;
    state.quizResults = [];
    if (!await idbSet('quizResults', state.quizResults)) {
      state.quizResults = previous;
      setStatus('all-data-status', 'Quiz history could not be cleared. Your data was restored.');
      return;
    }
    dependencies.renderEverything();
    setStatus('all-data-status', 'Quiz history cleared.');
  });
  $('clear-timer-sessions-btn').addEventListener('click', async () => {
    if (!state.timerSessions.length) {
      setStatus('all-data-status', 'There are no timer sessions to clear.');
      return;
    }
    const confirmed = await dependencies.confirmBulkDeletion(`Delete all ${state.timerSessions.length} timer sessions? Study-time totals, charts, and course progress will be recalculated.`);
    if (!confirmed) return;
    const previous = state.timerSessions;
    state.timerSessions = [];
    if (!await idbSet('timerSessions', state.timerSessions)) {
      state.timerSessions = previous;
      setStatus('all-data-status', 'Timer sessions could not be cleared. Your data was restored.');
      return;
    }
    dependencies.renderTimer();
    dependencies.renderEverything();
    setStatus('all-data-status', 'Timer sessions cleared.');
  });
}

export function init(deps = {}) {
  dependencies = deps;
  $('theme-select').value = document.documentElement.dataset.theme || localStorage.getItem(THEME_KEY) || 'system';
  setTheme($('theme-select').value);
  $('theme-select').addEventListener('change', event => setTheme(event.target.value));
  $('theme-toggle').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((document.documentElement.dataset.theme || 'system') === 'system') setTheme('system');
  });
  $('export-all-data-btn').addEventListener('click', exportAllData);
  $('import-all-data-btn').addEventListener('click', () => $('import-all-data-file').click());
  $('import-all-data-file').addEventListener('change', async event => {
    const input = event.target;
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
  initClearHistory();
}

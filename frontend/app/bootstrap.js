import { createApiClient } from '../services/api.js';
import { idbGet, idbSet, idbSetMany } from '../services/storage.js';
import { createAssignmentBriefsApi } from '../services/assignment-briefs-api.js';
import {
  init as initAssignmentBrief,
  loadAssignmentBriefs,
  openAssignmentBriefDialog
} from '../features/assignment-brief.js';
import { init as initAssignments, classForAssignment, renderAssignmentList, renderReminderBadge, syncReminderControls, checkAssignmentReminders, assignmentMarkup, bindAssignmentActions, openAssignmentForm } from '../features/assignments.js';
import { init as initCalendar, renderCalendar } from '../features/calendar.js';
import { init as initClasses, formatMeetingDays, renderClasses } from '../features/classes.js';
import { init as initDocuments, renderDocuments, renderTaxonomy, previewDocument } from '../features/documents.js';
import { init as initQuiz, quizFromNote } from '../features/quiz.js';
import { init as initTimer, renderTimer } from '../features/timer.js';
import { init as initDashboard, renderDashboard } from '../features/dashboard.js';
import { init as initProgress, loadProgressDeckStats, renderProgress, renderProgressWeakDecks } from '../features/progress.js';
import { init as initTutor, loadTutorConversations, persistTutorConversations, renderTutorChatPage, renderTutorOverview, setChatRequestStatus } from '../features/tutor.js';
import { addMsg, addAssistantMsg, init as initTutorSources, renderTutorScopeOptions, updateStudyMaterialIndex, retrieveStudyReferences } from '../features/tutor-sources.js';
import { init as initFlashcards, flashcardApi, importFlashcardRecords, loadFlashcardsFromServer, renderCardFilters, renderCardList, renderDeckBar, renderFlashcardSourceOptions, refreshFlashcardData, renderFlashcardDeckSelectors, renderFlashcardDeckSummary, setFlashcardsView, updateFlashcardDueBadge, loadFlashcardSourceText } from '../features/flashcards.js';
import { init as initLearning, loadLearningReview, loadLearningStats } from '../features/learning.js';
import { init as initNotes, initializeNoteCleanup, initializeNotebooks, renderNotes, selectNote } from '../features/notes.js';
import { init as initSettings } from '../features/settings.js';
import { init as initNavigation, activatePage } from './navigation.js';
import { init as initAuth, showLoginScreen } from './auth.js';
import { on as onBus, emit as emitBus } from '../shared/bus.js';
import { state } from '../shared/state.js';
import { $, escapeHtml, setStatus } from '../shared/dom.js';
import { uid, truncateText, normalizeAnswer } from '../shared/format.js';
import { initializeCustomControls, syncCustomSelect } from '../shared/custom-select.js';
import { init as initFitPaginator, showFitItem, releaseFitPaginator } from '../shared/fit-paginator.js';
import { confirmDeletion, softDeleteRecords, showUndoToast, purgeUndoSnapshot, confirmBulkDeletion, initUndo } from '../shared/undo.js';
import { downloadJSON, readJSONFile } from '../shared/files.js';
import { renderTutorMarkdown } from '../features/tutor-markdown.js';
import { init as initMarkdown } from '../shared/markdown.js';

const TUTOR_MATERIAL_KEY = 'studybuddy-tutor-material';
let featuresInitialized = false;

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

const apiFetch = createApiClient({
  onUnauthorized: () => showLoginScreen('Session expired, please sign in again')
});

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
}

function cardFontSize(text) {
  return `${Math.max(12, Math.min(20, 20 - Math.floor(String(text || '').length / 90)))}px`;
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
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'The AI request failed'));
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an invalid response. Please try again.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The server returned an invalid response. Please try again.');
  }
  if (typeof data.error === 'string' && data.error) throw new Error(data.error);
  return data;
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
  renderTutorOverview();
  emitBus('data:changed');
  renderTutorScopeOptions();
  renderReminderBadge();
  updateStudyMaterialIndex();
  document.querySelectorAll('select').forEach(syncCustomSelect);
}

function initializeFeatures() {
  if (featuresInitialized) return;
  featuresInitialized = true;
  initializeCustomControls();
  initMarkdown();
  initUndo({ flashcardApi, refreshFlashcardData, renderEverything });
  initDocuments({ renderProgress });
  initQuiz({ callAI, aiDocumentPayload, activatePage, renderProgress });
  initTimer();
  initAssignmentBrief({
    briefsApi: createAssignmentBriefsApi(apiFetch, apiErrorMessage),
    apiFetch,
    apiErrorMessage
  });
  initAssignments({ openAssignmentBriefDialog });
  initCalendar({ openAssignmentForm, assignmentMarkup, bindAssignmentActions, syncReminderControls });
  initClasses({ openAssignmentForm, renderAssignmentList, renderCalendar, activatePage });
  initFitPaginator({ renderCalendar });
  initDashboard({
    getData: () => ({
      documents: state.documents,
      cards: state.cards,
      quizResults: state.quizResults,
      timerSessions: state.timerSessions,
      classes: state.classes,
      assignments: state.assignments
    }),
    escapeHtml,
    classForAssignment,
    bindAssignmentActions,
    activatePage,
    previewDocument,
    setFlashcardsView
  });
  initProgress({
    getData: () => ({
      documents: state.documents,
      notes: state.notes,
      cards: state.cards,
      quizResults: state.quizResults,
      timerSessions: state.timerSessions
    }),
    escapeHtml,
    confirmDeletion,
    softDeleteRecords,
    flashcardApi,
    refreshFlashcardData
  });
  initTutor({
    initTutorSources,
    retrieveStudyReferences,
    addMsg,
    addAssistantMsg,
    getDocuments: () => state.documents,
    getNotes: () => state.notes,
    getCards: () => state.cards,
    getQuizResults: () => state.quizResults,
    getAssignments: () => state.assignments,
    getClasses: () => state.classes,
    getTimerSessions: () => state.timerSessions,
    classForAssignment,
    formatMeetingDays,
    escapeHtml,
    syncCustomSelect,
    renderTutorMarkdown,
    apiFetch,
    apiErrorMessage,
    idbGet,
    idbSet,
    uid,
    confirmDeletion,
    confirmBulkDeletion,
    softDeleteRecords,
    activatePage,
    previewDocument,
    selectNote,
    renderCardList,
    renderClasses,
    showFitItem,
    setClassesView: value => { state.classesView = value; }
  });
  initLearning({
    flashcardApi,
    setStatus,
    renderFlashcardDeckSummary,
    updateFlashcardDueBadge,
    refreshFlashcardData,
    renderProgressWeakDecks,
    loadProgressDeckStats,
    getDocuments: () => state.documents,
    escapeHtml,
    syncCustomSelect,
    loadFlashcardSourceText,
    renderFlashcardDeckSelectors
  });
  initFlashcards({
    apiFetch,
    apiErrorMessage,
    idbGet,
    idbSet,
    setStatus,
    escapeHtml,
    syncCustomSelect,
    renderDashboard,
    renderProgress,
    renderTutorOverview,
    confirmDeletion,
    softDeleteRecords,
    renderInlineMarkdown,
    cardFontSize,
    normalizeAnswer,
    getDocuments: () => state.documents,
    getNotes: () => state.notes,
    callAI,
    aiDocumentPayload,
    truncateText,
    activatePage,
    loadLearningReview,
    loadLearningStats,
    downloadJSON
  });
  initNotes({
    uid,
    idbSet,
    idbSetMany,
    callAI,
    aiDocumentPayload,
    truncateText,
    getDocuments: () => state.documents,
    setStatus,
    setChatRequestStatus,
    updateStudyMaterialIndex,
    renderTaxonomy,
    renderEverything,
    releaseFitPaginator,
    softDeleteRecords,
    confirmDeletion,
    downloadJSON,
    readJSONFile,
    idbGet
  });
  initSettings({
    importFlashcardRecords,
    persistTutorConversations,
    renderEverything,
    previewDocument,
    refreshFlashcardData,
    confirmBulkDeletion,
    renderTimer
  });
  initNavigation({
    renderClasses,
    renderDashboard,
    renderProgress,
    loadProgressDeckStats,
    renderTutorOverview,
    renderCalendar,
    setFlashcardsView
  });
  onBus('documents:changed', renderEverything);
  onBus('assignment-brief:changed', renderEverything);
  onBus('classes:changed', renderEverything);
  onBus('assignments:changed', renderEverything);
  onBus('timer:session-logged', renderEverything);
  onBus('notes:make-quiz', ({ note }) => {
    if (note?.body.trim()) quizFromNote(note.id);
  });
  onBus('notes:ask-tutor', ({ note }) => {
    if (!note) return;
    activatePage('tutor');
    $('tutor-use-material').checked = true;
    localStorage.setItem(TUTOR_MATERIAL_KEY, 'true');
    $('settings-tutor-material').checked = true;
    $('tutor-study-scope').value = 'all';
    $('chat-input').value = `Help me understand the main ideas in my note "${note.title || 'Untitled note'}".`;
    $('chat-input').focus();
  });
  onBus('flashcards:create-from-mistakes', async ({ records, onComplete, onError }) => {
    try {
      const added = await importFlashcardRecords(records);
      onComplete?.(added);
    } catch (error) {
      onError?.(error);
    }
  });
}

async function loadData() {
  initializeFeatures();
  state.documents = await idbGet('documents') || [];
  state.cards.splice(0, state.cards.length);
  state.notes.splice(0, state.notes.length, ...(await idbGet('notes') || []));
  await initializeNotebooks();
  state.quizResults = await idbGet('quizResults') || [];
  state.timerSessions = await idbGet('timerSessions') || [];
  if (state.timerSessions.some(session => !session.id)) {
    state.timerSessions = state.timerSessions.map(session => session.id ? session : { ...session, id: uid() });
    await idbSet('timerSessions', state.timerSessions);
  }
  state.classes = await idbGet('classes') || [];
  state.assignments = await idbGet('assignments') || [];
  await loadAssignmentBriefs();
  state.deletedRecords = (await idbGet('deletedRecords') || []).filter(snapshot => snapshot.expiresAt > Date.now());
  await idbSet('deletedRecords', state.deletedRecords);
  await loadTutorConversations();
  await initializeNoteCleanup();
  await loadFlashcardsFromServer();
  state.progressDataLoading = false;
  renderTimer();
  renderEverything();
  renderFlashcardSourceOptions();
  setFlashcardsView(sessionStorage.getItem('studybuddy-flashcards-active-view') || 'cards');
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

initAuth({ initializeApp: loadData });

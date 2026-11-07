import { state } from '../shared/state.js';
import { emit, on } from '../shared/bus.js';

const FLASHCARD_IMPORT_DONE_KEY = 'studybuddy-flashcards-neon-imported';
const FLASHCARD_VIEW_KEY = 'studybuddy-flashcards-active-view';
const cards = state.cards;
const decks = state.decks;
const notes = state.notes;
let editingCardId = null;
let dependencies;
const $ = id => document.getElementById(id);
const escapeHtml = (...args) => dependencies.escapeHtml(...args);
const syncCustomSelect = (...args) => dependencies.syncCustomSelect(...args);
const renderDashboard = (...args) => dependencies.renderDashboard(...args);
const renderProgress = (...args) => dependencies.renderProgress(...args);
const renderTutorOverview = (...args) => dependencies.renderTutorOverview(...args);
const confirmDeletion = (...args) => dependencies.confirmDeletion(...args);
const softDeleteRecords = (...args) => dependencies.softDeleteRecords(...args);
const renderInlineMarkdown = (...args) => dependencies.renderInlineMarkdown(...args);
const cardFontSize = (...args) => dependencies.cardFontSize(...args);
const normalizeAnswer = (...args) => dependencies.normalizeAnswer(...args);
const getDocuments = (...args) => dependencies.getDocuments(...args);
const getNotes = (...args) => dependencies.getNotes(...args);
const callAI = (...args) => dependencies.callAI(...args);
const aiDocumentPayload = (...args) => dependencies.aiDocumentPayload(...args);
const idbGet = (...args) => dependencies.idbGet(...args);
const idbSet = (...args) => dependencies.idbSet(...args);
const setStatus = (...args) => dependencies.setStatus(...args);
const apiFetch = (...args) => dependencies.apiFetch(...args);
const apiErrorMessage = (...args) => dependencies.apiErrorMessage(...args);
const activatePage = (...args) => dependencies.activatePage(...args);
const downloadJSON = (...args) => dependencies.downloadJSON(...args);
const loadLearningReview = (...args) => dependencies.loadLearningReview(...args);
const loadLearningStats = (...args) => dependencies.loadLearningStats(...args);

export function cardLabel(card) {
  if (card.format === 'definition') return 'Definition';
  if (card.format === 'fill_blank') return 'Fill blank';
  return 'Basic';
}

export function updateFlashcardDueBadge(count = state.flashcardDueCount) {
  state.flashcardDueCount = Math.max(0, Number(count) || 0);
  const badge = $('flashcards-due-badge');
  badge.textContent = state.flashcardDueCount > 99 ? '99+' : String(state.flashcardDueCount);
  badge.classList.toggle('hidden', state.flashcardDueCount === 0);
  badge.setAttribute('aria-label', `${state.flashcardDueCount} flashcards due`);
  renderDashboard();
}

export function renderDeckBar() {
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

export function renderFlashcardDeckSummary() {
  const container = $('flashcard-deck-summary');
  if (!container) return;
  if (state.currentFlashcardDeckFilter !== 'all'
    && !decks.some(deck => deck.id === state.currentFlashcardDeckFilter)) {
    state.currentFlashcardDeckFilter = 'all';
  }
  container.replaceChildren();
  const all = document.createElement('button');
  all.type = 'button';
  all.className = `flashcard-deck-pill${state.currentFlashcardDeckFilter === 'all' ? ' active' : ''}`;
  all.dataset.deckFilter = 'all';
  all.innerHTML = `<span>All decks</span><small>${cards.length}</small>`;
  container.appendChild(all);
  decks.forEach(deck => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `flashcard-deck-pill${state.currentFlashcardDeckFilter === deck.id ? ' active' : ''}`;
    item.dataset.deckFilter = deck.id;
    item.innerHTML = `<span>${escapeHtml(deck.name)}</span><small>${Number(deck.due_count) || 0} due</small>`;
    container.appendChild(item);
  });
  container.querySelectorAll('[data-deck-filter]').forEach(button => button.addEventListener('click', () => {
    state.currentFlashcardDeckFilter = button.dataset.deckFilter;
    $('card-course-filter').value = 'all';
    $('card-unit-filter').value = 'all';
    syncCustomSelect($('card-course-filter'));
    syncCustomSelect($('card-unit-filter'));
    renderFlashcardDeckSummary();
    renderCardList();
  }));
}

export function renderFlashcardDeckSelectors() {
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
    (state.currentFlashcardDeckFilter === 'all' || card.deck_id === state.currentFlashcardDeckFilter)
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

export function renderCardFilters() {
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
      state.studyDeck = state.studyDeck.filter(item => item.id !== card.id);
      if (!state.studyDeck.length) {
        exitCardStudy();
      } else {
        state.studyIndex = Math.min(state.studyIndex, state.studyDeck.length - 1);
        renderStudyCard();
      }
    }
  }));
  container.querySelectorAll('[data-edit-card]').forEach(button => button.addEventListener('click', () => openCardForm(button.dataset.editCard)));
}

export function renderCardList() {
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
export function openCardForm(id = null) {
  const card = cards.find(item => item.id === id);
  const activeDeck = decks.find(deck => deck.id === state.currentFlashcardDeckFilter);
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
      state.studyDeck = state.studyDeck.map(studyCard => cards.find(card => card.id === studyCard.id)).filter(Boolean);
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
export async function generateFlashcardsFromDocument() {
  const doc = getDocuments().find(d => d.id === $('flashcard-doc-select').value);
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
  state.studyDeck = filteredCards()
    .filter(card => flashcardDeckKey(card) === deckKey)
    .sort((a, b) => (a.front || '').localeCompare(b.front || ''));
  if (state.studyDeck.length === 0) return;
  state.studyDeckName = flashcardDeckName(state.studyDeck[0]);
  state.studyIndex = 0;
  state.studySessionResults = { mastered: 0, review: 0 };
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
  $('study-deck-title').textContent = state.studyDeckName;
  if (state.studyIndex >= state.studyDeck.length) {
    $('card-study-progress').textContent = 'Session complete.';
    face.classList.add('hidden');
    $('study-card-more').replaceChildren();
    summary.classList.remove('hidden');
    summary.textContent = `You reviewed ${state.studyDeck.length} ${state.studyDeck.length === 1 ? 'card' : 'cards'}: ${state.studySessionResults.mastered} marked as known and ${state.studySessionResults.review} to review again.`;
    previous.disabled = state.studyDeck.length === 0;
    next.disabled = true;
    $('card-got-it-btn').disabled = true;
    $('card-again-btn').disabled = true;
    progress.setAttribute('aria-valuenow', '100');
    $('card-study-progress-fill').style.width = '100%';
    state.studyFlipped = false;
    return;
  }
  state.studyFlipped = false;
  $('card-study-progress').textContent = `Card ${state.studyIndex + 1} of ${state.studyDeck.length}`;
  face.classList.remove('hidden', 'flipped');
  summary.classList.add('hidden');
  face.setAttribute('aria-pressed', 'false');
  face.setAttribute('aria-label', 'Question shown. Press Space to show answer.');
  face.innerHTML = `<span class="card-front">${renderInlineMarkdown(state.studyDeck[state.studyIndex].front)}</span><span class="card-back">${renderInlineMarkdown(state.studyDeck[state.studyIndex].back)}</span>`;
  face.style.setProperty('--study-card-font-size', cardFontSize(state.studyDeck[state.studyIndex].front));
  $('study-card-more').innerHTML = cardMoreMarkup(state.studyDeck[state.studyIndex]);
  bindCardActions($('study-card-more'));
  previous.disabled = state.studyIndex === 0;
  next.disabled = false;
  $('card-got-it-btn').disabled = false;
  $('card-again-btn').disabled = false;
  const percent = Math.round((state.studyIndex / state.studyDeck.length) * 100);
  progress.setAttribute('aria-valuenow', String(percent));
  $('card-study-progress-fill').style.width = `${percent}%`;
}
function exitCardStudy() {
  $('cards-study').classList.add('hidden');
  $('panel-cards').classList.remove('studying');
  $('card-list').querySelector('[data-study-deck]')?.focus();
}
export function navigateStudyCard(direction) {
  state.studyIndex = Math.max(0, Math.min(state.studyDeck.length, state.studyIndex + direction));
  renderStudyCard();
}
export async function markStudyCard(mastered) {
  if (state.studyIndex >= state.studyDeck.length) return;
  const card = cards.find(c => c.id === state.studyDeck[state.studyIndex].id);
  if (!card) return;
  try {
    await saveFlashcardRecord({ ...card, mastered }, card.id);
    const current = cards.find(item => item.id === card.id);
    if (current) current.mastered = mastered;
  } catch (error) {
    setStatus('flashcards-storage-status', error.message || 'Could not update flashcard mastery.');
    return;
  }
  state.studySessionResults[mastered ? 'mastered' : 'review']++;
  state.studyIndex++;
  renderProgress();
  renderStudyCard();
  if (state.studyIndex < state.studyDeck.length) $('flip-card').focus();
}

export function setFlashcardsView(view) {
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
    const selectedDeck = decks.find(deck => deck.id === state.currentFlashcardDeckFilter);
    if (selectedDeck) $('learning-topic').value = selectedDeck.id;
  }
  if (view === 'review') loadLearningReview();
  if (view === 'stats') loadLearningStats();
}

export async function flashcardApi(path, body, method) {
  const response = await apiFetch(path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'The flashcard request failed.'));
  return response.status === 204 ? null : response.json();
}



export function mapServerCard(card) {
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

export async function refreshFlashcardData(render = true) {
  try {
    const [cardData, deckData] = await Promise.all([
      flashcardApi('/api/cards'),
      flashcardApi('/api/decks')
    ]);
    cards.splice(0, cards.length, ...cardData.cards.map(mapServerCard));
    decks.splice(0, decks.length, ...deckData.decks);
    state.dashboardFlashcardStatus = 'ready';
    state.dashboardFlashcardError = '';
    updateFlashcardDueBadge(decks.reduce((sum, deck) => sum + (Number(deck.due_count) || 0), 0));
    if (render) {
      renderDeckBar();
      renderCardFilters();
      renderCardList();
      renderTutorOverview();
      renderProgress();
    }
  } catch (error) {
    state.dashboardFlashcardStatus = 'error';
    state.dashboardFlashcardError = error.message || 'Could not load flashcards.';
    renderDashboard();
    throw error;
  }
}

export async function importLegacyFlashcards(localCards) {
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

export async function saveFlashcardRecord(input, cardId = null) {
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

export async function importFlashcardRecords(records) {
  if (!records.length) return 0;
  let imported = 0;
  for (let index = 0; index < records.length; index += 5000) {
    const result = await flashcardApi('/api/cards/import', { cards: records.slice(index, index + 5000) });
    imported += result.imported_count;
  }
  await refreshFlashcardData();
  return imported;
}

export function renderFlashcardSourceOptions() {
  const notesSelect = $('flashcard-note-source');
  const docsSelect = $('flashcard-document-source');
  if (!notesSelect || !docsSelect) return;
  notesSelect.innerHTML = notes.length
    ? notes.map(note => `<option value="${escapeHtml(note.id)}">${escapeHtml(note.title || 'Untitled note')}</option>`).join('')
    : '<option value="">No saved notes</option>';
  docsSelect.innerHTML = getDocuments().length
    ? getDocuments().map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || 'Untitled document')}</option>`).join('')
    : '<option value="">No documents</option>';
  syncCustomSelect(notesSelect);
  syncCustomSelect(docsSelect);
}

export function loadFlashcardSourceText() {
  const type = $('flashcard-source-type').value;
  $('flashcard-note-source-wrap').classList.toggle('hidden', type !== 'note');
  $('flashcard-document-source-wrap').classList.toggle('hidden', type !== 'document');
  const content = type === 'note'
    ? notes.find(note => note.id === $('flashcard-note-source').value)?.body || ''
    : type === 'document'
      ? getDocuments().find(item => item.id === $('flashcard-document-source').value)?.extractedText || ''
      : state.flashcardPastedSource;
  $('flashcard-truncation-notice').classList.toggle('hidden', content.length <= 6000);
  $('learning-notes').value = content.slice(0, 6000);
}

export async function loadFlashcardsFromServer() {
  const legacyCards = await idbGet('cards') || [];
  try {
    await importLegacyFlashcards(legacyCards);
    await refreshFlashcardData(false);
  } catch (error) {
    console.error('Flashcard storage could not be loaded', error);
    state.dashboardFlashcardStatus = 'error';
    state.dashboardFlashcardError = error.message || 'Could not load flashcards from the server.';
    setStatus('flashcards-storage-status', `${state.dashboardFlashcardError} Your local backup is still available.`);
  }
}



export function init(deps) {
  dependencies = deps;
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
  if (!state.studyDeck.length || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (event.code === 'Space' && (event.target === $('flip-card') || !event.target.matches('button, a'))) {
    event.preventDefault();
    $('flip-card').click();
  } else if (event.key === 'ArrowRight' && state.studyIndex < state.studyDeck.length) {
    event.preventDefault();
    navigateStudyCard(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateStudyCard(-1);
  }
});
$('flip-card').addEventListener('click', () => {
  if (state.studyIndex >= state.studyDeck.length) return;
  state.studyFlipped = !state.studyFlipped;
  $('flip-card').classList.toggle('flipped', state.studyFlipped);
  $('flip-card').setAttribute('aria-pressed', String(state.studyFlipped));
  $('flip-card').setAttribute('aria-label', state.studyFlipped ? 'Answer shown. Press Space to show question.' : 'Question shown. Press Space to show answer.');
});
$('card-got-it-btn').addEventListener('click', () => markStudyCard(true));
$('card-again-btn').addEventListener('click', () => markStudyCard(false));
$('card-study-prev-btn').addEventListener('click', () => navigateStudyCard(-1));
$('card-study-next-btn').addEventListener('click', () => navigateStudyCard(1));
$('card-study-exit-btn').addEventListener('click', exitCardStudy);
  document.querySelectorAll('[data-flashcard-view]').forEach(button => {
    button.addEventListener('click', () => setFlashcardsView(button.dataset.flashcardView));
  });
  on('notes:make-flashcards', async ({ note }) => {
    if (!note?.body.trim()) return;
    setStatus('notes-ai-status', 'Generating flashcards from note...');
    try {
      const data = await callAI('/api/generate-flashcards', { document: { title: note.title || 'Study note', course: note.tag || 'General', unit: note.unit || 'General', text: dependencies.truncateText(note.body, 14000) } });
      const generated = Array.isArray(data.cards) ? data.cards : [];
      const records = generated.filter(card => card && typeof card.front === 'string' && typeof card.back === 'string').map(card => ({ front: card.front.trim(), back: card.back.trim(), subject: note.tag || '', unit: note.unit || '', format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic', aiGenerated: true, sourceNoteId: note.id, sourceNoteTitle: note.title || 'Study note', mastered: false }));
      await importFlashcardRecords(records);
      activatePage('cards');
      setFlashcardsView('cards');
      setStatus('cards-ai-status', 'Added ' + records.length + ' cards from ' + (note.title || 'your note') + '.');
    } catch (error) {
      setStatus('notes-ai-status', error.message || 'Could not generate flashcards.');
    }
  });
  on('flashcards:save-record', async ({ input, onSaved, onError }) => {
    try {
      await saveFlashcardRecord(input);
      await refreshFlashcardData();
      onSaved?.();
    } catch (error) {
      if (onError) onError(error);
      else setStatus('flashcards-storage-status', error.message || 'Could not save this flashcard.');
    }
  });
  on('flashcards:import-records', async ({ records, onImported, onError }) => {
    try {
      const imported = await importFlashcardRecords(records);
      onImported?.(imported);
    } catch (error) {
      if (onError) onError(error);
      else setStatus('flashcards-storage-status', error.message || 'Could not import flashcards.');
    }
  });
}

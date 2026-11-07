import { state } from '../shared/state.js';

let dependencies;
const $ = id => document.getElementById(id);
const decks = state.decks;
const notes = state.notes;
const learningApi = (...args) => dependencies.flashcardApi(...args);
const setStatus = (...args) => dependencies.setStatus(...args);
const renderFlashcardDeckSummary = (...args) => dependencies.renderFlashcardDeckSummary(...args);
const updateFlashcardDueBadge = (...args) => dependencies.updateFlashcardDueBadge(...args);
const refreshFlashcardData = (...args) => dependencies.refreshFlashcardData(...args);
const renderProgressWeakDecks = (...args) => dependencies.renderProgressWeakDecks(...args);
const loadProgressDeckStats = (...args) => dependencies.loadProgressDeckStats(...args);
const getDocuments = (...args) => dependencies.getDocuments(...args);
const escapeHtml = (...args) => dependencies.escapeHtml(...args);
const syncCustomSelect = (...args) => dependencies.syncCustomSelect(...args);
export function renderLearningPreview() {
  const container = $('learning-preview-list');
  container.replaceChildren();
  state.learningPreviewCards.forEach((card, index) => {
    const article = document.createElement('article');
    article.className = 'learning-preview-card';
    const selected = document.createElement('input');
    selected.type = 'checkbox';
    selected.checked = card.selected !== false;
    selected.setAttribute('aria-label', `Select card ${index + 1} to save`);
    selected.addEventListener('change', () => {
      card.selected = selected.checked;
      $('learning-save-btn').disabled = !state.learningPreviewCards.some(item => item.selected !== false);
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
      state.learningPreviewCards.splice(index, 1);
      renderLearningPreview();
    });
    article.append(selected, fields, remove);
    container.appendChild(article);
  });
  $('learning-save-btn').disabled = !state.learningPreviewCards.some(card => card.selected !== false);
}

export async function generateLearningCards() {
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
    state.learningPreviewCards = data.cards.map(card => ({ ...card, selected: true }));
    renderLearningPreview();
    setStatus('learning-generate-status', `Preview ready: ${state.learningPreviewCards.length} cards for ${data.topic}. Review or edit them before saving.`);
  } catch (error) {
    console.error('Flashcard generation failed', error);
    setStatus('learning-generate-status', error.message || 'Could not generate cards. Please try again.');
  } finally {
    button.disabled = false;
  }
}

export async function saveLearningCards() {
  const deck = decks.find(item => item.id === $('learning-topic').value);
  const selected = state.learningPreviewCards
    .filter(card => card.selected !== false)
    .map(({ front, back }) => ({
      front: front.trim(),
      back: back.trim(),
      aiGenerated: true,
      subject: deck?.name || 'General',
      sourceNoteId: $('flashcard-source-type').value === 'note' ? $('flashcard-note-source').value : '',
      sourceNoteTitle: $('flashcard-source-type').value === 'note'
        ? state.notes.find(note => note.id === $('flashcard-note-source').value)?.title || ''
        : '',
      sourceDocumentId: $('flashcard-source-type').value === 'document' ? $('flashcard-document-source').value : '',
      sourceDocumentTitle: $('flashcard-source-type').value === 'document'
        ? getDocuments().find(item => item.id === $('flashcard-document-source').value)?.title || ''
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
    state.learningPreviewCards = state.learningPreviewCards.filter(card => card.selected === false);
    renderLearningPreview();
    await refreshFlashcardData();
    setStatus('learning-generate-status', `Saved ${savedCount} ${savedCount === 1 ? 'card' : 'cards'} to ${deck.name}.`);
    loadLearningStats();
  } catch (error) {
    console.error('Saving flashcards failed', error);
    setStatus('learning-generate-status', error.message || 'Could not save cards. Please try again.');
  } finally {
    button.disabled = !state.learningPreviewCards.some(card => card.selected !== false);
  }
}

export function renderLearningReviewCard() {
  const card = state.learningReviewCards[state.learningReviewIndex];
  const cardElement = $('learning-review-card');
  const empty = $('learning-nothing-due');
  cardElement.classList.toggle('hidden', !card);
  empty.classList.toggle('hidden', Boolean(card) || state.learningReviewLoading);
  $('learning-due-count').textContent = state.learningReviewLoading
    ? 'Checking due cards…'
    : `${state.learningReviewDueCount} ${state.learningReviewDueCount === 1 ? 'card' : 'cards'} due`;
  if (!card) return;
  $('learning-review-topic').textContent = card.topic;
  $('learning-review-front').textContent = card.front;
  $('learning-review-answer').value = '';
  $('learning-submit-answer').classList.remove('hidden');
  $('learning-submit-answer').disabled = state.learningReviewLoading;
  $('learning-grade-result').classList.add('hidden');
  state.learningReviewGraded = false;
  state.learningReviewShownAt = Date.now();
}

export async function loadLearningReview() {
  if (state.learningReviewLoading) return;
  state.learningReviewLoading = true;
  setStatus('learning-review-status', 'Loading due cards… The database may take a moment to wake up.');
  renderLearningReviewCard();
  try {
    const selectedDeck = $('learning-review-deck').value;
    const query = selectedDeck && selectedDeck !== 'all'
      ? `?limit=10&deck_id=${encodeURIComponent(selectedDeck)}`
      : '?limit=10';
    const data = await learningApi(`/api/review/next${query}`);
    state.learningReviewCards = data.cards;
    state.learningReviewIndex = 0;
    state.learningReviewDueCount = data.total_due;
    setStatus('learning-review-status', '');
  } catch (error) {
    state.learningReviewCards = [];
    state.learningReviewDueCount = 0;
    setStatus('learning-review-status', error.message || 'Could not load due cards.');
  } finally {
    state.learningReviewLoading = false;
    renderLearningReviewCard();
  }
}

export async function submitLearningAnswer() {
  const card = state.learningReviewCards[state.learningReviewIndex];
  if (!card || state.learningReviewGraded || state.learningReviewLoading) return;
  const button = $('learning-submit-answer');
  button.disabled = true;
  setStatus('learning-review-status', 'Checking your answer…');
  try {
    const result = await learningApi('/api/review/grade', {
      card_id: card.id,
      user_answer: $('learning-review-answer').value,
      response_ms: Math.max(0, Date.now() - state.learningReviewShownAt)
    });
    state.learningReviewGraded = true;
    state.learningReviewDueCount = Math.max(0, state.learningReviewDueCount - 1);
    const reviewedDeck = decks.find(deck => deck.id === card.deck_id);
    if (reviewedDeck) reviewedDeck.due_count = Math.max(0, Number(reviewedDeck.due_count) - 1);
    updateFlashcardDueBadge(Math.max(0, state.flashcardDueCount - 1));
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

export async function showNextLearningCard() {
  if (!state.learningReviewGraded || state.learningReviewLoading) return;
  state.learningReviewIndex++;
  if (state.learningReviewIndex >= state.learningReviewCards.length) {
    await loadLearningReview();
    return;
  }
  renderLearningReviewCard();
  $('learning-review-answer').focus();
}

export function renderLearningStats(data) {
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

export async function loadLearningStats() {
  if (state.learningStatsLoading) return;
  state.learningStatsLoading = true;
  setStatus('learning-stats-status', 'Loading deck stats… The database may take a moment to wake up.');
  try {
    const data = await learningApi('/api/stats/topics');
    renderLearningStats(data);
    setStatus('learning-stats-status', '');
  } catch (error) {
    console.error('Loading deck stats failed', error);
    setStatus('learning-stats-status', error.message || 'Could not load deck stats.');
  } finally {
    state.learningStatsLoading = false;
  }
}



export function init(deps) {
  dependencies = deps;
  $('learning-generate-btn').addEventListener('click', generateLearningCards);
  $('learning-save-btn').addEventListener('click', saveLearningCards);
  $('learning-refresh-review').addEventListener('click', loadLearningReview);
  $('learning-submit-answer').addEventListener('click', submitLearningAnswer);
  $('learning-next-card').addEventListener('click', showNextLearningCard);
  $('learning-refresh-stats').addEventListener('click', loadLearningStats);
  $('learning-review-deck').addEventListener('change', loadLearningReview);
  $('flashcard-source-type').addEventListener('change', event => {
    if (state.flashcardSelectedSource === 'paste') state.flashcardPastedSource = $('learning-notes').value;
    state.flashcardSelectedSource = event.target.value;
    dependencies.loadFlashcardSourceText();
  });
  $('flashcard-note-source').addEventListener('change', () => dependencies.loadFlashcardSourceText());
  $('flashcard-document-source').addEventListener('change', () => dependencies.loadFlashcardSourceText());
  $('learning-notes').addEventListener('input', () => {
    if ($('flashcard-source-type').value === 'paste') {
      state.flashcardPastedSource = $('learning-notes').value.slice(0, 6000);
      $('flashcard-truncation-notice').classList.add('hidden');
    }
  });
  $('learning-topic').addEventListener('change', async event => {
    if (event.target.value !== 'new') return;
    const name = window.prompt('Name your new deck');
    if (!name?.trim()) {
      dependencies.renderFlashcardDeckSelectors();
      return;
    }
    try {
      const result = await dependencies.flashcardApi('/api/decks', { name: name.trim() });
      await refreshFlashcardData(false);
      $('learning-topic').value = result.deck.id;
    } catch (error) {
      setStatus('learning-generate-status', error.message || 'Could not create the deck.');
      dependencies.renderFlashcardDeckSelectors();
    }
  });
}

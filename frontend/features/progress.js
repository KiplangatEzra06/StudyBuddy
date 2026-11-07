import { on } from '../shared/bus.js';
import { state } from '../shared/state.js';


const $ = id => document.getElementById(id);
let dependencies;
let progressDeckStatsRequest = 0;
const escapeHtml = (...args) => dependencies.escapeHtml(...args);
const confirmDeletion = (...args) => dependencies.confirmDeletion(...args);
const softDeleteRecords = (...args) => dependencies.softDeleteRecords(...args);
const flashcardApi = (...args) => dependencies.flashcardApi(...args);
const refreshFlashcardData = (...args) => dependencies.refreshFlashcardData(...args);

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
  if (state.progressDataLoading) {
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
  const { timerSessions } = dependencies.getData();
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
  const { quizResults } = dependencies.getData();
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
  const { cards } = dependencies.getData();
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

export function renderProgress() {
  const { documents, notes, cards, quizResults, timerSessions } = dependencies.getData();
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
  if (state.progressDataLoading) {
    showChartLoading($('flashcard-mastery-chart'));
  } else if (state.dashboardFlashcardStatus === 'error' && !cards.length) {
    const container = $('flashcard-mastery-chart');
    showChartError(container, state.dashboardFlashcardError || 'Flashcard mastery could not be loaded.', () => {
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

export function renderProgressWeakDecks(deckStats) {
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

export async function loadProgressDeckStats() {
  const container = $('progress-weak-decks');
  const requestId = ++progressDeckStatsRequest;
  container.setAttribute('aria-busy', 'true');
  container.replaceChildren();
  const skeleton = document.createElement('div');
  skeleton.className = 'progress-deck-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  container.appendChild(skeleton);
  try {
    const data = await flashcardApi('/api/stats/topics');
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


export function init(deps) {
  dependencies = deps;
  on('data:changed', renderProgress);
}

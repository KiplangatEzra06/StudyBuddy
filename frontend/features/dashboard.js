import { on } from '../shared/bus.js';
import { state } from '../shared/state.js';

let dependencies;
const $ = id => document.getElementById(id);

export function renderDashboardSection(name, renderContent) {
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

export function dashboardProgressRow(label, value, detail) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return `<div class="dashboard-progress-row">
    <div class="dashboard-progress-heading"><span>${dependencies.escapeHtml(label)}</span><strong>${percent}%</strong></div>
    <div class="dashboard-progress-track" role="progressbar" aria-label="${dependencies.escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
    <small>${dependencies.escapeHtml(detail)}</small>
  </div>`;
}

export function dashboardDateTime(timestamp, options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

export function renderDashboard() {
  const { documents, cards, quizResults, timerSessions, classes, assignments } = dependencies.getData();
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
        detail: dependencies.classForAssignment(assignment)?.name || 'General',
        assignmentId: assignment.id,
        sortKey: '00:00'
      }));
    assignments.filter(assignment => !assignment.completed && Number.isFinite(Number(assignment.dueAt))
      && new Date(Number(assignment.dueAt)).toDateString() === now.toDateString())
      .forEach(assignment => priorities.push({
        kind: 'Due today',
        time: 'Due today',
        title: assignment.title || 'Untitled assignment',
        detail: dependencies.classForAssignment(assignment)?.name || 'General',
        assignmentId: assignment.id,
        sortKey: `${String(new Date(Number(assignment.dueAt)).getHours()).padStart(2, '0')}:${String(new Date(Number(assignment.dueAt)).getMinutes()).padStart(2, '0')}`
      }));
    priorities.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (!priorities.length) return { state: 'empty' };
    return {
      html: priorities.slice(0, 5).map(item => `
        <article class="dashboard-list-row">
          ${item.assignmentId
            ? `<button class="dashboard-complete-btn" type="button" data-toggle-assignment="${dependencies.escapeHtml(item.assignmentId)}" aria-label="Mark ${dependencies.escapeHtml(item.title)} complete">○</button>`
            : '<span class="dashboard-event-time" aria-hidden="true">Today</span>'}
          <div><span class="dashboard-item-kind">${dependencies.escapeHtml(item.kind)} · ${dependencies.escapeHtml(item.time)}</span><strong>${dependencies.escapeHtml(item.title)}</strong><small>${dependencies.escapeHtml(item.detail)}</small></div>
        </article>
      `).join('')
    };
  });
  dependencies.bindAssignmentActions($('dashboard-priorities-content'));

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
        detail: `${dashboardDateTime(Number(assignment.dueAt))} · ${dependencies.classForAssignment(assignment)?.name || 'General'}`,
        assignmentId: assignment.id
      }));
    upcoming.sort((a, b) => a.timestamp - b.timestamp);
    if (!upcoming.length) return { state: 'empty' };
    return {
      html: upcoming.slice(0, 6).map(item => `
        <article class="dashboard-list-row dashboard-upcoming-row">
          ${item.assignmentId
            ? `<button class="dashboard-complete-btn" type="button" data-toggle-assignment="${dependencies.escapeHtml(item.assignmentId)}" aria-label="Mark ${dependencies.escapeHtml(item.title)} complete">○</button>`
            : '<span class="dashboard-upcoming-dot" aria-hidden="true"></span>'}
          <div><span class="dashboard-item-kind">${dependencies.escapeHtml(item.kind)}</span><strong>${dependencies.escapeHtml(item.title)}</strong><small>${dependencies.escapeHtml(item.detail)}</small></div>
        </article>
      `).join('')
    };
  });
  dependencies.bindAssignmentActions($('dashboard-upcoming-content'));

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
          <span class="dashboard-activity-kind">${dependencies.escapeHtml(item.kind)}</span>
          <div><strong>${dependencies.escapeHtml(item.title)}</strong><small>${dependencies.escapeHtml(item.detail)} · ${dependencies.escapeHtml(dashboardDateTime(item.timestamp))}</small></div>
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
          <span class="dashboard-item-kind">Document · ${dependencies.escapeHtml(latestDocument.course || 'General')}</span>
          <h3>${dependencies.escapeHtml(latestDocument.title || 'Untitled document')}</h3>
          <div class="dashboard-progress-track" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
          <small>${progress}% read</small>
          <button class="btn btn-primary" type="button" id="dashboard-continue-button" data-document-id="${dependencies.escapeHtml(latestDocument.id)}">Continue reading</button>
        </article>`
      };
    }
    if (state.dashboardFlashcardStatus === 'loading') return { state: 'loading', message: 'Checking what is ready to study…' };
    if (state.dashboardFlashcardStatus === 'error') return { state: 'error', message: `Learning recommendations are unavailable: ${state.dashboardFlashcardError}` };
    if (state.flashcardDueCount > 0) {
      return {
        html: `<article class="dashboard-continue-card">
          <span class="dashboard-item-kind">Flashcards</span>
          <h3>Keep your knowledge fresh</h3>
          <p>${state.flashcardDueCount} ${state.flashcardDueCount === 1 ? 'card is' : 'cards are'} ready to review.</p>
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
    if (state.dashboardFlashcardStatus === 'loading') return { state: 'loading' };
    if (state.dashboardFlashcardStatus === 'error') return { state: 'error', message: `Flashcard reminders are unavailable: ${state.dashboardFlashcardError}` };
    if (!state.flashcardDueCount) return { state: 'empty' };
    return {
      html: `<div class="dashboard-reminder-count">${state.flashcardDueCount}</div>
        <p>${state.flashcardDueCount === 1 ? 'flashcard is' : 'flashcards are'} due for review.</p>
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


export function init(deps) {
  dependencies = deps;
  on('data:changed', renderDashboard);
  $('panel-dashboard').addEventListener('click', event => {
    const continueButton = event.target.closest('#dashboard-continue-button');
    if (continueButton) {
      if (continueButton.dataset.documentId) {
        dependencies.activatePage('documents');
        dependencies.previewDocument(continueButton.dataset.documentId);
      } else if (continueButton.hasAttribute('data-review-cards')) {
        dependencies.activatePage('cards');
        dependencies.setFlashcardsView('review');
      }
      return;
    }
    const action = event.target.closest('[data-dashboard-go], [data-review-cards]');
    if (!action) return;
    if (action.dataset.dashboardGo) dependencies.activatePage(action.dataset.dashboardGo);
    if (action.hasAttribute('data-review-cards')) {
      dependencies.activatePage('cards');
      dependencies.setFlashcardsView('review');
    }
  });
}

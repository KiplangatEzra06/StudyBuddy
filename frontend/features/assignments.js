import { state } from '../shared/state.js';
import { $, escapeHtml, setStatus } from '../shared/dom.js';
import { uid, formatDueDate } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';
import { confirmDeletion, softDeleteRecords } from '../shared/undo.js';
import { paginateToFit, showFitItem } from '../shared/fit-paginator.js';
import { REMINDERS_ENABLED_KEY } from '../shared/constants.js';

let openAssignmentBriefDialog;
let assignmentSavedStatusTimeout;

function dateTimeInputValue(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function classForAssignment(assignment) {
  return state.classes.find(item => item.id === assignment.classId);
}

export function assignmentMarkup(assignment) {
  const classItem = classForAssignment(assignment);
  const dueAt = Number(assignment.dueAt);
  const overdue = !assignment.completed && dueAt < Date.now();
  return `
    <article class="assignment-row ${assignment.completed ? 'is-complete' : ''} ${overdue ? 'is-overdue' : ''}">
      <div class="assignment-copy">
        <div class="meta-line">
          <span class="pill">${escapeHtml(classItem?.name || 'General')}</span>
          <span class="pill ${assignment.completed ? 'good' : overdue ? 'overdue-pill' : ''}">${assignment.completed ? 'Completed' : overdue ? 'Overdue' : 'Due'}</span>
        </div>
        <h3>${escapeHtml(assignment.title || 'Untitled assignment')}</h3>
        <time datetime="${new Date(dueAt).toISOString()}">${escapeHtml(formatDueDate(dueAt))}</time>
        ${assignment.details ? `<p>${escapeHtml(assignment.details)}</p>` : ''}
        ${assignment.briefDocumentId ? '<span class="assignment-brief-label">File attached</span>' : ''}
        ${Number.isFinite(assignment.reminderAt) && !assignment.completed ? `<span class="assignment-reminder-note">Reminder: ${escapeHtml(formatDueDate(assignment.reminderAt))}</span>` : ''}
      </div>
      <div class="assignment-actions">
        <button class="btn btn-sm assignment-brief-action" type="button" data-assignment-brief="${escapeHtml(assignment.id)}">${assignment.briefDocumentId ? 'Replace assignment file' : 'Attach assignment file'}</button>
        <button class="btn btn-sm" type="button" data-toggle-assignment="${escapeHtml(assignment.id)}">${assignment.completed ? 'Reopen' : 'Mark complete'}</button>
        <button class="icon-btn" type="button" data-edit-assignment="${escapeHtml(assignment.id)}" aria-label="Edit assignment" title="Edit">edit</button>
        <button class="icon-btn btn-danger" type="button" data-delete-assignment="${escapeHtml(assignment.id)}" aria-label="Delete assignment" title="Delete">x</button>
      </div>
    </article>
  `;
}

export function bindAssignmentActions(container) {
  container.querySelectorAll('[data-assignment-brief]').forEach(button => button.addEventListener('click', () => {
    openAssignmentBriefDialog?.(button.dataset.assignmentBrief);
  }));
  container.querySelectorAll('[data-toggle-assignment]').forEach(button => button.addEventListener('click', () => {
    const assignment = state.assignments.find(item => item.id === button.dataset.toggleAssignment);
    if (!assignment) return;
    assignment.completed = !assignment.completed;
    if (assignment.completed) assignment.reminderSentAt = null;
    idbSet('assignments', state.assignments);
    emit('assignments:changed');
  }));
  container.querySelectorAll('[data-edit-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm(button.dataset.editAssignment)));
  container.querySelectorAll('[data-delete-assignment]').forEach(button => button.addEventListener('click', async () => {
    const assignment = state.assignments.find(item => item.id === button.dataset.deleteAssignment);
    if (!assignment) return;
    const confirmed = await confirmDeletion({
      title: 'Delete assignment?',
      description: `Delete "${assignment.title}"?`,
      affected: 'The assignment will be removed from its class and calendar views.'
    });
    if (confirmed) await softDeleteRecords([{ collection: 'assignments', ids: [assignment.id] }], 'Assignment deleted.');
  }));
}

export function renderAssignmentList(container, emptyMessage) {
  const query = container.id === 'classes-assignment-list' ? $('classes-search').value.trim().toLocaleLowerCase() : '';
  const ordered = [...state.assignments]
    .filter(assignment => !query || `${assignment.title} ${assignment.details} ${classForAssignment(assignment)?.name || ''}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  container.innerHTML = ordered.length
    ? ordered.map(assignmentMarkup).join('')
    : (emptyMessage ? `<div class="empty-state">${escapeHtml(emptyMessage)}</div>` : '');
  bindAssignmentActions(container);
  paginateToFit(container, { label: 'Assignment pages', itemHeight: 100 });
  return ordered.length;
}

export function renderReminderBadge() {
  const count = state.assignments.filter(assignment => !assignment.completed
    && Number(assignment.dueAt) < Date.now() + 7 * 24 * 60 * 60 * 1000).length;
  $('reminders-count').textContent = count > 9 ? '9+' : String(count);
  $('reminders-count').classList.toggle('hidden', count === 0);
  $('reminders-bell').setAttribute('aria-label', count
    ? `Open calendar reminders, ${count} upcoming ${count === 1 ? 'assignment' : 'assignments'}`
    : 'Open calendar reminders');
}

export function syncReminderControls() {
  const checkbox = $('calendar-reminders-enabled');
  if (!checkbox) return;
  const supported = typeof window.Notification !== 'undefined';
  checkbox.disabled = !supported;
  checkbox.checked = supported
    && Notification.permission === 'granted'
    && localStorage.getItem(REMINDERS_ENABLED_KEY) === 'true';
  if (!supported && !checkbox.dataset.unsupportedMessage) {
    setStatus('calendar-reminder-status', 'Browser notifications are not supported here. You can still view due dates in the calendar.');
    checkbox.dataset.unsupportedMessage = 'true';
  }
}

export async function setAssignmentRemindersEnabled(enabled) {
  if (!enabled) {
    localStorage.setItem(REMINDERS_ENABLED_KEY, 'false');
    setStatus('calendar-reminder-status', 'Assignment reminders are off.');
    syncReminderControls();
    return;
  }
  if (typeof window.Notification === 'undefined') {
    setStatus('calendar-reminder-status', 'This browser does not support notifications.');
    syncReminderControls();
    return;
  }
  try {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') {
      localStorage.setItem(REMINDERS_ENABLED_KEY, 'false');
      setStatus('calendar-reminder-status', 'Notification permission was not granted. Due dates remain visible in your calendar.');
      syncReminderControls();
      return;
    }
    localStorage.setItem(REMINDERS_ENABLED_KEY, 'true');
    setStatus('calendar-reminder-status', 'Assignment reminders are enabled while StudyBuddy is open.');
    syncReminderControls();
    checkAssignmentReminders();
  } catch (error) {
    localStorage.setItem(REMINDERS_ENABLED_KEY, 'false');
    setStatus('calendar-reminder-status', 'Could not enable browser notifications. Check your browser permissions and try again.');
    syncReminderControls();
  }
}

export function checkAssignmentReminders() {
  if (localStorage.getItem(REMINDERS_ENABLED_KEY) !== 'true'
    || typeof window.Notification === 'undefined'
    || Notification.permission !== 'granted') return;
  const now = Date.now();
  let changed = false;
  state.assignments.forEach(assignment => {
    if (assignment.completed || !Number.isFinite(assignment.reminderAt)
      || assignment.reminderAt > now || assignment.reminderSentAt) return;
    try {
      new Notification('Assignment reminder', {
        body: `${assignment.title} is due ${formatDueDate(Number(assignment.dueAt))}.`,
        tag: `studybuddy-assignment-${assignment.id}`
      });
      assignment.reminderSentAt = now;
      changed = true;
    } catch (error) {
      setStatus('calendar-reminder-status', 'A browser notification could not be shown. Check your browser permissions.');
    }
  });
  if (changed) idbSet('assignments', state.assignments);
}

export function renderAssignmentClassOptions(selectedId = '') {
  $('assignment-class').innerHTML = `<option value="">General (no class)</option>${state.classes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('')}`;
  $('assignment-class').value = state.classes.some(item => item.id === selectedId) ? selectedId : '';
}

export function openAssignmentForm(id = null, classId = '', dueAt = null) {
  const assignment = state.assignments.find(item => item.id === id);
  state.editingAssignmentId = assignment?.id || null;
  $('assignment-dialog-title').textContent = assignment ? 'Edit assignment' : 'Add an assignment';
  $('save-assignment-btn').textContent = assignment ? 'Save changes' : 'Save assignment';
  $('assignment-title').value = assignment?.title || '';
  $('assignment-details').value = assignment?.details || '';
  $('assignment-due').value = dateTimeInputValue(assignment
    ? Number(assignment.dueAt)
    : dueAt == null ? NaN : Number(dueAt));
  $('assignment-reminder').value = assignment?.reminderAt == null ? '' : dateTimeInputValue(Number(assignment.reminderAt));
  $('assignment-open-brief-btn').textContent = assignment?.briefDocumentId ? 'Replace assignment file' : 'Attach assignment file';
  renderAssignmentClassOptions(assignment?.classId || classId);
  $('assignment-dialog').showModal();
  $('assignment-title').focus();
}

export function resetAssignmentForm() {
  state.editingAssignmentId = null;
  $('assignment-form').reset();
  $('assignment-dialog-title').textContent = 'Add an assignment';
  $('save-assignment-btn').textContent = 'Save assignment';
  $('assignment-open-brief-btn').textContent = 'Attach assignment file';
}

function announceAssignmentSaved(assignment) {
  const status = $('assignment-save-status');
  if (status) {
    status.textContent = `Saved "${assignment.title}".`;
    clearTimeout(assignmentSavedStatusTimeout);
    assignmentSavedStatusTimeout = setTimeout(() => {
      status.textContent = '';
    }, 5000);
  }
  const list = $('classes-assignment-list');
  if (list && list.offsetParent !== null) {
    showFitItem(list, `[data-edit-assignment="${CSS.escape(assignment.id)}"]`);
  }
}

export async function saveAssignment() {
  const dueAt = new Date($('assignment-due').value).getTime();
  const reminderValue = $('assignment-reminder').value;
  const reminderAt = reminderValue ? new Date(reminderValue).getTime() : null;
  if (reminderAt !== null && reminderAt > dueAt) {
    const input = $('assignment-reminder');
    input.setCustomValidity('The reminder time must be before the due date.');
    input.reportValidity();
    input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
    return;
  }
  const fields = {
    title: $('assignment-title').value.trim(),
    classId: $('assignment-class').value,
    dueAt,
    reminderAt,
    reminderSentAt: null,
    details: $('assignment-details').value.trim()
  };
  const existingAssignment = state.assignments.find(item => item.id === state.editingAssignmentId);
  let assignment;
  let assignments;
  if (existingAssignment) {
    const reminderChanged = existingAssignment.reminderAt !== reminderAt || existingAssignment.dueAt !== dueAt;
    fields.reminderSentAt = reminderChanged ? null : (existingAssignment.reminderSentAt || null);
    assignment = { ...existingAssignment, ...fields, updatedAt: Date.now() };
    assignments = state.assignments.map(item => item.id === assignment.id ? assignment : item);
  }
  else {
    assignment = { id: uid(), ...fields, completed: false, createdAt: Date.now() };
    assignments = [...state.assignments, assignment];
  }
  let saved = false;
  try {
    saved = await idbSet('assignments', assignments);
  } catch (error) {
    console.warn('Could not save the assignment.', error);
  }
  if (!saved) {
    clearTimeout(assignmentSavedStatusTimeout);
    setStatus(
      'assignment-save-status',
      'Could not save the assignment in this browser. Check storage permissions and try again.'
    );
    return null;
  }
  if (existingAssignment) Object.assign(existingAssignment, assignment);
  else state.assignments.push(assignment);
  assignment = existingAssignment || assignment;
  $('assignment-dialog').close();
  resetAssignmentForm();
  emit('assignments:changed');
  checkAssignmentReminders();
  announceAssignmentSaved(assignment);
  return assignment;
}

export function init(deps = {}) {
  openAssignmentBriefDialog = deps.openAssignmentBriefDialog;
  $('classes-add-assignment')?.addEventListener('click', () => openAssignmentForm());
  $('assignment-form')?.addEventListener('submit', event => {
    event.preventDefault();
    saveAssignment();
  });
  $('assignment-open-brief-btn')?.addEventListener('click', async () => {
    let id = state.editingAssignmentId;
    if (!id) {
      if (!$('assignment-form').reportValidity()) return;
      id = (await saveAssignment())?.id;
      if (!id) return;
    }
    openAssignmentBriefDialog?.(id);
  });
  $('assignment-due')?.addEventListener('input', () => $('assignment-reminder').setCustomValidity(''));
  $('assignment-reminder')?.addEventListener('input', () => $('assignment-reminder').setCustomValidity(''));
  $('assignment-dialog')?.addEventListener('close', resetAssignmentForm);
  $('close-assignment-dialog')?.addEventListener('click', () => $('assignment-dialog').close());
  $('cancel-assignment-dialog')?.addEventListener('click', () => $('assignment-dialog').close());
  $('calendar-reminders-enabled').checked = localStorage.getItem(REMINDERS_ENABLED_KEY) === 'true'
    && typeof window.Notification !== 'undefined' && Notification.permission === 'granted';
  $('calendar-reminders-enabled')?.addEventListener('change', event => setAssignmentRemindersEnabled(event.target.checked));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkAssignmentReminders();
  });
  if (state.reminderIntervalId) clearInterval(state.reminderIntervalId);
  state.reminderIntervalId = setInterval(checkAssignmentReminders, 30000);
}

import { state } from '../shared/state.js';
import { $, escapeHtml } from '../shared/dom.js';
import { uid } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';
import { confirmDeletion, softDeleteRecords } from '../shared/undo.js';
import { paginateToFit } from '../shared/fit-paginator.js';
import { WEEKDAY_NAMES } from '../shared/constants.js';

let openAssignmentForm;
let renderAssignmentList;
let renderCalendar;
let activatePage;

export function formatMeetingDays(days) {
  return (Array.isArray(days) ? days : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day < 7)
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map(day => WEEKDAY_NAMES[day].slice(0, 3))
    .join(', ');
}

export function renderClasses() {
  const list = $('class-list');
  const empty = $('classes-empty');
  const query = $('classes-search').value.trim().toLocaleLowerCase();
  const filteredClasses = state.classes.filter(item => `${item.name} ${item.instructor || ''} ${item.location || ''}`
    .toLocaleLowerCase().includes(query));
  $('panel-classes').classList.toggle('show-assignments', state.classesView === 'assignments');
  $('classes-view-classes').setAttribute('aria-pressed', String(state.classesView === 'classes'));
  $('classes-view-assignments').setAttribute('aria-pressed', String(state.classesView === 'assignments'));
  $('classes-view-classes').classList.toggle('active', state.classesView === 'classes');
  $('classes-view-assignments').classList.toggle('active', state.classesView === 'assignments');
  if (!filteredClasses.length) {
    list.replaceChildren();
    empty.classList.toggle('hidden', state.classes.length > 0 && query.length === 0);
    if (state.classes.length > 0 && query) empty.textContent = 'No classes match this filter.';
  } else {
    empty.classList.add('hidden');
    list.innerHTML = [...filteredClasses].sort((a, b) => a.name.localeCompare(b.name)).map(item => {
      const days = formatMeetingDays(item.meetingDays);
      const time = item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : '';
      return `
        <article class="class-card">
          <div class="class-card-main">
            <div class="class-mark" aria-hidden="true">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</div>
            <div class="class-card-copy">
              <h3>${escapeHtml(item.name)}</h3>
              <p>${[item.instructor, item.location].filter(Boolean).map(escapeHtml).join(' · ') || 'Class details not added'}</p>
              ${days ? `<div class="class-meeting-line"><strong>${escapeHtml(days)}</strong>${time ? `<span>${escapeHtml(time)}</span>` : ''}</div>` : '<span class="hint">No weekly meeting time</span>'}
            </div>
          </div>
          <div class="class-card-actions">
            <button class="btn btn-sm" type="button" data-add-class-assignment="${escapeHtml(item.id)}">Add assignment</button>
            <button class="icon-btn" type="button" data-edit-class="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit">edit</button>
            <button class="icon-btn btn-danger" type="button" data-delete-class="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}" title="Delete">x</button>
          </div>
        </article>
      `;
    }).join('');
    list.querySelectorAll('[data-edit-class]').forEach(button => button.addEventListener('click', () => openClassForm(button.dataset.editClass)));
    list.querySelectorAll('[data-add-class-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm?.(null, button.dataset.addClassAssignment)));
    list.querySelectorAll('[data-delete-class]').forEach(button => button.addEventListener('click', async () => {
      const item = state.classes.find(course => course.id === button.dataset.deleteClass);
      if (!item) return;
      const linked = state.assignments.filter(assignment => assignment.classId === item.id);
      const choice = await confirmDeletion({
        title: `Delete class "${item.name}"?`,
        description: linked.length
          ? `This class has ${linked.length} linked ${linked.length === 1 ? 'assignment' : 'assignments'}.`
          : 'This class has no linked assignments.',
        affected: linked.length ? 'Choose whether its assignments should remain in your list without a class or be deleted too.' : '',
        choices: linked.length
          ? [
            { key: 'keep', label: 'Delete class only' },
            { key: 'all', label: `Delete class and ${linked.length} assignments` }
          ]
          : [{ key: 'all', label: 'Delete class' }]
      });
      if (!choice) return;
      const updates = choice === 'keep'
        ? [{ collection: 'assignments', records: state.assignments.map(assignment => assignment.classId === item.id ? { ...assignment, classId: '' } : assignment) }]
        : [];
      const changes = [{ collection: 'classes', ids: [item.id] }];
      if (choice === 'all' && linked.length) changes.push({ collection: 'assignments', ids: linked.map(assignment => assignment.id) });
      await softDeleteRecords(changes, 'Class deleted.', updates);
    }));
  }
  paginateToFit(list, { label: 'Class pages', itemHeight: 116 });
  const assignmentCount = renderAssignmentList?.($('classes-assignment-list'), '') ?? 0;
  $('assignments-empty').classList.toggle('hidden', assignmentCount > 0);
  renderCalendar?.();
}

export function openClassForm(id = null) {
  const item = state.classes.find(course => course.id === id);
  state.editingClassId = item?.id || null;
  $('class-dialog-title').textContent = item ? 'Edit class' : 'Add a class';
  $('save-class-btn').textContent = item ? 'Save changes' : 'Save class';
  $('class-name').value = item?.name || '';
  $('class-instructor').value = item?.instructor || '';
  $('class-location').value = item?.location || '';
  $('class-start-time').value = item?.startTime || '';
  $('class-end-time').value = item?.endTime || '';
  const selectedDays = new Set((item?.meetingDays || []).map(Number));
  document.querySelectorAll('[name="class-meeting-day"]').forEach(input => {
    input.checked = selectedDays.has(Number(input.value));
  });
  $('class-dialog').showModal();
  $('class-name').focus();
}

export function resetClassForm() {
  state.editingClassId = null;
  $('class-form').reset();
  $('class-dialog-title').textContent = 'Add a class';
  $('save-class-btn').textContent = 'Save class';
}

export async function saveClass() {
  const name = $('class-name').value.trim();
  const meetingDays = [...document.querySelectorAll('[name="class-meeting-day"]:checked')].map(input => Number(input.value));
  const startTime = $('class-start-time').value;
  const endTime = $('class-end-time').value;
  if (meetingDays.length && (!startTime || !endTime || startTime >= endTime)) {
    const invalidInput = !startTime ? $('class-start-time') : $('class-end-time');
    invalidInput.setCustomValidity(!startTime || !endTime ? 'Choose both meeting times when setting weekly meeting days.' : 'The end time must be after the start time.');
    invalidInput.reportValidity();
    invalidInput.addEventListener('input', () => invalidInput.setCustomValidity(''), { once: true });
    return;
  }
  const fields = {
    name,
    instructor: $('class-instructor').value.trim(),
    location: $('class-location').value.trim(),
    meetingDays,
    startTime,
    endTime
  };
  const item = state.classes.find(course => course.id === state.editingClassId);
  if (item) Object.assign(item, fields, { updatedAt: Date.now() });
  else state.classes.push({ id: uid(), ...fields, createdAt: Date.now() });
  $('class-dialog').close();
  resetClassForm();
  await idbSet('classes', state.classes);
  emit('classes:changed');
}

export function init(deps = {}) {
  openAssignmentForm = deps.openAssignmentForm;
  renderAssignmentList = deps.renderAssignmentList;
  renderCalendar = deps.renderCalendar;
  activatePage = deps.activatePage;
  $('add-class-btn')?.addEventListener('click', () => openClassForm());
  $('classes-search')?.addEventListener('input', renderClasses);
  $('classes-view-classes')?.addEventListener('click', () => activatePage?.('classes'));
  $('classes-view-assignments')?.addEventListener('click', () => activatePage?.('assignments'));
  $('class-form')?.addEventListener('submit', event => {
    event.preventDefault();
    saveClass();
  });
  $('class-dialog')?.addEventListener('close', resetClassForm);
  $('close-class-dialog')?.addEventListener('click', () => $('class-dialog').close());
  $('cancel-class-dialog')?.addEventListener('click', () => $('class-dialog').close());
}

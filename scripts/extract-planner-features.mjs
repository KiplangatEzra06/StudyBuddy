import fs from 'fs';

const runtimePath = 'frontend/app/runtime.js';
const src = fs.readFileSync(runtimePath, 'utf8');
const lines = src.split(/\n/);

function findLine(pred, from = 0) {
  for (let i = from; i < lines.length; i += 1) {
    if (pred(lines[i], i)) return i;
  }
  return -1;
}

function extractFromTo(startPred, endPred) {
  const start = findLine(startPred);
  const end = findLine(endPred, start + 1);
  if (start < 0 || end < 0) throw new Error(`Range not found: ${startPred} -> ${endPred}`);
  return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

function exportFns(block, names) {
  let next = block;
  for (const name of names) {
    next = next
      .replace(new RegExp(`^async function ${name}\\b`, 'm'), `export async function ${name}`)
      .replace(new RegExp(`^function ${name}\\b`, 'm'), `export function ${name}`);
  }
  return next;
}

// --- assignments: renderReminderBadge is separate; main block from classForAssignment through saveAssignment
const reminderBadge = extractFromTo(
  line => line.startsWith('function renderReminderBadge'),
  line => line.startsWith("$('reminders-bell')")
);

const dateTime = extractFromTo(
  line => line.startsWith('function dateTimeInputValue'),
  line => line.startsWith('function formatMeetingDays')
);

const assignmentCore = extractFromTo(
  line => line.startsWith('function classForAssignment'),
  line => line.startsWith('function cardFontSize')
);

const assignmentBindThroughSave = extractFromTo(
  line => line.startsWith('function bindAssignmentActions'),
  line => line.startsWith('function renderClasses')
);

const assignmentForms = extractFromTo(
  line => line.startsWith('function renderAssignmentClassOptions'),
  line => line.startsWith('function normalizeExtractedText')
);

const reminderSyncThroughCheck = extractFromTo(
  line => line.startsWith('function syncReminderControls'),
  line => line.startsWith('function openClassForm')
);

let assignmentsBody = [
  dateTime,
  exportFns(assignmentCore, ['classForAssignment', 'assignmentMarkup']),
  exportFns(assignmentBindThroughSave, [
    'bindAssignmentActions', 'renderAssignmentList'
  ]),
  exportFns(reminderBadge, ['renderReminderBadge']),
  exportFns(reminderSyncThroughCheck, [
    'syncReminderControls', 'setAssignmentRemindersEnabled', 'checkAssignmentReminders'
  ]),
  exportFns(assignmentForms, [
    'renderAssignmentClassOptions', 'openAssignmentForm', 'resetAssignmentForm', 'saveAssignment'
  ])
].join('\n\n');

assignmentsBody = assignmentsBody
  .replace(/renderEverything\(\);/g, "emit('assignments:changed');")
  .replace(
    /openAssignmentBriefDialog\(button\.dataset\.assignmentBrief\);/,
    'openAssignmentBriefDialog?.(button.dataset.assignmentBrief);'
  );

const assignmentsModule = `import { state } from '../shared/state.js';
import { $, escapeHtml, setStatus } from '../shared/dom.js';
import { uid, formatDueDate } from '../shared/format.js';
import { emit } from '../shared/bus.js';
import { idbSet } from '../services/storage.js';
import { confirmDeletion, softDeleteRecords } from '../shared/undo.js';
import { paginateToFit } from '../shared/fit-paginator.js';
import { REMINDERS_ENABLED_KEY } from '../shared/constants.js';

let openAssignmentBriefDialog;

${assignmentsBody}

export function init(deps = {}) {
  openAssignmentBriefDialog = deps.openAssignmentBriefDialog;
  $('classes-add-assignment')?.addEventListener('click', () => openAssignmentForm());
  $('assignment-form')?.addEventListener('submit', event => {
    event.preventDefault();
    saveAssignment();
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
`;

// --- classes
const classesBlock = extractFromTo(
  line => line.startsWith('function formatMeetingDays'),
  line => line.startsWith('function classForAssignment')
);
const renderClassesBlock = extractFromTo(
  line => line.startsWith('function renderClasses'),
  line => line.startsWith('function renderCalendar')
);
const classForms = extractFromTo(
  line => line.startsWith('function openClassForm'),
  line => line.startsWith('function renderAssignmentClassOptions')
);

let classesBody = [
  exportFns(classesBlock, ['formatMeetingDays']),
  exportFns(renderClassesBlock, ['renderClasses']),
  exportFns(classForms, ['openClassForm', 'resetClassForm', 'saveClass'])
].join('\n\n');

classesBody = classesBody
  .replace(/renderEverything\(\);/g, "emit('classes:changed');")
  .replace(
    /list\.querySelectorAll\('\[data-add-class-assignment\]'\)\.forEach\(button => button\.addEventListener\('click', \(\) => openAssignmentForm\(null, button\.dataset\.addClassAssignment\)\)\);/,
    "list.querySelectorAll('[data-add-class-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentForm?.(null, button.dataset.addClassAssignment)));"
  )
  .replace(
    /const assignmentCount = renderAssignmentList\(\$\('classes-assignment-list'\), ''\);\n  \$\{'assignments-empty'\}\.classList\.toggle\('hidden', assignmentCount > 0\);\n  renderCalendar\(\);/,
    `const assignmentCount = renderAssignmentList?.($('classes-assignment-list'), '') ?? 0;
  $('assignments-empty').classList.toggle('hidden', assignmentCount > 0);
  renderCalendar?.();`
  );

// Fix the replace - I escaped wrong. Do simpler replacements after.
classesBody = [
  exportFns(classesBlock, ['formatMeetingDays']),
  exportFns(renderClassesBlock, ['renderClasses']),
  exportFns(classForms, ['openClassForm', 'resetClassForm', 'saveClass'])
].join('\n\n');

classesBody = classesBody.replace(/renderEverything\(\);/g, "emit('classes:changed');");
classesBody = classesBody.replace(
  'openAssignmentForm(null, button.dataset.addClassAssignment)',
  'openAssignmentForm?.(null, button.dataset.addClassAssignment)'
);
classesBody = classesBody.replace(
  `const assignmentCount = renderAssignmentList($('classes-assignment-list'), '');
  $('assignments-empty').classList.toggle('hidden', assignmentCount > 0);
  renderCalendar();`,
  `const assignmentCount = renderAssignmentList?.($('classes-assignment-list'), '') ?? 0;
  $('assignments-empty').classList.toggle('hidden', assignmentCount > 0);
  renderCalendar?.();`
);

const classesModule = `import { state } from '../shared/state.js';
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

${classesBody}

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
`;

// --- calendar
const calendarBlock = extractFromTo(
  line => line.startsWith('function renderCalendar'),
  line => line.startsWith('function syncReminderControls')
);

let calendarBody = exportFns(calendarBlock, [
  'renderCalendar', 'shiftCalendarPeriod', 'formatCalendarHeading',
  'calendarEventsForDate', 'getNextCalendarEvent', 'calendarEventMarkup', 'openCalendarDay'
]);

calendarBody = calendarBody
  .replace(/openAssignmentForm\(/g, 'openAssignmentForm?.(')
  .replace(/assignmentMarkup/g, 'assignmentMarkupFn')
  .replace(/bindAssignmentActions\(/g, 'bindAssignmentActions?.(')
  .replace(/syncReminderControls\(\);/g, 'syncReminderControls?.();');

// Fix assignmentMarkupFn for the function name itself and the map callback
calendarBody = calendarBody
  .replace('function assignmentMarkupFn', 'function calendarEventMarkup') // oops don't break
  ;

// Re-do calendar more carefully
calendarBody = exportFns(calendarBlock, [
  'renderCalendar', 'shiftCalendarPeriod', 'formatCalendarHeading',
  'calendarEventsForDate', 'getNextCalendarEvent', 'calendarEventMarkup', 'openCalendarDay'
]);
calendarBody = calendarBody.replace(/openAssignmentForm\(/g, 'openAssignmentForm?.(');
calendarBody = calendarBody.replace(
  'upcoming.map(assignmentMarkup)',
  'upcoming.map(item => assignmentMarkup?.(item) ?? "")'
);
calendarBody = calendarBody.replace(/bindAssignmentActions\(/g, 'bindAssignmentActions?.(');
calendarBody = calendarBody.replace(/syncReminderControls\(\);/g, 'syncReminderControls?.();');

const calendarModule = `import { state } from '../shared/state.js';
import { $, escapeHtml } from '../shared/dom.js';
import { formatDueDate } from '../shared/format.js';
import { paginateToFit } from '../shared/fit-paginator.js';
import {
  calendarEventsForDate as collectCalendarEvents,
  getNextCalendarEvent as findNextCalendarEvent,
  localDateKey
} from './calendar-data.js';

let openAssignmentForm;
let assignmentMarkup;
let bindAssignmentActions;
let syncReminderControls;

${calendarBody}

export function init(deps = {}) {
  openAssignmentForm = deps.openAssignmentForm;
  assignmentMarkup = deps.assignmentMarkup;
  bindAssignmentActions = deps.bindAssignmentActions;
  syncReminderControls = deps.syncReminderControls;
  $('calendar-add-assignment')?.addEventListener('click', () => openAssignmentForm?.());
  $('calendar-add-fab')?.addEventListener('click', () => {
    const selected = new Date(\`\${state.calendarSelectedDateKey || localDateKey(new Date())}T09:00:00\`);
    openAssignmentForm?.(null, '', selected.getTime());
  });
  $('calendar-prev-week')?.addEventListener('click', () => shiftCalendarPeriod(-1));
  $('calendar-next-week')?.addEventListener('click', () => shiftCalendarPeriod(1));
  $('calendar-this-week')?.addEventListener('click', () => {
    state.calendarMonthOffset = 0;
    state.calendarSelectedDateKey = localDateKey(new Date());
    renderCalendar();
  });
  document.querySelectorAll('[data-calendar-view]').forEach(button => button.addEventListener('click', () => {
    state.calendarView = button.dataset.calendarView;
    renderCalendar();
  }));
  $('calendar-day-add')?.addEventListener('click', event => {
    $('calendar-day-dialog').close();
    const selected = new Date(\`\${event.currentTarget.dataset.calendarAddDate}T09:00:00\`);
    openAssignmentForm?.(null, '', selected.getTime());
  });
  $('calendar-agenda-open')?.addEventListener('click', () => {
    $('calendar-agenda-dialog').showModal();
    renderCalendar();
  });
  $('calendar-agenda-close')?.addEventListener('click', () => $('calendar-agenda-dialog').close());
  $('calendar-day-close')?.addEventListener('click', () => $('calendar-day-dialog').close());
  $('calendar-day-dialog')?.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-assignment]');
    if (!button) return;
    $('calendar-day-dialog').close();
    openAssignmentForm?.(button.dataset.editAssignment);
  });
}
`;

fs.writeFileSync('frontend/features/assignments.js', assignmentsModule);
fs.writeFileSync('frontend/features/classes.js', classesModule);
fs.writeFileSync('frontend/features/calendar.js', calendarModule);
console.log('Wrote feature modules', {
  assignments: assignmentsModule.length,
  classes: classesModule.length,
  calendar: calendarModule.length
});

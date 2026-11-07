import { state } from '../shared/state.js';
import { $, escapeHtml } from '../shared/dom.js';
import { formatDueDate } from '../shared/format.js';
import { paginateToFit } from '../shared/fit-paginator.js';
import {
  calendarEventsForDate as collectCalendarEvents,
  getNextCalendarEvent as findNextCalendarEvent,
  localDateKey
} from '../shared/calendar-data.js';

let openAssignmentForm;
let assignmentMarkup;
let bindAssignmentActions;
let syncReminderControls;

export function renderCalendar() {
  const week = $('calendar-week');
  if (!week) return;
  if (!state.calendarSelectedDateKey) state.calendarSelectedDateKey = localDateKey(new Date());
  const selectedDate = new Date(`${state.calendarSelectedDateKey}T12:00:00`);
  const todayKey = localDateKey(new Date());
  const selectedMonth = new Date();
  selectedMonth.setDate(1);
  selectedMonth.setMonth(selectedMonth.getMonth() + state.calendarMonthOffset);
  const weekdays = $('calendar-weekdays');
  const renderWeekdayLabels = (firstDate, count = 7) => {
    weekdays.innerHTML = Array.from({ length: count }, (_, index) => {
      const date = new Date(firstDate);
      date.setDate(date.getDate() + index);
      const label = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
      return `<span>${escapeHtml(label)}</span>`;
    }).join('');
  };
  const viewButtons = document.querySelectorAll('[data-calendar-view]');
  viewButtons.forEach(button => {
    const active = button.dataset.calendarView === state.calendarView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  week.dataset.view = state.calendarView;
  weekdays.classList.toggle('hidden', state.calendarView === 'year' || state.calendarView === 'day');
  weekdays.style.gridTemplateColumns = state.calendarView === 'day' ? '1fr' : '';
  week.style.gridTemplateRows = '';
  $('calendar-selected-title').textContent = formatCalendarHeading(selectedDate);
  const nextEvent = getNextCalendarEvent(new Date());
  $('calendar-next-event').textContent = nextEvent
    ? `${nextEvent.type === 'class' ? 'Class' : 'Assignment'} · ${nextEvent.title} · ${nextEvent.when}`
    : 'No upcoming events scheduled.';
  week.setAttribute('aria-label', `${state.calendarView[0].toUpperCase()}${state.calendarView.slice(1)} schedule`);

  if (state.calendarView === 'year') {
    const year = selectedDate.getFullYear();
    $('calendar-range').textContent = String(year);
    week.innerHTML = Array.from({ length: 12 }, (_, monthIndex) => {
      const monthDate = new Date(year, monthIndex, 1, 12);
      const monthStart = new Date(year, monthIndex, 1, 12);
      monthStart.setDate(monthStart.getDate() - monthStart.getDay());
      const days = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(monthStart);
        date.setDate(monthStart.getDate() + index);
        const dateKey = localDateKey(date);
        const outsideMonth = date.getMonth() !== monthIndex;
        const hasEvents = calendarEventsForDate(date).length > 0;
        return `<button type="button" class="calendar-year-date ${outsideMonth ? 'outside-month' : ''} ${dateKey === todayKey ? 'is-today' : ''} ${dateKey === state.calendarSelectedDateKey ? 'is-selected' : ''} ${hasEvents ? 'has-events' : ''}" data-calendar-date="${dateKey}" aria-label="${escapeHtml(formatCalendarHeading(date))}${hasEvents ? ', events scheduled' : ''}">${date.getDate()}</button>`;
      }).join('');
      return `<section class="calendar-year-month"><h3>${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'long' }).format(monthDate))}</h3><div class="calendar-year-weekdays" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-year-dates">${days}</div></section>`;
    }).join('');
  } else {
    let startDate;
    let daysToRender;
    if (state.calendarView === 'day') {
      startDate = new Date(selectedDate);
      daysToRender = 1;
      $('calendar-range').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(selectedDate);
    } else if (state.calendarView === 'week') {
      startDate = new Date(selectedDate);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      daysToRender = 7;
      renderWeekdayLabels(startDate);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      $('calendar-range').textContent = `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(startDate)} – ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(endDate)}`;
    } else {
      startDate = new Date(selectedMonth);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      renderWeekdayLabels(startDate);
      const daysInMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
      daysToRender = Math.ceil((selectedMonth.getDay() + daysInMonth) / 7) * 7;
      week.style.gridTemplateRows = `repeat(${daysToRender / 7}, minmax(0, 1fr))`;
      $('calendar-range').textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selectedMonth);
    }
    week.innerHTML = Array.from({ length: daysToRender }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const dateKey = localDateKey(date);
      const events = calendarEventsForDate(date);
      const visibleLimit = state.calendarView === 'month' ? 4 : 12;
      const outsideMonth = state.calendarView === 'month' && date.getMonth() !== selectedMonth.getMonth();
      const dayClasses = [
        'calendar-day',
        dateKey === todayKey ? 'is-today' : '',
        dateKey === state.calendarSelectedDateKey ? 'is-selected' : '',
        outsideMonth ? 'outside-month' : ''
      ].filter(Boolean).join(' ');
      const chips = events.slice(0, visibleLimit).map(event => calendarEventMarkup(event, dateKey)).join('');
      const more = events.length > visibleLimit
        ? `<button type="button" class="calendar-more-events" data-calendar-more="${dateKey}" aria-label="View ${events.length - visibleLimit} more events">+${events.length - visibleLimit}</button>`
        : '';
      return `<article class="${dayClasses}" data-calendar-cell="${dateKey}">
        <div class="calendar-day-header">
          <button type="button" class="calendar-date-number" data-calendar-date="${dateKey}" aria-label="Open ${escapeHtml(formatCalendarHeading(date))}">${date.getDate()}</button>
          ${more}
        </div>
        <div class="calendar-day-events" data-event-count="${events.length}">${chips}</div>
      </article>`;
    }).join('');
  }
  week.querySelectorAll('[data-edit-assignment]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openAssignmentForm?.(button.dataset.editAssignment);
  }));
  week.querySelectorAll('[data-calendar-more]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openCalendarDay(button.dataset.calendarMore);
  }));
  week.querySelectorAll('[data-calendar-date]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (state.calendarView === 'year') {
      state.calendarSelectedDateKey = button.dataset.calendarDate;
      const selectedYearDate = new Date(`${state.calendarSelectedDateKey}T12:00:00`);
      const currentMonth = new Date();
      state.calendarMonthOffset = (selectedYearDate.getFullYear() - currentMonth.getFullYear()) * 12
        + selectedYearDate.getMonth() - currentMonth.getMonth();
      state.calendarView = 'month';
      renderCalendar();
      return;
    }
    openCalendarDay(button.dataset.calendarDate);
  }));
  week.querySelectorAll('[data-calendar-cell]').forEach(cell => cell.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    openCalendarDay(cell.dataset.calendarCell);
  }));
  const upcoming = state.assignments.filter(assignment => !assignment.completed).sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  const container = $('calendar-assignment-list');
  container.innerHTML = upcoming.length
    ? upcoming.map(item => assignmentMarkup?.(item) ?? "").join('')
    : '<div class="empty-state">You are all caught up. Add an assignment to see it on your calendar.</div>';
  bindAssignmentActions?.(container);
  paginateToFit(container, { label: 'Upcoming assignment pages', itemHeight: 100 });
  syncReminderControls?.();
}

export function shiftCalendarPeriod(direction) {
  const selectedDate = new Date(`${state.calendarSelectedDateKey || localDateKey(new Date())}T12:00:00`);
  if (state.calendarView === 'day' || state.calendarView === 'week') {
    selectedDate.setDate(selectedDate.getDate() + direction * (state.calendarView === 'week' ? 7 : 1));
  } else {
    const monthDelta = direction * (state.calendarView === 'year' ? 12 : 1);
    const day = selectedDate.getDate();
    selectedDate.setDate(1);
    selectedDate.setMonth(selectedDate.getMonth() + monthDelta);
    const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    selectedDate.setDate(Math.min(day, lastDay));
  }
  state.calendarSelectedDateKey = localDateKey(selectedDate);
  const currentMonth = new Date();
  state.calendarMonthOffset = (selectedDate.getFullYear() - currentMonth.getFullYear()) * 12
    + selectedDate.getMonth() - currentMonth.getMonth();
  renderCalendar();
}

export function formatCalendarHeading(date) {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
  const day = date.getDate();
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return `${weekday}, ${month} ${day}${suffix}`;
}

export function calendarEventsForDate(date) {
  return collectCalendarEvents(date, state.classes, state.assignments);
}

export function getNextCalendarEvent(fromDate) {
  return findNextCalendarEvent(fromDate, state.classes, state.assignments);
}

export function calendarEventMarkup(event, dateKey) {
  const upcoming = event.type === 'assignment' && !event.completed && !event.past;
  const className = `calendar-event ${event.type}-event ${upcoming ? 'is-upcoming' : ''} ${event.completed || event.past ? 'is-muted' : ''}`.trim();
  if (event.type === 'assignment') {
    return `<button type="button" class="${className}" data-edit-assignment="${escapeHtml(event.id)}" aria-label="Edit ${escapeHtml(event.title)}"><span class="calendar-event-kind">${event.completed ? 'Completed' : 'Assignment'}</span><strong>${escapeHtml(event.title)}</strong><span class="calendar-event-time">${escapeHtml(event.detail)}</span></button>`;
  }
  return `<button type="button" class="${className}" data-calendar-more="${dateKey}" aria-label="View ${escapeHtml(event.title)}"><span class="calendar-event-kind">Class</span><strong>${escapeHtml(event.title)}</strong>${event.detail ? `<span class="calendar-event-time">${escapeHtml(event.detail)}</span>` : ''}</button>`;
}

export function openCalendarDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  state.calendarSelectedDateKey = dateKey;
  const selectedMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const currentMonth = new Date();
  state.calendarMonthOffset = (selectedMonth.getFullYear() - currentMonth.getFullYear()) * 12
    + selectedMonth.getMonth() - currentMonth.getMonth();
  renderCalendar();
  const events = calendarEventsForDate(date).map(event => event.type === 'assignment'
    ? `<article class="calendar-event assignment-event ${event.completed ? 'is-muted' : ''}"><strong>${escapeHtml(event.title)}</strong><time>${escapeHtml(formatDueDate(Number(state.assignments.find(item => item.id === event.id)?.dueAt)))}</time><button type="button" data-edit-assignment="${escapeHtml(event.id)}">Edit assignment</button></article>`
    : `<article class="calendar-event class-event"><strong>${escapeHtml(event.title)}</strong><time>${escapeHtml(event.detail || 'Class')}</time></article>`);
  $('calendar-day-title').textContent = formatCalendarHeading(date);
  $('calendar-day-events').innerHTML = events.join('') || '<p>No events scheduled.</p>';
  $('calendar-day-add').dataset.calendarAddDate = dateKey;
  paginateToFit($('calendar-day-events'), { label: 'Calendar day event pages', itemHeight: 56 });
  $('calendar-day-dialog').showModal();
  requestAnimationFrame(() => paginateToFit($('calendar-day-events'), { label: 'Calendar day event pages', itemHeight: 56 }));
}

export function init(deps = {}) {
  openAssignmentForm = deps.openAssignmentForm;
  assignmentMarkup = deps.assignmentMarkup;
  bindAssignmentActions = deps.bindAssignmentActions;
  syncReminderControls = deps.syncReminderControls;
  $('calendar-add-assignment')?.addEventListener('click', () => openAssignmentForm?.());
  $('calendar-add-fab')?.addEventListener('click', () => {
    const selected = new Date(`${state.calendarSelectedDateKey || localDateKey(new Date())}T09:00:00`);
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
    const selected = new Date(`${event.currentTarget.dataset.calendarAddDate}T09:00:00`);
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

import {
  localDateKey as sharedLocalDateKey,
  calendarEventsForDate as sharedCalendarEventsForDate,
  getNextCalendarEvent as sharedGetNextCalendarEvent
} from '../shared/calendar-data.js';

export function localDateKey(date) {
  return sharedLocalDateKey(date);
}

export function calendarEventsForDate(date, classes, assignments) {
  return sharedCalendarEventsForDate(date, classes, assignments);
}

export function getNextCalendarEvent(fromDate, classes, assignments) {
  return sharedGetNextCalendarEvent(fromDate, classes, assignments);
}

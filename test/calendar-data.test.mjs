import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEventsForDate, getNextCalendarEvent, localDateKey } from '../frontend/features/calendar-data.js';

test('calendar event derivation returns classes and assignments in time order', () => {
  const date = new Date(2030, 0, 1, 12);
  const dueAt = new Date(2030, 0, 1, 14, 30).getTime();
  const events = calendarEventsForDate(date, [{
    name: 'History',
    meetingDays: [date.getDay()],
    startTime: '09:00',
    endTime: '10:00',
    location: 'Room 12'
  }], [{
    id: 'assignment-1',
    title: 'Essay',
    dueAt
  }]);

  assert.equal(localDateKey(date), '2030-01-01');
  assert.deepEqual(events.map(event => [event.type, event.title, event.time]), [
    ['class', 'History', '09:00'],
    ['assignment', 'Essay', '14:30']
  ]);
});

test('next calendar event skips completed assignments', () => {
  const fromDate = new Date(2030, 0, 1, 8);
  const assignments = [
    { id: 'done', title: 'Completed', dueAt: new Date(2030, 0, 1, 9).getTime(), completed: true },
    { id: 'next', title: 'Due today', dueAt: new Date(2030, 0, 1, 10).getTime(), completed: false }
  ];

  const event = getNextCalendarEvent(fromDate, [], assignments);

  assert.equal(event.type, 'assignment');
  assert.equal(event.title, 'Due today');
});

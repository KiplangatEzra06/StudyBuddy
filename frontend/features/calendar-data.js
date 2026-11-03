export function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarEventsForDate(date, classes, assignments) {
  const dateKey = localDateKey(date);
  const events = classes
    .filter(item => Array.isArray(item.meetingDays) && item.meetingDays.map(Number).includes(date.getDay()))
    .map(item => ({
      type: 'class',
      title: item.name || 'Class',
      time: item.startTime || '',
      detail: [item.startTime && `${item.startTime}${item.endTime ? `–${item.endTime}` : ''}`, item.location].filter(Boolean).join(' · '),
      past: dateKey < localDateKey(new Date())
    }));
  assignments.forEach(item => {
    const dueAt = Number(item.dueAt);
    if (!Number.isFinite(dueAt) || localDateKey(new Date(dueAt)) !== dateKey) return;
    events.push({
      type: 'assignment',
      id: item.id,
      title: item.title || 'Untitled assignment',
      time: new Date(dueAt).toTimeString().slice(0, 5),
      detail: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(dueAt)),
      completed: Boolean(item.completed),
      past: dueAt < Date.now()
    });
  });
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

export function getNextCalendarEvent(fromDate, classes, assignments) {
  const now = new Date(fromDate);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    const events = calendarEventsForDate(date, classes, assignments).filter(event => {
      if (event.type === 'assignment' && event.completed) return false;
      return dayOffset > 0 || !event.time || event.time >= currentTime;
    });
    if (!events.length) continue;
    const event = events[0];
    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
    const timeLabel = event.detail || event.time;
    return { ...event, when: `${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}` };
  }
  return null;
}

export function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes, i = 0;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function truncateText(text, max = 12000) { return String(text || '').slice(0, max); }

export function formatDueDate(timestamp, includeYear = true) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export function pluralizeCount(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function formatStudyDuration(seconds) {
  const minutes = Math.round(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours) return `${hours} h${remainingMinutes ? ` ${remainingMinutes} min` : ''}`;
  return `${minutes} min`;
}

export function safeFileName(value) {
  return String(value).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'note';
}

export function normalizeAnswer(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }

export function courseUnitKey(course, unit) { return `${course || 'General'}|${unit || 'General'}`; }

export function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function slugify(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'note-section';
}

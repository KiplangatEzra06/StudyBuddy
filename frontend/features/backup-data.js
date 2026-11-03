export const BACKUP_FORMAT = 'studybuddy-data';
export const BACKUP_VERSION = 1;
export const BACKUP_COLLECTIONS = ['documents', 'cards', 'notes', 'quizResults', 'timerSessions', 'classes', 'assignments', 'tutorConversations'];
export const REQUIRED_BACKUP_COLLECTIONS = ['documents', 'cards', 'notes', 'quizResults', 'timerSessions'];
export const BACKUP_LOCAL_SETTINGS = [
  'studybuddy-theme',
  'studybuddy-tutor-material',
  'studybuddy-assignment-reminders',
  'studybuddy-timer-sound',
  'studybuddy-timer-notification'
];

export function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)
    || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION
    || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('This is not a supported StudyBuddy backup.');
  }

  const requiredFields = {
    documents: { title: 'string', extractedText: 'string' },
    cards: { front: 'string', back: 'string' },
    notes: { title: 'string', body: 'string' },
    quizResults: { score: 'number', correct: 'number', total: 'number', takenAt: 'number' },
    timerSessions: { seconds: 'number', completedAt: 'number' },
    classes: { name: 'string' },
    assignments: { title: 'string', dueAt: 'number' },
    tutorConversations: { title: 'string', createdAt: 'number', updatedAt: 'number' }
  };

  for (const collection of BACKUP_COLLECTIONS) {
    const records = backup.data[collection];
    if (records === undefined && !REQUIRED_BACKUP_COLLECTIONS.includes(collection)) {
      backup.data[collection] = [];
      continue;
    }
    if (!Array.isArray(records)) throw new Error(`The backup is missing valid ${collection} data.`);
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || typeof record.id !== 'string' || !/^[\w-]{1,100}$/.test(record.id)
        || Object.entries(requiredFields[collection]).some(([field, type]) => typeof record[field] !== type)
        || (collection === 'tutorConversations' && !Array.isArray(record.messages))
        || (collection === 'assignments' && (!Number.isFinite(record.dueAt)
          || !Number.isFinite(new Date(record.dueAt).getTime())
          || (record.reminderAt != null && (!Number.isFinite(record.reminderAt)
            || !Number.isFinite(new Date(record.reminderAt).getTime())))))) {
        throw new Error(`The backup contains an invalid ${collection} record at item ${index + 1}.`);
      }
    });
  }
  const localSettings = backup.localSettings || {};
  if (!localSettings || typeof localSettings !== 'object' || Array.isArray(localSettings)
    || Object.entries(localSettings).some(([key, value]) =>
      !BACKUP_LOCAL_SETTINGS.includes(key) || typeof value !== 'string' || value.length > 100)) {
    throw new Error('The backup contains invalid local settings.');
  }
  return {
    ...Object.fromEntries(BACKUP_COLLECTIONS.map(collection => [collection, backup.data[collection] || []])),
    localSettings
  };
}

export function mergeRecords(existing, imported) {
  const ids = new Set(existing.map(record => record.id));
  const merged = [...existing];
  imported.forEach(record => {
    if (!ids.has(record.id)) {
      ids.add(record.id);
      merged.push(record);
    }
  });
  return merged;
}

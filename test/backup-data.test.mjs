import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_COLLECTIONS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  mergeRecords,
  validateBackup
} from '../frontend/features/backup-data.js';

test('backup validation supplies optional collections and rejects malformed records', () => {
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    data: {
      documents: [{ id: 'doc-1', title: 'Document', extractedText: 'Text' }],
      cards: [],
      notes: [],
      quizResults: [],
      timerSessions: []
    }
  };

  const validated = validateBackup(backup);
  assert.deepEqual(validated.documents, backup.data.documents);
  assert.deepEqual(validated.classes, []);
  assert.deepEqual(validated.assignments, []);
  assert.deepEqual(validated.tutorConversations, []);
  assert.deepEqual(Object.keys(validated).filter(key => key !== 'localSettings'), BACKUP_COLLECTIONS);

  assert.throws(() => validateBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    data: { documents: [], cards: [], notes: [], quizResults: [], timerSessions: [], assignments: [{ id: 'assignment-1', title: 'Invalid date', dueAt: Number.NaN }] }
  }), /invalid assignments record/);
});

test('backup validation restricts imported local settings', () => {
  assert.throws(() => validateBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    data: { documents: [], cards: [], notes: [], quizResults: [], timerSessions: [] },
    localSettings: { 'unexpected-key': 'value' }
  }), /invalid local settings/);
});

test('backup merge keeps existing records when IDs collide and adds new IDs once', () => {
  const existing = [{ id: 'same', title: 'Current' }];
  const merged = mergeRecords(existing, [
    { id: 'same', title: 'Imported' },
    { id: 'new', title: 'New' },
    { id: 'new', title: 'Duplicate import' }
  ]);

  assert.deepEqual(merged, [
    { id: 'same', title: 'Current' },
    { id: 'new', title: 'New' }
  ]);
});

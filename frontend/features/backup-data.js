import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_COLLECTIONS,
  REQUIRED_BACKUP_COLLECTIONS,
  BACKUP_LOCAL_SETTINGS,
  validateBackup as validateSharedBackup,
  mergeRecords as mergeSharedRecords
} from '../shared/backup-data.js';

export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BACKUP_COLLECTIONS,
  REQUIRED_BACKUP_COLLECTIONS,
  BACKUP_LOCAL_SETTINGS
};

export function validateBackup(backup) {
  return validateSharedBackup(backup);
}

export function mergeRecords(existing, imported) {
  return mergeSharedRecords(existing, imported);
}

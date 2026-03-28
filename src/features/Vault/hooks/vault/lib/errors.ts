type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export const mapErrorMessage = (code: string, tCommon: TranslateFn, fallback?: string) => {
  switch (code) {
    case 'NETWORK_ERROR':
      return tCommon('error.network', { code });
    case 'BACKUP_PROFILE_MISMATCH':
      return tCommon('error.backupProfileMismatch', { code });
    case 'BACKUP_UNSUPPORTED_FORMAT':
      return tCommon('error.backupUnsupportedFormat', { code });
    case 'BACKUP_ARCHIVE_TOO_MANY_FILES':
      return tCommon('error.backupTooManyFiles', { code });
    case 'BACKUP_ARCHIVE_TOO_LARGE':
      return tCommon('error.backupTooLarge', { code });
    case 'BACKUP_ARCHIVE_INVALID':
    case 'BACKUP_MANIFEST_INVALID':
    case 'BACKUP_MANIFEST_MISSING':
      return tCommon('error.backupInvalid', { code });
    case 'BACKUP_INTEGRITY_FAILED':
      return tCommon('error.backupIntegrityFailed', { code });
    case 'BACKUP_PICK_NOT_FOUND':
      return tCommon('error.backupPickNotFound', { code });
    case 'BACKUP_RESTORE_FILE_IN_USE':
      return tCommon('error.backupRestoreFileInUse', { code });
    case 'BACKUP_RESTORE_ACCESS_DENIED':
      return tCommon('error.backupRestoreAccessDenied', { code });
    case 'BACKUP_RESTORE_PATH_TOO_LONG':
      return tCommon('error.backupRestorePathTooLong', { code });
    case 'BACKUP_RESTORE_DISK_FULL':
      return tCommon('error.backupRestoreDiskFull', { code });
    case 'BACKUP_DESTINATION_REQUIRED':
      return tCommon('error.backupDestinationRequired', { code });
    case 'BACKUP_DESTINATION_UNAVAILABLE':
      return tCommon('error.backupDestinationUnavailable', { code });
    case 'DIALOG_UNSUPPORTED_FILE_URI':
      return tCommon('error.dialogUnsupported', { code });
    case 'WORKSPACE_CREATE_PATH_FORBIDDEN':
    case 'BACKUP_DESTINATION_PATH_FORBIDDEN':
    case 'BACKUP_RESTORE_PATH_FORBIDDEN':
    case 'BACKUP_INSPECT_PATH_FORBIDDEN':
    case 'ATTACHMENT_TARGET_PATH_FORBIDDEN':
      return tCommon('error.operationBlocked', { code });
    case 'PROFILE_ID_INVALID':
      return tCommon('error.profileInvalid', { code });
    case 'DB_SCHEMA_MISSING':
    case 'DB_MIGRATION_FAILED':
      return tCommon('error.vaultUnsupportedOrCorrupt', { code });
    case 'VALIDATION_ERROR':
      return fallback ?? tCommon('error.operationFailed', { code });
    default:
      return fallback ?? tCommon('error.operationFailed', { code });
  }
};

export const SETTINGS_LIMITS = {
  autoLockTimeoutSeconds: { min: 30, max: 86_400 },
  clipboardClearTimeoutSeconds: { min: 1, max: 600 },
  autoBackupIntervalMinutes: { min: 5, max: 525_600 },
  backupMaxCopies: { min: 1, max: 500 },
  trashRetentionDays: { min: 1, max: 3_650 },
} as const;

import { parseTrashRetentionDays } from './parseTrashRetentionDays';
import { SETTINGS_LIMITS } from './settingsLimits';

type ValidateSettingsParams = {
  autoLockEnabled: boolean;
  autoLockTimeoutSeconds: string;
  clipboardClearTimeoutSeconds: string;
  autoBackupEnabled: boolean;
  intervalMinutes: string;
  maxCopies: string;
  trashAutoCleanupEnabled: boolean;
  trashRetentionDays: string;
};

export const validateSettings = ({
  autoLockEnabled,
  autoLockTimeoutSeconds,
  clipboardClearTimeoutSeconds,
  autoBackupEnabled,
  intervalMinutes,
  maxCopies,
  trashAutoCleanupEnabled,
  trashRetentionDays,
}: ValidateSettingsParams): boolean => {
  const lockTimeout = Number(autoLockTimeoutSeconds);
  const clipTimeout = Number(clipboardClearTimeoutSeconds);
  const interval = Number(intervalMinutes);
  const max = Number(maxCopies);
  const retentionDays = parseTrashRetentionDays(trashRetentionDays);

  if (!Number.isFinite(lockTimeout) || !Number.isFinite(clipTimeout) || !Number.isFinite(interval) || !Number.isFinite(max)) {
    return false;
  }
  if (
    autoLockEnabled &&
    (lockTimeout < SETTINGS_LIMITS.autoLockTimeoutSeconds.min ||
      lockTimeout > SETTINGS_LIMITS.autoLockTimeoutSeconds.max)
  ) {
    return false;
  }
  if (
    clipTimeout < SETTINGS_LIMITS.clipboardClearTimeoutSeconds.min ||
    clipTimeout > SETTINGS_LIMITS.clipboardClearTimeoutSeconds.max
  ) {
    return false;
  }
  if (
    autoBackupEnabled &&
    (interval < SETTINGS_LIMITS.autoBackupIntervalMinutes.min ||
      interval > SETTINGS_LIMITS.autoBackupIntervalMinutes.max)
  ) {
    return false;
  }
  if (trashAutoCleanupEnabled && retentionDays === null) return false;
  if (max < SETTINGS_LIMITS.backupMaxCopies.min || max > SETTINGS_LIMITS.backupMaxCopies.max) return false;

  return true;
};

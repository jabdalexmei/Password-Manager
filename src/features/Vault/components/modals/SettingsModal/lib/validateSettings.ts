import { parseTrashRetentionDays } from './parseTrashRetentionDays';

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
  if (autoLockEnabled && (lockTimeout < 30 || lockTimeout > 86400)) return false;
  if (clipTimeout < 1 || clipTimeout > 600) return false;
  if (autoBackupEnabled && (interval < 5 || interval > 1440)) return false;
  if (trashAutoCleanupEnabled && retentionDays === null) return false;
  if (max < 1 || max > 500) return false;

  return true;
};

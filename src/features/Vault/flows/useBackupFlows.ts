import { useCallback, useEffect, useState } from 'react';
import {
  backupDiscardPick,
  backupPickFile,
  createBackupIfDueAuto,
  restoreBackupWorkflowFromPick,
} from '../api/vaultApi';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
type ToastFn = (message: string, tone?: 'success' | 'error' | 'info') => void;

type UseBackupFlowsParams = {
  onLocked: () => void;
  showToast: ToastFn;
  tCommon: TranslateFn;
  tVault: TranslateFn;
  backupsEnabled?: boolean;
};

export function useBackupFlows({ onLocked, showToast, tCommon, tVault, backupsEnabled }: UseBackupFlowsParams) {
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [pendingImportToken, setPendingImportToken] = useState<string | null>(null);
  const [pendingImportLabel, setPendingImportLabel] = useState<string | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  const handleBackupError = useCallback(
    (err: any) => {
      const code = err?.code ?? err?.error ?? 'UNKNOWN';
      if (code === 'VAULT_LOCKED') {
        onLocked();
        return;
      }
      switch (code) {
        case 'BACKUP_PICK_NOT_FOUND':
          showToast(`${tCommon('error.backupPickNotFound')} (${code})`, 'error');
          return;
        case 'BACKUP_RESTORE_FILE_IN_USE':
          showToast(`${tCommon('error.backupRestoreFileInUse')} (${code})`, 'error');
          return;
        case 'BACKUP_RESTORE_ACCESS_DENIED':
          showToast(`${tCommon('error.backupRestoreAccessDenied')} (${code})`, 'error');
          return;
        case 'BACKUP_RESTORE_PATH_TOO_LONG':
          showToast(`${tCommon('error.backupRestorePathTooLong')} (${code})`, 'error');
          return;
        case 'BACKUP_RESTORE_DISK_FULL':
          showToast(`${tCommon('error.backupRestoreDiskFull')} (${code})`, 'error');
          return;
        default:
          showToast(`${tCommon('error.operationFailed')} (${code})`, 'error');
      }
    },
    [onLocked, showToast, tCommon]
  );

  const handleExportBackup = useCallback(() => setExportModalOpen(true), []);

  const handleImportBackup = useCallback(async () => {
    const picked = await backupPickFile();
    if (!picked) return;
    setPendingImportToken(picked.token);
    setPendingImportLabel(picked.fileName);
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImportToken) return;
    setIsRestoringBackup(true);
    try {
      await restoreBackupWorkflowFromPick(pendingImportToken);
      await backupDiscardPick(pendingImportToken);
      showToast(tVault('backup.import.success'), 'success');
      setPendingImportToken(null);
      setPendingImportLabel(null);
      onLocked();
    } catch (err) {
      handleBackupError(err);
    } finally {
      setIsRestoringBackup(false);
    }
  }, [handleBackupError, onLocked, pendingImportToken, showToast, tVault]);

  const handleCloseImport = useCallback(() => {
    if (isRestoringBackup) return;
    if (pendingImportToken) void backupDiscardPick(pendingImportToken);
    setPendingImportToken(null);
    setPendingImportLabel(null);
  }, [isRestoringBackup, pendingImportToken]);

  useEffect(() => {
    if (!backupsEnabled) return;

    const intervalId = setInterval(() => {
      createBackupIfDueAuto()
        .then((path) => {
          if (path) {
            showToast(tVault('backup.auto.success'), 'success');
          }
        })
        .catch((err) => {
          const code = err?.code ?? err?.error ?? err?.message ?? 'UNKNOWN';
          if (code === 'BACKUP_ALREADY_RUNNING') {
            return;
          }
          handleBackupError(err);
        });
    }, 60_000);

    return () => clearInterval(intervalId);
  }, [backupsEnabled, handleBackupError, showToast, tVault]);

  return {
    exportModalOpen,
    setExportModalOpen,
    pendingImportToken,
    pendingImportLabel,
    isRestoringBackup,
    handleExportBackup,
    handleImportBackup,
    handleConfirmImport,
    handleCloseImport,
    handleBackupError,
  };
}

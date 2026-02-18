import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import { createBackup } from '../../api/vaultApi';

export type ExportBackupModalProps = {
  open: boolean;
  profileId: string;
  onClose: () => void;
};

const formatTimestamp = () => {
  const now = new Date();
  return now
    .toISOString()
    .replace(/\..+/, '')
    .replace('T', '_')
    .replace(/:/g, '-');
};

export function ExportBackupModal({ open, profileId, onClose }: ExportBackupModalProps) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const { show: showToast } = useToaster();
  const [useDefaultPath, setUseDefaultPath] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestedFileName, setSuggestedFileName] = useState('');

  useEffect(() => {
    if (!open) return;
    setUseDefaultPath(true);
    setIsSaving(false);
    const timestamp = formatTimestamp();
    setSuggestedFileName(`backup_${timestamp}_${profileId}.pmbackup.zip`);
  }, [open, profileId]);

  if (!open) return null;

  const handleCreate = async () => {
    setIsSaving(true);

    try {
      const path = await createBackup(useDefaultPath, suggestedFileName);
      if (!path) return;
      showToast(t('backup.export.success'), 'success');
      onClose();
    } catch (err: any) {
      const code = err?.code ?? err?.error ?? 'UNKNOWN';
      switch (code) {
        case 'BACKUP_DESTINATION_REQUIRED':
          showToast(`${tCommon('error.backupDestinationRequired')} (${code})`, 'error');
          break;
        case 'BACKUP_DESTINATION_UNAVAILABLE':
          showToast(`${tCommon('error.backupDestinationUnavailable')} (${code})`, 'error');
          break;
        case 'BACKUP_DESTINATION_PATH_FORBIDDEN':
        case 'BACKUP_INSPECT_PATH_FORBIDDEN':
        case 'BACKUP_RESTORE_PATH_FORBIDDEN':
          showToast(`${tCommon('error.operationBlocked')} (${code})`, 'error');
          break;
        default:
          showToast(`${tCommon('error.operationFailed')} (${code})`, 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-backup-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onClose}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="export-backup-title" className="dialog-title">
            {t('backup.export.title')}
          </h2>
        </div>

        <div className="dialog-body">
          <div
            className="form-field"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 140px',
              alignItems: 'center',
              columnGap: 16,
            }}
          >
            <span className="form-label" id="use-default-path-label">
              {t('backup.export.useDefaultPath')}
            </span>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                id="use-default-path-switch"
                type="button"
                role="switch"
                aria-checked={useDefaultPath}
                aria-labelledby="use-default-path-label"
                disabled={isSaving}
                onClick={() => setUseDefaultPath((v) => !v)}
                onKeyDown={(e) => {
                  if (isSaving) return;
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setUseDefaultPath((v) => !v);
                  }
                }}
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 9999,
                  border: useDefaultPath ? '1px solid rgba(34, 197, 94, 0.95)' : '1px solid rgba(255, 255, 255, 0.25)',
                  background: useDefaultPath ? 'rgba(34, 197, 94, 0.55)' : 'rgba(255, 255, 255, 0.14)',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  opacity: isSaving ? 0.65 : 1,
                  outline: 'none',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9999,
                    background: 'rgba(255, 255, 255, 0.95)',
                    transform: useDefaultPath ? 'translateX(22px)' : 'translateX(2px)',
                    transition: 'transform 160ms ease',
                  }}
                />
              </button>
            </div>
          </div>
          {!useDefaultPath && (
            <div className="form-field">
              <p className="dialog-description">
                {t('backup.export.choosePath')}: {suggestedFileName}
              </p>
              <p className="dialog-description">
                {tCommon('action.create')}: {t('backup.export.create')}
              </p>
            </div>
          )}
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onClose} disabled={isSaving}>
              {tCommon('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleCreate}
              disabled={isSaving}
            >
              {t('backup.export.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

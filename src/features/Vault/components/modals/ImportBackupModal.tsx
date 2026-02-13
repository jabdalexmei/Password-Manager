import React from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';

export type ImportBackupModalProps = {
  open: boolean;
  backupPath: string | null; // now used as display label (e.g. profile name)
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ImportBackupModal({ open, backupPath, isSubmitting, onCancel, onConfirm }: ImportBackupModalProps) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-backup-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onCancel}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="import-backup-title" className="dialog-title">
            {t('backup.import.confirmTitle')}
          </h2>
        </div>

        <div className="dialog-body">
          <p className="dialog-description">{t('backup.import.confirmBody')}</p>
          {backupPath && <p className="dialog-description">{backupPath}</p>}
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
              {tCommon('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={isSubmitting}>
              {t('backup.import.restore')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

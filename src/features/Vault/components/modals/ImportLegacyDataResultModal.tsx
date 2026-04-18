import React from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import type { LegacyImportResultDto } from '../../api/vaultApi';

type Props = {
  open: boolean;
  result: LegacyImportResultDto | null;
  onClose: () => void;
};

export function ImportLegacyDataResultModal({ open, result, onClose }: Props) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');

  if (!open || !result) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-legacy-result-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onClose}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="import-legacy-result-title" className="dialog-title">
            {t('legacyImport.resultTitle')}
          </h2>
        </div>

        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="dialog-description">{t('legacyImport.result.imported', { count: result.importedCount })}</div>
          <div className="dialog-description">{t('legacyImport.result.skipped', { count: result.skippedCount })}</div>
          <div className="dialog-description">{t('legacyImport.result.errors', { count: result.errorCount })}</div>
          <div className="dialog-description">{t('legacyImport.result.reportPath', { path: result.reportPath })}</div>

          {result.errors.length > 0 && (
            <div
              style={{
                maxHeight: 220,
                overflowY: 'auto',
                border: '1px solid var(--sem-border-default)',
                borderRadius: 12,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {result.errors.slice(0, 20).map((error) => (
                <div key={`${error.row_number}-${error.code}`} className="dialog-description">
                  {`#${error.row_number} ${error.title || 'Untitled'}: ${error.code}`}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left" />
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={onClose}>
              {tCommon('action.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import type { LegacyImportInspectDto } from '../../api/vaultApi';

type Props = {
  open: boolean;
  fileName: string | null;
  inspect: LegacyImportInspectDto | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ImportLegacyDataModal({
  open,
  fileName,
  inspect,
  isSubmitting,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');

  if (!open || !inspect) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-legacy-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onCancel}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="import-legacy-title" className="dialog-title">
            {t('legacyImport.confirmTitle')}
          </h2>
        </div>

        <div className="dialog-body">
          <p className="dialog-description">{t('legacyImport.confirmBody')}</p>
          {fileName && <p className="dialog-description">{fileName}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            <div className="dialog-description">{t('legacyImport.summary.totalRows', { count: inspect.total_rows })}</div>
            <div className="dialog-description">
              {t('legacyImport.summary.foldersToCreate', { count: inspect.folders_to_create_count })}
            </div>
            <div className="dialog-description">
              {t('legacyImport.summary.missingTitles', { count: inspect.missing_title_rows })}
            </div>
          </div>
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
              {tCommon('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={isSubmitting}>
              {t('legacyImport.confirmAction')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import { legacyExportCsvViaDialog } from '../../api/vaultApi';

export type ExportLegacyDataModalProps = {
  open: boolean;
  vaultName: string;
  profileId: string;
  onClose: () => void;
};

const normalizeFileNamePart = (value: string) => {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'vault';
};

const formatCsvExportDatePrefix = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear() % 100).padStart(2, '0');
  return `${day}.${month}.${year}`;
};

export function ExportLegacyDataModal({ open, vaultName, profileId, onClose }: ExportLegacyDataModalProps) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const { show: showToast } = useToaster();
  const [isSaving, setIsSaving] = useState(false);
  const [suggestedFileName, setSuggestedFileName] = useState('');

  useEffect(() => {
    if (!open) return;
    setIsSaving(false);
    const safeVaultName = normalizeFileNamePart(vaultName);
    setSuggestedFileName(`${formatCsvExportDatePrefix()}_vault-name_${safeVaultName}_data-cards_profile-id_${profileId}.csv`);
  }, [open, profileId, vaultName]);

  if (!open) return null;

  const handleExport = async () => {
    let shouldClose = false;
    setIsSaving(true);

    try {
      const path = await legacyExportCsvViaDialog();
      shouldClose = true;
      if (!path) return;
      showToast(t('legacyExport.success'), 'success');
    } catch (err: any) {
      const code = err?.code ?? err?.error ?? 'UNKNOWN';
      showToast(`${tCommon('error.operationFailed')} (${code})`, 'error');
    } finally {
      setIsSaving(false);
      if (shouldClose) {
        onClose();
      }
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-legacy-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onClose}
          disabled={isSaving}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="export-legacy-title" className="dialog-title">
            {t('legacyExport.confirmTitle')}
          </h2>
        </div>

        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="dialog-description">{t('legacyExport.confirmBody')}</p>
          <p className="dialog-description">{t('legacyExport.fileName', { name: suggestedFileName })}</p>
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onClose} disabled={isSaving}>
              {tCommon('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={handleExport} disabled={isSaving}>
              {t('legacyExport.confirmAction')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

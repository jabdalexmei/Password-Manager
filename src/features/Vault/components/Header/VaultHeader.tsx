import React from 'react';
import { IconExport, IconImport, IconLock, IconSettings } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../shared/lib/i18n';

type Props = {
  profileName: string;
  profileId: string;
  isPasswordless: boolean;
  onLock: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onOpenSettings: () => void;
};

export function VaultHeader({
  profileName,
  profileId,
  isPasswordless,
  onLock,
  onExportBackup,
  onImportBackup,
  onOpenSettings,
}: Props) {
  const { t: tVault } = useTranslation('Vault');
  const { t: tTip } = useTranslation('Tooltips');
  const lockLabel = isPasswordless ? tVault('logout') : tVault('lock');

  return (
    <header className="vault-appbar">
      <div className="vault-profile">
        <div className="vault-title">{tVault('title')}</div>
        <div className="vault-subtitle">{tVault('active_profile', { name: profileName, id: profileId })}</div>
      </div>

      <div className="vault-actions">
        <button
          type="button"
          className="vault-action-button"
          onClick={onExportBackup}
          aria-label={tTip('backup.export')}
          title={tTip('backup.export')}
        >
          <IconExport />
        </button>
        <button
          type="button"
          className="vault-action-button"
          onClick={onImportBackup}
          aria-label={tTip('backup.import')}
          title={tTip('backup.import')}
        >
          <IconImport />
        </button>
        <button
          className="vault-action-button"
          type="button"
          aria-label={lockLabel}
          title={lockLabel}
          onClick={onLock}
        >
          <IconLock />
        </button>
        <button
          className="vault-action-button"
          type="button"
          aria-label={tTip('vault.settings')}
          title={tTip('vault.settings')}
          onClick={onOpenSettings}
        >
          <IconSettings />
        </button>
      </div>
    </header>
  );
}

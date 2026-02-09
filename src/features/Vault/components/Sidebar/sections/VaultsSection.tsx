import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../../../shared/lib/i18n';
import ConfirmDialog from '../../../../../shared/components/ConfirmDialog';
import type { SidebarMenu } from '../sidebarTypes';
import type { VaultItem } from '../../../types/ui';

type VaultsSectionProps = {
  vaults: VaultItem[];
  activeVaultId: string;
  multiplyVaultsEnabled: boolean;
  onSelectVault: (vaultId: string) => void | Promise<void>;
  onCreateVault: (name: string) => Promise<VaultItem | void | null> | VaultItem | void | null;
  onRenameVault: (id: string, name: string) => boolean | void | Promise<boolean | void>;
  onDeleteVault: (id: string) => boolean | void | Promise<boolean | void>;
  openMenu: SidebarMenu;
  setOpenMenu: (menu: SidebarMenu) => void;
};

export function VaultsSection({
  vaults,
  activeVaultId,
  multiplyVaultsEnabled,
  onSelectVault,
  onCreateVault,
  onRenameVault,
  onDeleteVault,
  openMenu,
  setOpenMenu,
}: VaultsSectionProps) {
  const { t } = useTranslation('Folders');
  const { t: tCommon } = useTranslation('Common');
  const vaultNameInputRef = useRef<HTMLInputElement | null>(null);
  const renameVaultInputRef = useRef<HTMLInputElement | null>(null);

  const [isCreateVaultOpen, setCreateVaultOpen] = useState(false);
  const [vaultName, setVaultName] = useState('');
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [isCreatingVault, setIsCreatingVault] = useState(false);

  const [renameVaultId, setRenameVaultId] = useState<string | null>(null);
  const [renameVaultName, setRenameVaultName] = useState('');
  const [renameVaultError, setRenameVaultError] = useState<string | null>(null);
  const [isRenamingVault, setIsRenamingVault] = useState(false);

  const [deleteVaultTarget, setDeleteVaultTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingVault, setIsDeletingVault] = useState(false);

  useEffect(() => {
    if (isCreateVaultOpen && vaultNameInputRef.current) {
      vaultNameInputRef.current.focus();
    }
  }, [isCreateVaultOpen]);

  useEffect(() => {
    if (renameVaultId && renameVaultInputRef.current) {
      renameVaultInputRef.current.focus();
    }
  }, [renameVaultId]);

  if (!multiplyVaultsEnabled) {
    return null;
  }

  const openCreateVaultDialog = () => {
    setVaultName('');
    setVaultError(null);
    setIsCreatingVault(false);
    setCreateVaultOpen(true);
  };

  const closeCreateVaultDialog = () => {
    if (isCreatingVault) return;
    setCreateVaultOpen(false);
    setVaultName('');
    setVaultError(null);
  };

  const submitCreateVault = async () => {
    if (isCreatingVault) return;
    const trimmed = vaultName.trim();
    if (!trimmed) {
      setVaultError(t('validation.vaultNameRequired'));
      return;
    }

    setIsCreatingVault(true);
    try {
      const created = await onCreateVault(trimmed);
      if (created === null) return;
      setCreateVaultOpen(false);
      setVaultName('');
      setVaultError(null);
    } finally {
      setIsCreatingVault(false);
    }
  };

  const openRenameVaultDialog = (vaultId: string) => {
    const vault = vaults.find((item) => item.id === vaultId);
    if (!vault) return;
    setOpenMenu(null);
    setRenameVaultId(vault.id);
    setRenameVaultName(vault.name);
    setRenameVaultError(null);
    setIsRenamingVault(false);
  };

  const closeRenameVaultDialog = () => {
    setRenameVaultId(null);
    setRenameVaultName('');
    setRenameVaultError(null);
    setIsRenamingVault(false);
  };

  const submitRenameVault = async () => {
    if (!renameVaultId || isRenamingVault) return;
    const trimmed = renameVaultName.trim();
    if (!trimmed) {
      setRenameVaultError(t('validation.vaultNameRequired'));
      return;
    }

    setIsRenamingVault(true);
    try {
      const ok = await onRenameVault(renameVaultId, trimmed);
      if (ok === false) return;
      closeRenameVaultDialog();
    } finally {
      setIsRenamingVault(false);
    }
  };

  const handleDeleteVaultFromMenu = (vaultId: string) => {
    const vault = vaults.find((item) => item.id === vaultId);
    if (!vault) return;
    setOpenMenu(null);
    setDeleteVaultTarget({ id: vault.id, name: vault.name });
  };

  const renderCreateVaultDialog = () => {
    if (!isCreateVaultOpen) return null;

    const handleSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      void submitCreateVault();
    };

    return (
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeCreateVaultDialog();
          }
        }}
      >
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-vault-title">
          <button
            className="dialog-close dialog-close--topright"
            type="button"
            aria-label={tCommon('action.close')}
            onClick={closeCreateVaultDialog}
          >
            {'\u00D7'}
          </button>
          <div className="dialog-header">
            <h2 id="create-vault-title" className="dialog-title">
              {t('dialog.newVault.title')}
            </h2>
          </div>

          <form className="dialog-body" onSubmit={handleSubmit} autoComplete="off">
            <div className="form-field">
              <label className="form-label" htmlFor="vault-name">
                {t('dialog.newVault.label')}
              </label>
              <input
                id="vault-name"
                className="input"
                autoComplete="off"
                ref={vaultNameInputRef}
                value={vaultName}
                onChange={(e) => {
                  setVaultName(e.target.value);
                  if (vaultError) setVaultError(null);
                }}
                placeholder={t('dialog.newVault.placeholder')}
              />
              {vaultError && <div className="form-error">{vaultError}</div>}
            </div>

            <div className="dialog-footer">
              <button className="btn btn-secondary" type="button" onClick={closeCreateVaultDialog}>
                {tCommon('action.cancel')}
              </button>
              <button className="btn btn-primary" type="submit" disabled={isCreatingVault}>
                {t('action.create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const renderRenameVaultDialog = () => {
    if (!renameVaultId) return null;

    const handleSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      void submitRenameVault();
    };

    return (
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeRenameVaultDialog();
          }
        }}
      >
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="rename-vault-title">
          <button
            className="dialog-close dialog-close--topright"
            type="button"
            aria-label={tCommon('action.close')}
            onClick={closeRenameVaultDialog}
          >
            {'\u00D7'}
          </button>
          <div className="dialog-header">
            <h2 id="rename-vault-title" className="dialog-title">
              {t('dialog.renameVault.title')}
            </h2>
          </div>

          <form className="dialog-body" onSubmit={handleSubmit} autoComplete="off">
            <div className="form-field">
              <label className="form-label" htmlFor="rename-vault-name">
                {t('dialog.renameVault.label')}
              </label>
              <input
                id="rename-vault-name"
                className="input"
                autoComplete="off"
                ref={renameVaultInputRef}
                value={renameVaultName}
                onChange={(e) => {
                  setRenameVaultName(e.target.value);
                  if (renameVaultError) setRenameVaultError(null);
                }}
                placeholder={t('dialog.renameVault.placeholder')}
              />
              {renameVaultError && <div className="form-error">{renameVaultError}</div>}
            </div>

            <div className="dialog-footer">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={closeRenameVaultDialog}
                disabled={isRenamingVault}
              >
                {tCommon('action.cancel')}
              </button>
              <button className="btn btn-primary" type="submit" disabled={isRenamingVault}>
                {t('action.rename')}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="vault-sidebar-title">{t('vaults.title')}</div>
      <ul className="vault-folder-list">
        {vaults.map((vault) => {
          const isActive = activeVaultId === vault.id;
          return (
            <li key={vault.id} className={isActive ? 'active' : ''}>
              <button
                className="vault-folder"
                type="button"
                onClick={() => void onSelectVault(vault.id)}
                onContextMenu={(event) => {
                  if (vault.isDefault) return;
                  event.preventDefault();
                  setOpenMenu({ type: 'vault', vaultId: vault.id, x: event.clientX, y: event.clientY });
                }}
              >
                <span className="folder-name">{vault.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="vault-sidebar-actions vault-sidebar-actions--vaults">
        <button className="btn btn-secondary" type="button" onClick={openCreateVaultDialog}>
          {t('action.addVault')}
        </button>
      </div>

      {renderCreateVaultDialog()}
      {renderRenameVaultDialog()}

      {openMenu && openMenu.type === 'vault' && (
        <div
          className="vault-context-backdrop"
          onClick={() => setOpenMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="vault-context-menu"
            role="menu"
            style={{ top: openMenu.y, left: openMenu.x }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="vault-context-item"
              onClick={() => openRenameVaultDialog(openMenu.vaultId)}
            >
              {t('action.renameVault')}
            </button>
            <button
              type="button"
              className="vault-context-item"
              onClick={() => handleDeleteVaultFromMenu(openMenu.vaultId)}
            >
              {t('action.deleteVault')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteVaultTarget !== null}
        title={t('dialog.deleteVault.title')}
        description={t('dialog.deleteVault.description', { name: deleteVaultTarget?.name ?? '' })}
        confirmLabel={t('dialog.deleteVault.confirm')}
        cancelLabel={tCommon('action.cancel')}
        confirmDisabled={isDeletingVault}
        cancelDisabled={isDeletingVault}
        onCancel={() => {
          if (isDeletingVault) return;
          setDeleteVaultTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteVaultTarget) return;
          setIsDeletingVault(true);
          try {
            const ok = await onDeleteVault(deleteVaultTarget.id);
            if (ok === false) return;
            setDeleteVaultTarget(null);
          } finally {
            setIsDeletingVault(false);
          }
        }}
      />
    </>
  );
}

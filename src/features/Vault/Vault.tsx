import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useVault, type SelectedNav } from './hooks/useVault';
import { VaultHeader } from './components/Header/VaultHeader';
import { Search } from './components/Search/Search';
import { VaultSidebar } from './components/Sidebar/VaultSidebar';
import { DataCards } from './components/DataCards/DataCards';
import { useDataCards } from './components/DataCards/useDataCards';
import { useFolders } from './components/Folders/useFolders';
import { useBankCards } from './hooks/useBankCards';
import { useBankCardsViewModel } from './components/BankCards/useBankCardsViewModel';
import { BankCards } from './components/BankCards/BankCards';
import { BankCardDetails } from './components/BankCards/BankCardDetails';
import { useTranslation } from '../../shared/lib/i18n';
import type { ProfileMeta } from '../../shared/lib/tauri';
import { useToaster } from '../../shared/components/Toaster';
import { IconMoreHorizontal } from '@/shared/icons/lucide/icons';
import {
  backupPickFile,
  backupDiscardPick,
  createBackupIfDueAuto,
  restoreBackupWorkflowFromPick,
} from './api/vaultApi';
import { BackendUserSettings } from './types/backend';
import type { VaultCategory } from './components/Sidebar/sidebarTypes';

const LazyExportBackupModal = React.lazy(() =>
  import('./components/modals/ExportBackupModal').then((m) => ({ default: m.ExportBackupModal })),
);
const LazyImportBackupModal = React.lazy(() =>
  import('./components/modals/ImportBackupModal').then((m) => ({ default: m.ImportBackupModal })),
);
const LazySettingsModal = React.lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const LazyDetails = React.lazy(() =>
  import('./components/Details/Details').then((m) => ({ default: m.Details })),
);
const LazyDeleteFolderModal = React.lazy(() =>
  import('./components/modals/DeleteFolderModal').then((m) => ({ default: m.DeleteFolderModal })),
);

type VaultProps = {
  profileId: string;
  profileName: string;
  isPasswordless: boolean;
  onLocked: () => void;
  onProfileRenamed?: (name: string) => void;
  onProfileUpdated?: (profile: ProfileMeta) => void;
};

export default function Vault({
  profileId,
  profileName,
  isPasswordless,
  onLocked,
  onProfileRenamed,
  onProfileUpdated,
}: VaultProps) {
  const vault = useVault(profileId, onLocked);
  const bankCards = useBankCards(profileId, onLocked, vault.folders, vault.activeVaultId);
  const { t: tDataCards } = useTranslation('DataCards');
  const { t: tBankCards } = useTranslation('BankCards');
  const { t: tFolders } = useTranslation('Folders');
  const { t: tVault } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const { t: tDetails } = useTranslation('Details');
  const { show: showToast } = useToaster();

  const [selectedCategory, setSelectedCategory] = useState<VaultCategory>('data_cards');
  const [activeDetailsKind, setActiveDetailsKind] = useState<'data' | 'bank'>('data');
  const [isAddCardMenuOpen, setIsAddCardMenuOpen] = useState(false);
  const [isGlobalTrashActionsOpen, setIsGlobalTrashActionsOpen] = useState(false);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [pendingImportToken, setPendingImportToken] = useState<string | null>(null);
  const [pendingImportLabel, setPendingImportLabel] = useState<string | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{
    id: string;
    name: string;
    cardsCount: number;
  } | null>(null);

  const dataCardsViewModel = useDataCards({
    cards: vault.visibleCards,
    selectedCardId: vault.selectedCardId,
    isTrashMode: vault.isTrashMode,
    folders: vault.folders,
    defaultFolderId: vault.selectedFolderId,
    onSelectCard: (id) => {
      vault.selectCard(id);
      bankCards.selectCard(null);
      setActiveDetailsKind('data');
    },
    onToggleFavorite: vault.toggleFavorite,
    onToggleArchive: vault.toggleArchive,
    onCreateCard: vault.createCard,
    onUploadAttachments: vault.uploadAttachments,
    onUpdateCard: vault.updateCard,
    onDeleteCard: vault.deleteCard,
    onRestoreCard: vault.restoreCard,
    onPurgeCard: vault.purgeCard,
    onRestoreAllTrash: vault.restoreAllTrash,
    onPurgeAllTrash: vault.purgeAllTrash,
  });

  const bankCardsViewModel = useBankCardsViewModel({
    cards: bankCards.visibleCards,
    defaultFolderId: typeof bankCards.selectedNav === 'object' ? bankCards.selectedNav.folderId : null,
    selectedCardId: bankCards.selectedCardId,
    isTrashMode: bankCards.isTrashMode,
    onSelectCard: (id) => {
      bankCards.selectCard(id);
      vault.selectCard(null);
      setActiveDetailsKind('bank');
    },
    onToggleFavorite: bankCards.toggleFavorite,
    onToggleArchive: bankCards.toggleArchive,
    onCreateCard: bankCards.createCard,
    onUpdateCard: bankCards.updateCard,
    onDeleteCard: bankCards.deleteCard,
    onRestoreCard: bankCards.restoreCard,
    onPurgeCard: bankCards.purgeCard,
    onRestoreAllTrash: bankCards.restoreAllTrash,
    onPurgeAllTrash: bankCards.purgeAllTrash,
  });

  const folderDialogs = useFolders({ onCreateFolder: (name, parentId) => vault.createFolder(name, parentId) });

  const handleSelectVault = useCallback(
    async (vaultId: string) => {
      const changed = await vault.selectVault(vaultId);
      if (!changed) return;
      vault.selectCard(null);
      bankCards.selectCard(null);
    },
    [bankCards.selectCard, vault.selectCard, vault.selectVault]
  );

  const handleCreateVault = useCallback(
    async (name: string) => {
      const created = await vault.createVault(name);
      if (!created) return created;
      const changed = await vault.selectVault(created.id);
      if (changed) {
        vault.selectCard(null);
        bankCards.selectCard(null);
      }
      return created;
    },
    [bankCards.selectCard, vault.createVault, vault.selectCard, vault.selectVault]
  );

  const foldersForCards = useMemo(() => vault.folders, [vault.folders]);

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
    [onLocked, showToast, tCommon],
  );

  const syncSelectNav = useCallback(
    async (nav: SelectedNav) => {
      await Promise.all([vault.selectNav(nav), bankCards.selectNav(nav)]);
      // When switching sections, clear selections to avoid showing stale details.
      vault.selectCard(null);
      bankCards.selectCard(null);
    },
    [bankCards.selectNav, bankCards.selectCard, vault.selectNav, vault.selectCard]
  );

  const handleSelectCategory = useCallback(
    (category: VaultCategory) => {
      if (category === 'all_items') return;
      setSelectedCategory(category);
      setActiveDetailsKind(category === 'bank_cards' ? 'bank' : 'data');
      void syncSelectNav('all');
    },
    [syncSelectNav]
  );

  const handleExportBackup = () => setExportModalOpen(true);

  const handleImportBackup = async () => {
    const picked = await backupPickFile();
    if (!picked) return;
    setPendingImportToken(picked.token);
    setPendingImportLabel(picked.fileName);
  };

  const handleConfirmImport = async () => {
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
  };

  const handleCloseImport = () => {
    if (isRestoringBackup) return;
    if (pendingImportToken) void backupDiscardPick(pendingImportToken);
    setPendingImportToken(null);
    setPendingImportLabel(null);
  };

  const handleOpenSettings = () => setSettingsModalOpen(true);

  const handleSaveSettings = async (nextSettings: BackendUserSettings) => {
    setIsSavingSettings(true);
    const saved = await vault.updateSettings(nextSettings);
    if (saved) {
      bankCards.setSettings(nextSettings);
      setSettingsModalOpen(false);
    }
    setIsSavingSettings(false);
  };

  useEffect(() => {
    if (!vault.settings?.backups_enabled) return;
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
  }, [handleBackupError, showToast, tVault, vault.settings?.backups_enabled]);

  const handleDeleteFolder = (folderId: string) => {
    const target = vault.folders.find((folder) => folder.id === folderId);
    if (!target) return;

    const cardsCount = combinedCounts.folders[folderId] ?? 0;
    setPendingFolderDelete({ id: folderId, name: target.name, cardsCount });
  };

  const closeDeleteModal = () => setPendingFolderDelete(null);

  const handleDeleteFolderOnly = async () => {
    if (!pendingFolderDelete) return;
    await vault.deleteFolderOnly(pendingFolderDelete.id);
    await Promise.all([
      vault.refreshActive(),
      bankCards.refreshActive(),
      vault.refreshTrash(),
      bankCards.refreshTrash(),
    ]);
    setPendingFolderDelete(null);
  };

  const handleDeleteFolderAndCards = async () => {
    if (!pendingFolderDelete) return;
    await vault.deleteFolderAndCards(pendingFolderDelete.id);
    await Promise.all([
      vault.refreshActive(),
      bankCards.refreshActive(),
      vault.refreshTrash(),
      bankCards.refreshTrash(),
    ]);
    setPendingFolderDelete(null);
  };

  const handleAddBankCard = useCallback(() => {
    setSelectedCategory('bank_cards');
    setActiveDetailsKind('bank');
    void syncSelectNav('all');
    bankCardsViewModel.openCreateModal();
  }, [bankCardsViewModel.openCreateModal, syncSelectNav]);

  const combinedCounts = useMemo(() => {
    const sumFolderCounts = (a: Record<string, number>, b: Record<string, number>) => {
      const next: Record<string, number> = { ...a };
      for (const [folderId, count] of Object.entries(b)) {
        next[folderId] = (next[folderId] || 0) + count;
      }
      return next;
    };

    return {
      all: vault.counts.all + bankCards.counts.all,
      favorites: vault.counts.favorites + bankCards.counts.favorites,
      archive: vault.counts.archive + bankCards.counts.archive,
      deleted: vault.counts.deleted + bankCards.counts.deleted,
      folders: sumFolderCounts(vault.counts.folders, bankCards.counts.folders),
    };
  }, [bankCards.counts, vault.counts]);

  // Navigation + Folders are always global (Data + Bank), regardless of Category.
  const sidebarCounts = useMemo(() => combinedCounts, [combinedCounts]);

  const categoryCounts = useMemo(
    () => ({ dataCards: vault.counts.all, bankCards: bankCards.counts.all }),
    [bankCards.counts.all, vault.counts.all]
  );

  const handleNavClick = useCallback(
    (nav: SelectedNav) => {
      // Any Navigation selection is its own mode: it clears Category focus.
      setSelectedCategory('all_items');
      void syncSelectNav(nav);
    },
    [syncSelectNav]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      vault.setSearchQuery(value);
      bankCards.setSearchQuery(value);
    },
    [bankCards.setSearchQuery, vault.setSearchQuery]
  );

  const isFolderView = typeof vault.selectedNav === 'object';
  const showBothLists = isFolderView || selectedCategory === 'all_items';
  const hasVisibleDataCards = dataCardsViewModel.cards.length > 0;
  const hasVisibleBankCards = bankCardsViewModel.cards.length > 0;
  const isNavigationEmpty = !hasVisibleDataCards && !hasVisibleBankCards;
  const emptyLabel = (() => {
    const v = tDataCards('label.empty');
    return v === 'label.empty' ? tCommon('label.empty') : v;
  })();
  const isGlobalTrashMode = showBothLists && typeof vault.selectedNav === 'string' && vault.selectedNav === 'deleted';
  const isGlobalTrashBulkSubmitting = dataCardsViewModel.isTrashBulkSubmitting || bankCardsViewModel.isTrashBulkSubmitting;

  return (
    <div className="vault-shell">
      <VaultHeader
        profileName={profileName}
        profileId={profileId}
        isPasswordless={isPasswordless}
        onLock={vault.lock}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        onOpenSettings={handleOpenSettings}
      />

      <div className="vault-body">
        <aside className="vault-sidebar">
          <div className="vault-sidebar-controls">
            <Search
              query={vault.searchQuery}
              onChange={handleSearchChange}
              filters={selectedCategory !== 'bank_cards' ? vault.filters : undefined}
              onChangeFilters={selectedCategory !== 'bank_cards' ? vault.setFilters : undefined}
            />
          </div>
          <div className="vault-sidebar-actions">
            {selectedCategory === 'all_items' ? (
              <div className="vault-sidebar-addmenu">
                <button
                  className="btn btn-primary"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isAddCardMenuOpen}
                  aria-controls="vault-addcard-menu"
                  onClick={() => setIsAddCardMenuOpen((prev) => !prev)}
                >
                  {tVault('action.addCard')}
                </button>

                {isAddCardMenuOpen && (
                  <>
                    <div className="vault-actionmenu-backdrop" onClick={() => setIsAddCardMenuOpen(false)} />
                    <div className="vault-actionmenu-panel" role="menu" id="vault-addcard-menu">
                      <button
                        className="vault-actionmenu-item"
                        type="button"
                        onClick={() => {
                          setIsAddCardMenuOpen(false);
                          setActiveDetailsKind('data');
                          dataCardsViewModel.openCreateModal();
                        }}
                      >
                        {tFolders('category.dataCards')}
                      </button>
                      <button
                        className="vault-actionmenu-item"
                        type="button"
                        onClick={() => {
                          setIsAddCardMenuOpen(false);
                          setActiveDetailsKind('bank');
                          bankCardsViewModel.openCreateModal();
                        }}
                      >
                        {tFolders('category.bankCards')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : selectedCategory === 'data_cards' ? (
              <button className="btn btn-primary" type="button" onClick={dataCardsViewModel.openCreateModal}>
                {tDataCards('label.addDataCard')}
              </button>
            ) : (
              <button className="btn btn-primary" type="button" onClick={bankCardsViewModel.openCreateModal}>
                {tBankCards('label.addBankCard')}
              </button>
            )}
            <button className="btn btn-secondary" type="button" onClick={() => folderDialogs.openCreateFolder()}>
              {tFolders('action.addFolder')}
            </button>
          </div>
          <VaultSidebar
            vaults={vault.vaults}
            activeVaultId={vault.activeVaultId}
            multiplyVaultsEnabled={Boolean(vault.settings?.multiply_vaults_enabled)}
            onSelectVault={(vaultId) => void handleSelectVault(vaultId)}
            onCreateVault={handleCreateVault}
            onRenameVault={vault.renameVault}
            onDeleteVault={vault.deleteVault}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            onAddBankCard={handleAddBankCard}
            folders={vault.folders}
            counts={sidebarCounts}
            categoryCounts={categoryCounts}
            selectedNav={vault.selectedNav}
            selectedFolderId={vault.selectedFolderId}
            onSelectNav={(nav) => void handleNavClick(nav)}
            dialogState={folderDialogs}
            onDeleteFolder={handleDeleteFolder}
            onRenameFolder={vault.renameFolder}
          />
        </aside>

        <section className="vault-datacards">
          {showBothLists ? (
            <>
              <div className="datacards-header">
                <div className="vault-section-header">{vault.currentSectionTitle}</div>

                <div className="datacards-header__right">
                  {isGlobalTrashMode ? (
                    <div className="datacards-actions">
                      <button
                        className="btn btn-icon vault-actionbar"
                        type="button"
                        aria-label={tDataCards('trash.actions')}
                        aria-haspopup="menu"
                        aria-expanded={isGlobalTrashActionsOpen}
                        disabled={isGlobalTrashBulkSubmitting || isNavigationEmpty}
                        onClick={() => setIsGlobalTrashActionsOpen((prev) => !prev)}
                      >
                        <IconMoreHorizontal className="vault-actionbar-icon" size={18} />
                      </button>

                      {isGlobalTrashActionsOpen && (
                        <>
                          <div
                            className="vault-actionmenu-backdrop"
                            onClick={() => setIsGlobalTrashActionsOpen(false)}
                          />
                          <div className="vault-actionmenu-panel" role="menu">
                            <button
                              className="vault-actionmenu-item"
                              type="button"
                              disabled={isGlobalTrashBulkSubmitting || isNavigationEmpty}
                              onClick={async () => {
                                setIsGlobalTrashActionsOpen(false);
                                await Promise.all([
                                  hasVisibleDataCards ? dataCardsViewModel.restoreAllTrash() : Promise.resolve(),
                                  hasVisibleBankCards ? bankCardsViewModel.restoreAllTrash() : Promise.resolve(),
                                ]);
                              }}
                            >
                              {tDataCards('trash.restoreAll')}
                            </button>

                            <button
                              className="vault-actionmenu-item vault-actionmenu-danger"
                              type="button"
                              disabled={isGlobalTrashBulkSubmitting || isNavigationEmpty}
                              onClick={async () => {
                                setIsGlobalTrashActionsOpen(false);
                                await Promise.all([
                                  hasVisibleDataCards ? dataCardsViewModel.purgeAllTrash() : Promise.resolve(),
                                  hasVisibleBankCards ? bankCardsViewModel.purgeAllTrash() : Promise.resolve(),
                                ]);
                              }}
                            >
                              {tDataCards('trash.removeAll')}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="datacards-header__spacer" aria-hidden="true" />
                  )}
                </div>
              </div>

              {isNavigationEmpty && (
                <div className="vault-datacard-list vault-datacard-list--empty">
                  <div className="vault-empty">{emptyLabel}</div>
                </div>
              )}
              {/*
               * Always mount both panels in combined views so their create/edit dialogs can open
               * even when the corresponding list is currently empty.
               * The panels suppress their own per-section empty placeholder; the combined view
               * renders the global Empty state above.
               */}
              <DataCards
                profileId={profileId}
                viewModel={dataCardsViewModel}
                sectionTitle={tFolders('category.dataCards')}
                clipboardAutoClearEnabled={vault.settings?.clipboard_auto_clear_enabled}
                clipboardClearTimeoutSeconds={vault.settings?.clipboard_clear_timeout_seconds}
                fillHeight={false}
                showTrashActions={!isGlobalTrashMode}
                suppressEmptyState
              />

              <BankCards
                profileId={profileId}
                viewModel={bankCardsViewModel}
                sectionTitle={tFolders('category.bankCards')}
                folders={vault.folders}
                fillHeight={false}
                showTrashActions={!isGlobalTrashMode}
                suppressEmptyState
              />
            </>
          ) : selectedCategory === 'data_cards' ? (
            <DataCards
              profileId={profileId}
              viewModel={dataCardsViewModel}
              sectionTitle={tFolders('category.dataCards')}
              clipboardAutoClearEnabled={vault.settings?.clipboard_auto_clear_enabled}
              clipboardClearTimeoutSeconds={vault.settings?.clipboard_clear_timeout_seconds}
            />
          ) : (
            <BankCards
              profileId={profileId}
              viewModel={bankCardsViewModel}
              sectionTitle={tFolders('category.bankCards')}
              folders={vault.folders}
            />
          )}
        </section>

        <section className="vault-details">
          {activeDetailsKind === 'bank' ? (
            <BankCardDetails
              card={bankCards.selectedCard}
              onEdit={(card) => bankCardsViewModel.openEditModal(card)}
              onDelete={bankCards.deleteCard}
              onRestore={bankCards.restoreCard}
              onPurge={bankCards.purgeCard}
              onToggleFavorite={bankCards.toggleFavorite}
              isTrashMode={bankCards.isTrashMode}
              clipboardAutoClearEnabled={bankCards.settings?.clipboard_auto_clear_enabled}
              clipboardClearTimeoutSeconds={bankCards.settings?.clipboard_clear_timeout_seconds}
            />
          ) : vault.selectedCard ? (
            <Suspense fallback={<p aria-busy="true">{tCommon('label.loading')}</p>}>
              <LazyDetails
                card={vault.selectedCard}
                folders={foldersForCards}
                onAttachmentPresenceChange={vault.setCardHasAttachments}
                onEdit={(card) => dataCardsViewModel.openEditModal(card)}
                onDelete={vault.deleteCard}
                onRestore={vault.restoreCard}
                onPurge={vault.purgeCard}
                onToggleFavorite={vault.toggleFavorite}
                onReloadCard={vault.loadCard}
                isTrashMode={vault.isTrashMode}
                clipboardAutoClearEnabled={vault.settings?.clipboard_auto_clear_enabled}
                clipboardClearTimeoutSeconds={vault.settings?.clipboard_clear_timeout_seconds}
              />
            </Suspense>
          ) : (
            <div className="vault-panel-wrapper">
              <div className="vault-section-header">{tVault('information.title')}</div>
              <div className="vault-empty">{tDetails('empty.selectPrompt')}</div>
            </div>
          )}
        </section>
      </div>

      {pendingFolderDelete !== null && (
        <Suspense fallback={null}>
          <LazyDeleteFolderModal
            open={pendingFolderDelete !== null}
            folderName={pendingFolderDelete?.name ?? ''}
            cardsCount={pendingFolderDelete?.cardsCount ?? 0}
            onCancel={closeDeleteModal}
            onDeleteFolderOnly={handleDeleteFolderOnly}
            onDeleteFolderAndCards={handleDeleteFolderAndCards}
          />
        </Suspense>
      )}

      {exportModalOpen && (
        <Suspense fallback={null}>
          <LazyExportBackupModal
            open={exportModalOpen}
            profileId={profileId}
            onClose={() => setExportModalOpen(false)}
          />
        </Suspense>
      )}

      {pendingImportToken !== null && (
        <Suspense fallback={null}>
          <LazyImportBackupModal
            open={pendingImportToken !== null}
            backupPath={pendingImportLabel}
            isSubmitting={isRestoringBackup}
            onCancel={handleCloseImport}
            onConfirm={handleConfirmImport}
          />
        </Suspense>
      )}

      {settingsModalOpen && (
        <Suspense fallback={null}>
          <LazySettingsModal
            open={settingsModalOpen}
            settings={vault.settings}
            isSaving={isSavingSettings}
            onCancel={() => setSettingsModalOpen(false)}
            onSave={handleSaveSettings}
            profileId={profileId}
            profileName={profileName}
            profileHasPassword={!isPasswordless}
            onProfileRenamed={onProfileRenamed}
            onProfileUpdated={onProfileUpdated}
          />
        </Suspense>
      )}
    </div>
  );
}

import React, { useCallback, useMemo, useState } from 'react';
import { useVault, type SelectedNav } from './hooks/useVault';
import { VaultHeader } from './components/Header/VaultHeader';
import { useDataCards } from './components/DataCards/useDataCards';
import { useFolders } from './components/Folders/useFolders';
import { useBankCards } from './hooks/useBankCards';
import { useBankCardsViewModel } from './components/BankCards/useBankCardsViewModel';
import { useTranslation } from '../../shared/lib/i18n';
import type { ProfileMeta } from '../../shared/lib/tauri';
import { useToaster } from '../../shared/components/Toaster';
import { runTrashAutoCleanupIfEnabled } from './api/vaultApi';
import type { VaultCategory } from './components/Sidebar/sidebarTypes';
import { useBackupFlows } from './flows/useBackupFlows';
import { useLegacyImportFlows } from './flows/useLegacyImportFlows';
import { useSettingsFlows } from './flows/useSettingsFlows';
import { useTrashCleanupBoot } from './flows/useTrashCleanupBoot';
import { VaultLayout } from './layout/VaultLayout';
import { VaultCenterPane } from './layout/VaultCenterPane';
import { VaultDetailsPane } from './layout/VaultDetailsPane';
import { VaultSidebarPane } from './layout/VaultSidebarPane';
import { VaultOverlays } from './layout/VaultOverlays';
import { collectFolderSubtreeIds } from './hooks/vault/lib/collectFolderSubtreeIds';

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
  const [legacyExportModalOpen, setLegacyExportModalOpen] = useState(false);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{
    id: string;
    name: string;
    cardsCount: number;
  } | null>(null);

  const dataCardsViewModel = useDataCards({
    cards: vault.visibleCards,
    loading: vault.loading,
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
    onAttachmentPresenceChange: vault.setCardHasAttachments,
    onAttachmentsChange: vault.setCardAttachments,
    onUpdateCard: vault.updateCard,
    onDeleteCard: vault.deleteCard,
    onRestoreCard: vault.restoreCard,
    onPurgeCard: vault.purgeCard,
    onRestoreAllTrash: vault.restoreAllTrash,
    onPurgeAllTrash: vault.purgeAllTrash,
  });

  const bankCardsViewModel = useBankCardsViewModel({
    cards: bankCards.visibleCards,
    loading: bankCards.loading,
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

  const syncSelectNav = useCallback(
    async (nav: SelectedNav) => {
      await Promise.all([vault.selectNav(nav), bankCards.selectNav(nav)]);
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

  const runTrashCleanupAndRefresh = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      try {
        const result = await runTrashAutoCleanupIfEnabled();
        const shouldRefresh = opts?.forceRefresh || result.purged_datacards > 0 || result.purged_bank_cards > 0;
        if (shouldRefresh) {
          await Promise.all([vault.refreshTrash(), bankCards.refreshTrash()]);
        }
      } catch (err) {
        const code = (err as any)?.code ?? (err as any)?.error ?? 'UNKNOWN';
        showToast(`${tCommon('error.operationFailed')} (${code})`, 'error');
      }
    },
    [bankCards.refreshTrash, showToast, tCommon, vault.refreshTrash]
  );

  const backupFlows = useBackupFlows({
    onLocked,
    showToast,
    tCommon,
    tVault,
    backupsEnabled: vault.settings?.backups_enabled,
  });

  const legacyImportFlows = useLegacyImportFlows({
    showToast,
    tCommon,
    tVault,
    onAfterImport: async () => {
      await Promise.all([vault.refreshActive(), bankCards.refreshActive(), vault.refreshTrash(), bankCards.refreshTrash()]);
    },
  });

  const settingsFlows = useSettingsFlows({
    onUpdateVaultSettings: vault.updateSettings,
    onSetBankCardsSettings: bankCards.setSettings,
    runTrashCleanupAndRefresh,
  });

  useTrashCleanupBoot({
    profileId,
    activeVaultId: vault.activeVaultId,
    isReady: Boolean(vault.settings),
    runCleanup: () => {
      void runTrashCleanupAndRefresh();
    },
  });

  const folderDeleteCardCounts = useMemo(() => {
    const activeFolderIds = [...vault.cards, ...bankCards.cards]
      .map((card) => card.folderId)
      .filter((folderId): folderId is string => Boolean(folderId));

    return vault.folders.reduce<Record<string, number>>((acc, folder) => {
      const subtreeIds = new Set(collectFolderSubtreeIds(folder.id, vault.folders));
      acc[folder.id] = activeFolderIds.reduce(
        (total, folderId) => total + (subtreeIds.has(folderId) ? 1 : 0),
        0
      );
      return acc;
    }, {});
  }, [bankCards.cards, vault.cards, vault.folders]);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      const target = vault.folders.find((folder) => folder.id === folderId);
      if (!target) return;
      const cardsCount = folderDeleteCardCounts[folderId] ?? 0;
      setPendingFolderDelete({ id: folderId, name: target.name, cardsCount });
    },
    [folderDeleteCardCounts, vault.folders]
  );

  const closeDeleteModal = useCallback(() => setPendingFolderDelete(null), []);

  const handleDeleteFolderOnly = useCallback(async () => {
    if (!pendingFolderDelete) return;
    await vault.deleteFolderOnly(pendingFolderDelete.id);
    await Promise.all([vault.refreshActive(), bankCards.refreshActive(), vault.refreshTrash(), bankCards.refreshTrash()]);
    setPendingFolderDelete(null);
  }, [bankCards.refreshActive, bankCards.refreshTrash, pendingFolderDelete, vault]);

  const handleDeleteFolderAndCards = useCallback(async () => {
    if (!pendingFolderDelete) return;
    await vault.deleteFolderAndCards(pendingFolderDelete.id);
    await Promise.all([vault.refreshActive(), bankCards.refreshActive(), vault.refreshTrash(), bankCards.refreshTrash()]);
    setPendingFolderDelete(null);
  }, [bankCards.refreshActive, bankCards.refreshTrash, pendingFolderDelete, vault]);

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

  const sidebarCounts = useMemo(() => combinedCounts, [combinedCounts]);

  const categoryCounts = useMemo(
    () => ({ dataCards: vault.counts.all, bankCards: bankCards.counts.all }),
    [bankCards.counts.all, vault.counts.all]
  );

  const activeVaultName = useMemo(
    () => vault.vaults.find((item) => item.id === vault.activeVaultId)?.name ?? vault.activeVaultId,
    [vault.activeVaultId, vault.vaults]
  );

  const handleNavClick = useCallback(
    (nav: SelectedNav) => {
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
  const foldersForCards = useMemo(() => vault.folders, [vault.folders]);

  return (
    <VaultLayout
      header={
        <VaultHeader
          profileName={profileName}
          profileId={profileId}
          isPasswordless={isPasswordless}
          onLock={vault.lock}
          onExportBackup={backupFlows.handleExportBackup}
          onImportBackup={backupFlows.handleImportBackup}
          onExportLegacyData={() => setLegacyExportModalOpen(true)}
          onImportLegacyData={legacyImportFlows.handleImportLegacyData}
          onOpenSettings={settingsFlows.handleOpenSettings}
        />
      }
      sidebar={
        <VaultSidebarPane
          selectedCategory={selectedCategory}
          activeVault={vault}
          dataCardsViewModel={dataCardsViewModel}
          bankCardsViewModel={bankCardsViewModel}
          folderDialogs={folderDialogs}
          sidebarCounts={sidebarCounts}
          categoryCounts={categoryCounts}
          isAddCardMenuOpen={isAddCardMenuOpen}
          setIsAddCardMenuOpen={setIsAddCardMenuOpen}
          onSearchChange={handleSearchChange}
          onSelectVault={(vaultId) => void handleSelectVault(vaultId)}
          onCreateVault={handleCreateVault}
          onSelectCategory={handleSelectCategory}
          onAddBankCard={handleAddBankCard}
          onSelectNav={(nav) => void handleNavClick(nav)}
          onDeleteFolder={handleDeleteFolder}
          onOpenDataCardCreate={() => {
            setActiveDetailsKind('data');
            dataCardsViewModel.openCreateModal();
          }}
          onOpenBankCardCreate={() => {
            setActiveDetailsKind('bank');
            bankCardsViewModel.openCreateModal();
          }}
          tVault={tVault}
          tFolders={tFolders}
          tDataCards={tDataCards}
          tBankCards={tBankCards}
        />
      }
      centerPane={
        <VaultCenterPane
          profileId={profileId}
          selectedCategory={selectedCategory}
          showBothLists={showBothLists}
          currentSectionTitle={vault.currentSectionTitle}
          selectedNav={vault.selectedNav}
          selectedFolderId={vault.selectedFolderId}
          folders={vault.folders}
          settings={vault.settings}
          dataCardsViewModel={dataCardsViewModel}
          bankCardsViewModel={bankCardsViewModel}
          tDataCards={tDataCards}
          tFolders={tFolders}
          tCommon={tCommon}
        />
      }
      detailsPane={
        <VaultDetailsPane
          activeDetailsKind={activeDetailsKind}
          bankCards={bankCards}
          bankCardsViewModel={bankCardsViewModel}
          vault={vault}
          dataCardsViewModel={dataCardsViewModel}
          foldersForCards={foldersForCards}
          tCommon={tCommon}
          tVault={tVault}
          tDetails={tDetails}
        />
      }
      overlays={
        <VaultOverlays
          profileId={profileId}
          profileName={profileName}
          activeVaultName={activeVaultName}
          isPasswordless={isPasswordless}
          onProfileRenamed={onProfileRenamed}
          onProfileUpdated={onProfileUpdated}
          pendingFolderDelete={pendingFolderDelete}
          closeDeleteModal={closeDeleteModal}
          handleDeleteFolderOnly={handleDeleteFolderOnly}
          handleDeleteFolderAndCards={handleDeleteFolderAndCards}
          legacyExportModalOpen={legacyExportModalOpen}
          closeLegacyExportModal={() => setLegacyExportModalOpen(false)}
          backupFlows={backupFlows}
          legacyImportFlows={legacyImportFlows}
          settingsFlows={settingsFlows}
          vaultSettings={vault.settings}
        />
      }
    />
  );
}

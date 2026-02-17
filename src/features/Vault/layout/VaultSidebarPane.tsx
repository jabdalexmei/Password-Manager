import React from 'react';
import { Search } from '../components/Search/Search';
import { VaultSidebar } from '../components/Sidebar/VaultSidebar';
import type { VaultCategory } from '../components/Sidebar/sidebarTypes';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type VaultSidebarPaneProps = {
  selectedCategory: VaultCategory;
  activeVault: any;
  dataCardsViewModel: any;
  bankCardsViewModel: any;
  folderDialogs: any;
  sidebarCounts: any;
  categoryCounts: any;
  isAddCardMenuOpen: boolean;
  setIsAddCardMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSearchChange: (value: string) => void;
  onSelectVault: (vaultId: string) => void;
  onCreateVault: (name: string) => Promise<any>;
  onSelectCategory: (category: VaultCategory) => void;
  onAddBankCard: () => void;
  onSelectNav: (nav: any) => void;
  onDeleteFolder: (folderId: string) => void;
  onOpenDataCardCreate: () => void;
  onOpenBankCardCreate: () => void;
  tVault: TranslateFn;
  tFolders: TranslateFn;
  tDataCards: TranslateFn;
  tBankCards: TranslateFn;
};

export function VaultSidebarPane({
  selectedCategory,
  activeVault,
  dataCardsViewModel,
  bankCardsViewModel,
  folderDialogs,
  sidebarCounts,
  categoryCounts,
  isAddCardMenuOpen,
  setIsAddCardMenuOpen,
  onSearchChange,
  onSelectVault,
  onCreateVault,
  onSelectCategory,
  onAddBankCard,
  onSelectNav,
  onDeleteFolder,
  onOpenDataCardCreate,
  onOpenBankCardCreate,
  tVault,
  tFolders,
  tDataCards,
  tBankCards,
}: VaultSidebarPaneProps) {
  return (
    <>
      <div className="vault-sidebar-controls">
        <Search
          query={activeVault.searchQuery}
          onChange={onSearchChange}
          filters={selectedCategory !== 'bank_cards' ? activeVault.filters : undefined}
          onChangeFilters={selectedCategory !== 'bank_cards' ? activeVault.setFilters : undefined}
        />
      </div>

      <div className="vault-sidebar-actions">
        {selectedCategory === 'all_items' ? (
          <div className="vault-sidebar-addmenu">
            <button
              className="btn btn-primary vault-sidebar-btn-nowrap vault-sidebar-btn-choosebuttoncard"
              type="button"
              aria-haspopup="menu"
              aria-expanded={isAddCardMenuOpen}
              aria-controls="vault-addcard-menu"
              onClick={() => setIsAddCardMenuOpen((prev) => !prev)}
            >
              {tVault('action.createCard')}
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
                      onOpenDataCardCreate();
                    }}
                  >
                    {tFolders('category.dataCards')}
                  </button>
                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={() => {
                      setIsAddCardMenuOpen(false);
                      onOpenBankCardCreate();
                    }}
                  >
                    {tFolders('category.bankCards')}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : selectedCategory === 'data_cards' ? (
          <button className="btn btn-primary vault-sidebar-btn-nowrap vault-sidebar-btn-datacard" type="button" onClick={dataCardsViewModel.openCreateModal}>
            {tDataCards('label.createDataCard')}
          </button>
        ) : (
          <button className="btn btn-primary vault-sidebar-btn-nowrap vault-sidebar-btn-bankcard" type="button" onClick={bankCardsViewModel.openCreateModal}>
            {tBankCards('label.createBankCard')}
          </button>
        )}
        <button className="btn btn-secondary" type="button" onClick={() => folderDialogs.openCreateFolder()}>
          {tFolders('action.createFolder')}
        </button>
      </div>

      <VaultSidebar
        vaults={activeVault.vaults}
        activeVaultId={activeVault.activeVaultId}
        multiplyVaultsEnabled={Boolean(activeVault.settings?.multiply_vaults_enabled)}
        onSelectVault={onSelectVault}
        onCreateVault={onCreateVault}
        onSetDefaultVault={activeVault.setDefaultVault}
        onRenameVault={activeVault.renameVault}
        onDeleteVault={activeVault.deleteVault}
        selectedCategory={selectedCategory}
        onSelectCategory={onSelectCategory}
        onAddBankCard={onAddBankCard}
        folders={activeVault.folders}
        counts={sidebarCounts}
        categoryCounts={categoryCounts}
        selectedNav={activeVault.selectedNav}
        selectedFolderId={activeVault.selectedFolderId}
        onSelectNav={onSelectNav}
        dialogState={folderDialogs}
        onDeleteFolder={onDeleteFolder}
        onRenameFolder={activeVault.renameFolder}
      />
    </>
  );
}

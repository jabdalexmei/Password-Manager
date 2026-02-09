import React, { useEffect, useState } from 'react';
import type { VaultSidebarProps, SidebarMenu } from './sidebarTypes';
import { VaultsSection } from './sections/VaultsSection';
import { CategorySection } from './sections/CategorySection';
import { NavigationSection } from './sections/NavigationSection';
import { FoldersTreeSection } from './sections/FoldersTreeSection';

export function VaultSidebar(props: VaultSidebarProps) {
  const [openMenu, setOpenMenu] = useState<SidebarMenu>(null);

  useEffect(() => {
    if (!openMenu) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openMenu]);

  return (
    <div>
      <VaultsSection
        vaults={props.vaults}
        activeVaultId={props.activeVaultId}
        multiplyVaultsEnabled={props.multiplyVaultsEnabled}
        onSelectVault={props.onSelectVault}
        onCreateVault={props.onCreateVault}
        onRenameVault={props.onRenameVault}
        onDeleteVault={props.onDeleteVault}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
      />

      <CategorySection
        selectedCategory={props.selectedCategory}
        onSelectCategory={props.onSelectCategory}
        counts={props.counts}
        categoryCounts={props.categoryCounts}
        onAddBankCard={props.onAddBankCard}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
      />

      <NavigationSection
        selectedNav={props.selectedNav}
        selectedCategory={props.selectedCategory}
        counts={props.counts}
        onSelectNav={props.onSelectNav}
      />

      <FoldersTreeSection
        folders={props.folders}
        counts={props.counts}
        selectedFolderId={props.selectedFolderId}
        onSelectNav={props.onSelectNav}
        dialogState={props.dialogState}
        onDeleteFolder={props.onDeleteFolder}
        onRenameFolder={props.onRenameFolder}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
      />
    </div>
  );
}

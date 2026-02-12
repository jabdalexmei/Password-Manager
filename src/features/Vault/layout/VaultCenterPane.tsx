import React, { useState } from 'react';
import { IconMoreHorizontal } from '@/shared/icons/lucide/icons';
import { DataCards } from '../components/DataCards/DataCards';
import { BankCards } from '../components/BankCards/BankCards';
import type { VaultCategory } from '../components/Sidebar/sidebarTypes';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type VaultCenterPaneProps = {
  profileId: string;
  selectedCategory: VaultCategory;
  showBothLists: boolean;
  currentSectionTitle: string;
  selectedNav: any;
  selectedFolderId: string | null;
  folders: any[];
  settings: any;
  dataCardsViewModel: any;
  bankCardsViewModel: any;
  tDataCards: TranslateFn;
  tFolders: TranslateFn;
  tCommon: TranslateFn;
};

export function VaultCenterPane({
  profileId,
  selectedCategory,
  showBothLists,
  currentSectionTitle,
  selectedNav,
  selectedFolderId,
  folders,
  settings,
  dataCardsViewModel,
  bankCardsViewModel,
  tDataCards,
  tFolders,
  tCommon,
}: VaultCenterPaneProps) {
  const [isGlobalTrashActionsOpen, setIsGlobalTrashActionsOpen] = useState(false);

  const hasVisibleDataCards = dataCardsViewModel.cards.length > 0;
  const hasVisibleBankCards = bankCardsViewModel.cards.length > 0;
  const isNavigationEmpty = !hasVisibleDataCards && !hasVisibleBankCards;
  const emptyLabel = (() => {
    const value = tDataCards('label.empty');
    return value === 'label.empty' ? tCommon('label.empty') : value;
  })();
  const isGlobalTrashMode = showBothLists && typeof selectedNav === 'string' && selectedNav === 'deleted';
  const isGlobalTrashBulkSubmitting = dataCardsViewModel.isTrashBulkSubmitting || bankCardsViewModel.isTrashBulkSubmitting;

  if (showBothLists) {
    return (
      <>
        <div className="datacards-header">
          <div className="vault-section-header">{currentSectionTitle}</div>

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
                    <div className="vault-actionmenu-backdrop" onClick={() => setIsGlobalTrashActionsOpen(false)} />
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

        <DataCards
          profileId={profileId}
          viewModel={dataCardsViewModel}
          sectionTitle={tFolders('category.dataCards')}
          activeFolderId={selectedFolderId}
          clipboardAutoClearEnabled={settings?.clipboard_auto_clear_enabled}
          clipboardClearTimeoutSeconds={settings?.clipboard_clear_timeout_seconds}
          fillHeight={false}
          showTrashActions={!isGlobalTrashMode}
          suppressEmptyState
        />

        <BankCards
          profileId={profileId}
          viewModel={bankCardsViewModel}
          sectionTitle={tFolders('category.bankCards')}
          folders={folders}
          fillHeight={false}
          showTrashActions={!isGlobalTrashMode}
          suppressEmptyState
        />
      </>
    );
  }

  if (selectedCategory === 'data_cards') {
    return (
      <DataCards
        profileId={profileId}
        viewModel={dataCardsViewModel}
        sectionTitle={tFolders('category.dataCards')}
        activeFolderId={selectedFolderId}
        clipboardAutoClearEnabled={settings?.clipboard_auto_clear_enabled}
        clipboardClearTimeoutSeconds={settings?.clipboard_clear_timeout_seconds}
      />
    );
  }

  return (
    <BankCards
      profileId={profileId}
      viewModel={bankCardsViewModel}
      sectionTitle={tFolders('category.bankCards')}
      folders={folders}
    />
  );
}

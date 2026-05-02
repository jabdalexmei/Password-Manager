import React from 'react';
import { IconMoreHorizontal } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import { VaultSortControl } from '../../shared/VaultSortControl';
import type { VaultSortMode } from '../../../lib/vaultSort';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DataCardsHeaderProps = {
  sectionTitle: string;
  sortMode: VaultSortMode;
  setSortMode: (nextMode: VaultSortMode) => void;
  shouldShowTrashActions: boolean;
  isTrashActionsOpen: boolean;
  setIsTrashActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isTrashBulkSubmitting: boolean;
  cardsCount: number;
  onRestoreAll: () => Promise<void> | void;
  onPurgeAll: () => Promise<void> | void;
  actionSlot?: React.ReactNode;
  t: TranslateFn;
};

export function DataCardsHeader({
  sectionTitle,
  sortMode,
  setSortMode,
  shouldShowTrashActions,
  isTrashActionsOpen,
  setIsTrashActionsOpen,
  isTrashBulkSubmitting,
  cardsCount,
  onRestoreAll,
  onPurgeAll,
  actionSlot,
  t,
}: DataCardsHeaderProps) {
  const { t: tCommon } = useTranslation('Common');
  const { t: tTip } = useTranslation('Tooltips');

  return (
    <div className="datacards-header">
      <div className="vault-section-header">{sectionTitle}</div>

      <div className="datacards-header__right">
        <VaultSortControl value={sortMode} onChange={setSortMode} disabled={cardsCount < 2} />

        {actionSlot ?? (shouldShowTrashActions ? (
          <div className="datacards-actions">
            <button
              className="btn btn-icon vault-actionbar"
              type="button"
              aria-label={tCommon('common.moreActions')}
              title={tTip('action.moreActions')}
              aria-haspopup="menu"
              aria-expanded={isTrashActionsOpen}
              onClick={() => setIsTrashActionsOpen((prev) => !prev)}
            >
              <IconMoreHorizontal className="vault-actionbar-icon" size={18} />
            </button>

            {isTrashActionsOpen && (
              <>
                <div className="vault-actionmenu-backdrop" onClick={() => setIsTrashActionsOpen(false)} />
                <div className="vault-actionmenu-panel" role="menu">
                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    disabled={isTrashBulkSubmitting || cardsCount === 0}
                    onClick={async () => {
                      setIsTrashActionsOpen(false);
                      await onRestoreAll();
                    }}
                  >
                    {t('trash.restoreAll')}
                  </button>

                  <button
                    className="vault-actionmenu-item vault-actionmenu-danger"
                    type="button"
                    disabled={isTrashBulkSubmitting || cardsCount === 0}
                    onClick={async () => {
                      setIsTrashActionsOpen(false);
                      await onPurgeAll();
                    }}
                  >
                    {t('trash.removeAll')}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null)}
      </div>
    </div>
  );
}

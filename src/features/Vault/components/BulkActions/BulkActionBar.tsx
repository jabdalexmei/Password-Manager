import React, { useState } from 'react';
import { IconMoreHorizontal } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../shared/lib/i18n';

export type BulkMenuAction =
  | 'move'
  | 'export'
  | 'favorite_on'
  | 'favorite_off'
  | 'archive_on'
  | 'archive_off'
  | 'delete'
  | 'restore'
  | 'purge'
  | 'select_all'
  | 'clear';

type BulkActionBarProps = {
  selectedCount: number;
  isSelectionMode: boolean;
  isTrashMode: boolean;
  visibleCount: number;
  exportableCount?: number;
  disabled?: boolean;
  onEnterSelectionMode: () => void;
  onSelectAllVisible: () => void;
  onCancelSelection: () => void;
  onClearSelection: () => void;
  onAction: (action: BulkMenuAction) => void;
};

export function BulkActionBar({
  selectedCount,
  isSelectionMode,
  isTrashMode,
  visibleCount,
  exportableCount = selectedCount,
  disabled = false,
  onEnterSelectionMode,
  onSelectAllVisible,
  onCancelSelection,
  onClearSelection,
  onAction,
}: BulkActionBarProps) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const { t: tTip } = useTranslation('Tooltips');
  const [isMenuOpen, setMenuOpen] = useState(false);

  const close = () => setMenuOpen(false);
  const run = (action: BulkMenuAction) => {
    close();
    if (action === 'select_all') {
      onSelectAllVisible();
      return;
    }
    if (action === 'clear') {
      onClearSelection();
      return;
    }
    onAction(action);
  };

  if (isSelectionMode) {
    return (
      <div className="vault-bulkbar">
        <span className="vault-bulkbar__count">{t('bulk.selected', { count: selectedCount })}</span>
        <div className="datacards-actions">
          <button
            className="btn btn-secondary"
            type="button"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            disabled={disabled}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {t('bulk.actions')}
          </button>

          {isMenuOpen && (
            <>
              <div className="vault-actionmenu-backdrop" onClick={close} />
              <div className="vault-actionmenu-panel" role="menu">
                {isTrashMode ? (
                  <>
                    <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('restore')}>
                      {t('bulk.action.restore')}
                    </button>
                    <button className="vault-actionmenu-item vault-actionmenu-danger" type="button" disabled={selectedCount === 0} onClick={() => run('purge')}>
                      {t('bulk.action.purge')}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('move')}>
                      {t('bulk.action.move')}
                    </button>
                    <button className="vault-actionmenu-item" type="button" disabled={exportableCount === 0} onClick={() => run('export')}>
                      {t('bulk.action.export')}
                    </button>
                    <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('favorite_on')}>
                      {t('bulk.action.favoriteOn')}
                    </button>
                    <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('favorite_off')}>
                      {t('bulk.action.favoriteOff')}
                    </button>
                    <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('archive_on')}>
                      {t('bulk.action.archiveOn')}
                    </button>
                    <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('archive_off')}>
                      {t('bulk.action.archiveOff')}
                    </button>
                    <button className="vault-actionmenu-item vault-actionmenu-danger" type="button" disabled={selectedCount === 0} onClick={() => run('delete')}>
                      {t('bulk.action.delete')}
                    </button>
                  </>
                )}

                <div className="vault-actionmenu-separator" />
                <button className="vault-actionmenu-item" type="button" disabled={visibleCount === 0} onClick={() => run('select_all')}>
                  {t('bulk.action.selectAll')}
                </button>
                <button className="vault-actionmenu-item" type="button" disabled={selectedCount === 0} onClick={() => run('clear')}>
                  {t('bulk.action.clear')}
                </button>
              </div>
            </>
          )}
        </div>
        <button className="btn btn-secondary" type="button" onClick={onCancelSelection}>
          {tCommon('action.cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="datacards-actions">
      <button
        className="btn btn-icon vault-actionbar"
        type="button"
        aria-label={tCommon('common.moreActions')}
        title={tTip('action.moreActions')}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={disabled || visibleCount === 0}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <IconMoreHorizontal className="vault-actionbar-icon" size={18} />
      </button>

      {isMenuOpen && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={close} />
          <div className="vault-actionmenu-panel" role="menu">
            <button
              className="vault-actionmenu-item"
              type="button"
              onClick={() => {
                close();
                onEnterSelectionMode();
              }}
            >
              {t('bulk.enterSelection')}
            </button>
            <button
              className="vault-actionmenu-item"
              type="button"
              onClick={() => {
                close();
                onSelectAllVisible();
              }}
            >
              {t('bulk.action.selectAll')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

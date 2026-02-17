import React from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';

export type DeleteFolderModalProps = {
  open: boolean;
  folderName: string;
  cardsCount: number;
  onCancel: () => void;
  onDeleteFolderOnly: () => void;
  onDeleteFolderAndCards: () => void;
};

export function DeleteFolderModal({
  open,
  folderName,
  cardsCount,
  onCancel,
  onDeleteFolderOnly,
  onDeleteFolderAndCards,
}: DeleteFolderModalProps) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const isEmpty = cardsCount === 0;
  const description = isEmpty
    ? t('vault.delete_folder.empty', { name: folderName })
    : t('vault.delete_folder.contains_cards', { count: cardsCount, name: folderName });

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onCancel}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="delete-folder-title" className="dialog-title">
            {t('vault.delete_folder.title')}
          </h2>
        </div>

        <div className="dialog-body">
          <p className="dialog-description">{description}</p>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            {tCommon('action.cancel')}
          </button>
          <button className="btn btn-primary" type="button" onClick={onDeleteFolderOnly}>
            {t('vault.delete_folder.only')}
          </button>
          {!isEmpty && (
            <button className="btn btn-danger" type="button" onClick={onDeleteFolderAndCards}>
              {t('vault.delete_folder.and_cards')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

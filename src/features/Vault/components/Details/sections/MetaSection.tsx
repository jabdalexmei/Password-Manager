import React from 'react';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type MetaSectionProps = {
  createdText: string;
  updatedText: string;
  showUpdated: boolean;
  isTrashMode: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onEdit: () => void;
  onOpenDeleteConfirm: () => void;
  onRestore: () => void;
  onOpenPurgeConfirm: () => void;
  t: TranslateFn;
};

export function MetaSection({
  createdText,
  updatedText,
  showUpdated,
  isTrashMode,
  isFavorite,
  onToggleFavorite,
  onEdit,
  onOpenDeleteConfirm,
  onRestore,
  onOpenPurgeConfirm,
  t,
}: MetaSectionProps) {
  return (
    <div className="detail-row">
      <div className="detail-dates">
        <div className="muted">{createdText}</div>
        {showUpdated && <div className="muted">{updatedText}</div>}
      </div>
      <div className="detail-actions">
        {!isTrashMode && (
          <>
            <button className="btn btn-secondary" type="button" onClick={onToggleFavorite}>
              {isFavorite ? t('action.unmarkFavorite') : t('action.markFavorite')}
            </button>
            <button className="btn btn-secondary" type="button" onClick={onEdit}>
              {t('action.edit')}
            </button>
            <button className="btn btn-danger" type="button" onClick={onOpenDeleteConfirm}>
              {t('action.delete')}
            </button>
          </>
        )}
        {isTrashMode && (
          <>
            <button className="btn btn-secondary" type="button" onClick={onRestore}>
              {t('action.restore')}
            </button>
            <button className="btn btn-danger" type="button" onClick={onOpenPurgeConfirm}>
              {t('action.delete')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

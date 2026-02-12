import React from 'react';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DataCardDialogActionMenuProps = {
  dialogId: 'datacard-create-dialog' | 'datacard-edit-dialog';
  customFieldTargetDialogId: string | null;
  setCustomFieldTargetDialogId: React.Dispatch<React.SetStateAction<string | null>>;
  isActionMenuOpen: boolean;
  setIsActionMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  actionMenuRef: React.RefObject<HTMLDivElement>;
  actionMenuButtonRef: React.RefObject<HTMLButtonElement>;
  hasTotp: boolean;
  seedPhraseWordCount: number;
  hasCustomFields: boolean;
  onAddCustomField: () => void;
  onOpenTwoFactor: () => void;
  onOpenSeedPhrase: () => void;
  onToggleEditFields: () => void;
  t: TranslateFn;
};

export function DataCardDialogActionMenu({
  dialogId,
  customFieldTargetDialogId,
  setCustomFieldTargetDialogId,
  isActionMenuOpen,
  setIsActionMenuOpen,
  actionMenuRef,
  actionMenuButtonRef,
  hasTotp,
  seedPhraseWordCount,
  hasCustomFields,
  onAddCustomField,
  onOpenTwoFactor,
  onOpenSeedPhrase,
  onToggleEditFields,
  t,
}: DataCardDialogActionMenuProps) {
  return (
    <>
      <button
        type="button"
        className="btn btn-icon dialog-actionbar"
        aria-label={t('action.more')}
        title={t('action.more')}
        onClick={() => {
          const isSameDialog = customFieldTargetDialogId === dialogId;
          setCustomFieldTargetDialogId(dialogId);
          setIsActionMenuOpen((prev) => (isSameDialog ? !prev : true));
        }}
        ref={actionMenuButtonRef}
      >
        <span className="dialog-actionbar-dots">{'\u22EF'}</span>
      </button>

      {isActionMenuOpen && customFieldTargetDialogId === dialogId && (
        <div className="dialog-actionmenu" role="menu" ref={actionMenuRef}>
          <button type="button" className="dialog-actionmenu-item" onClick={onAddCustomField}>
            {t('customFields.add')}
          </button>
          <button type="button" className="dialog-actionmenu-item" onClick={onOpenTwoFactor}>
            {hasTotp ? t('twoFactor.editAction') : t('twoFactor.addAction')}
          </button>
          <button type="button" className="dialog-actionmenu-item" onClick={onOpenSeedPhrase}>
            {seedPhraseWordCount > 0 ? t('seedPhrase.editAction') : t('seedPhrase.addAction')}
          </button>
          {hasCustomFields && (
            <button type="button" className="dialog-actionmenu-item" onClick={onToggleEditFields}>
              {t('customFields.editFields')}
            </button>
          )}
        </div>
      )}
    </>
  );
}

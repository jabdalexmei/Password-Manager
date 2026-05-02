import React from 'react';
import type { DataCardCoreField } from '../../../lib/datacardCoreHiddenFields';
import type { DataCardPreviewField } from '../../../lib/datacardPreviewFields';
import type { DataCardDetailContentField } from '../../../lib/datacardDetailContentFields';
import { isCustomPreviewField, type DataCardCardPreviewField } from '../lib/previewTokens';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type FieldContextMenuProps = {
  coreMenu: { x: number; y: number; field: DataCardCoreField } | null;
  previewMenu: { x: number; y: number; field: DataCardCardPreviewField; allowGlobal: boolean } | null;
  contentMenu: { x: number; y: number; field: DataCardDetailContentField } | null;
  closeCoreMenu: () => void;
  closePreviewMenu: () => void;
  closeContentMenu: () => void;
  toggleCoreFieldHidden: (field: DataCardCoreField) => Promise<void>;
  isCoreFieldHidden: (field: DataCardCoreField) => boolean;
  togglePreviewFieldForCard: (field: DataCardCardPreviewField) => Promise<void>;
  togglePreviewFieldForAllCards: (field: DataCardPreviewField) => Promise<void>;
  togglePreviewFieldFolderOnlyForCurrentFolder: (field: DataCardCardPreviewField) => Promise<void>;
  isFieldInCardPreview: (field: DataCardCardPreviewField) => boolean;
  isFieldInGlobalPreview: (field: DataCardPreviewField) => boolean;
  isFieldInFolderOnlyPreviewForCurrentFolder: (field: DataCardCardPreviewField) => boolean;
  canTogglePreviewFieldFolderOnly: boolean;
  resolveCoreContentField: (field: DataCardCoreField) => DataCardDetailContentField | null;
  resolvePreviewContentField: (field: DataCardCardPreviewField) => DataCardDetailContentField | null;
  isContentFieldConcealed: (field: DataCardDetailContentField) => boolean;
  toggleContentFieldConcealed: (field: DataCardDetailContentField) => Promise<void>;
  t: TranslateFn;
};

export function FieldContextMenu({
  coreMenu,
  previewMenu,
  contentMenu,
  closeCoreMenu,
  closePreviewMenu,
  closeContentMenu,
  toggleCoreFieldHidden,
  isCoreFieldHidden,
  togglePreviewFieldForCard,
  togglePreviewFieldForAllCards,
  togglePreviewFieldFolderOnlyForCurrentFolder,
  isFieldInCardPreview,
  isFieldInGlobalPreview,
  isFieldInFolderOnlyPreviewForCurrentFolder,
  canTogglePreviewFieldFolderOnly,
  resolveCoreContentField,
  resolvePreviewContentField,
  isContentFieldConcealed,
  toggleContentFieldConcealed,
  t,
}: FieldContextMenuProps) {
  const coreContentField = coreMenu ? resolveCoreContentField(coreMenu.field) : null;
  const previewContentField = previewMenu ? resolvePreviewContentField(previewMenu.field) : null;

  return (
    <>
      {coreMenu && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={closeCoreMenu} />
          <div
            className="vault-actionmenu-panel vault-contextmenu-panel"
            role="menu"
            style={
              {
                '--menu-x': `${coreMenu.x}px`,
                '--menu-y': `${coreMenu.y}px`,
              } as React.CSSProperties
            }
          >
            <button className="vault-actionmenu-item" type="button" onClick={() => toggleCoreFieldHidden(coreMenu.field)}>
              {isCoreFieldHidden(coreMenu.field) ? t('coreMenu.showInList') : t('coreMenu.hideInList')}
            </button>

            {coreContentField && (
              <>
                <div className="vault-actionmenu-separator" />
                <button
                  className="vault-actionmenu-item"
                  type="button"
                  onClick={() => {
                    void toggleContentFieldConcealed(coreContentField);
                  }}
                >
                  {isContentFieldConcealed(coreContentField) ? t('contentMenu.revealContent') : t('contentMenu.hideContent')}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {previewMenu && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={closePreviewMenu} />
          <div
            className="vault-actionmenu-panel vault-contextmenu-panel"
            role="menu"
            style={
              {
                '--menu-x': `${previewMenu.x}px`,
                '--menu-y': `${previewMenu.y}px`,
              } as React.CSSProperties
            }
          >
            <button className="vault-actionmenu-item" type="button" onClick={() => togglePreviewFieldForCard(previewMenu.field)}>
              {isFieldInCardPreview(previewMenu.field) ? t('previewMenu.hideThis') : t('previewMenu.showThis')}
            </button>

            {previewMenu.allowGlobal && !isCustomPreviewField(previewMenu.field) && (
              <>
                <div className="vault-actionmenu-separator" />

                <button
                  className="vault-actionmenu-item"
                  type="button"
                  onClick={() => {
                    if (isCustomPreviewField(previewMenu.field)) return;
                    void togglePreviewFieldForAllCards(previewMenu.field);
                  }}
                >
                  {isFieldInGlobalPreview(previewMenu.field) ? t('previewMenu.hideAll') : t('previewMenu.showAll')}
                </button>
              </>
            )}

            {canTogglePreviewFieldFolderOnly && (
              <>
                <div className="vault-actionmenu-separator" />
                <button
                  className="vault-actionmenu-item"
                  type="button"
                  onClick={() => togglePreviewFieldFolderOnlyForCurrentFolder(previewMenu.field)}
                >
                  {isFieldInFolderOnlyPreviewForCurrentFolder(previewMenu.field)
                    ? t('previewMenu.hideFolderOnlyAll')
                    : t('previewMenu.showFolderOnly')}
                </button>
              </>
            )}

            {previewContentField && (
              <>
                <div className="vault-actionmenu-separator" />
                <button
                  className="vault-actionmenu-item"
                  type="button"
                  onClick={() => {
                    void toggleContentFieldConcealed(previewContentField);
                  }}
                >
                  {isContentFieldConcealed(previewContentField)
                    ? t('contentMenu.revealContent')
                    : t('contentMenu.hideContent')}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {contentMenu && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={closeContentMenu} />
          <div
            className="vault-actionmenu-panel vault-contextmenu-panel"
            role="menu"
            style={
              {
                '--menu-x': `${contentMenu.x}px`,
                '--menu-y': `${contentMenu.y}px`,
              } as React.CSSProperties
            }
          >
            <button
              className="vault-actionmenu-item"
              type="button"
              onClick={() => {
                void toggleContentFieldConcealed(contentMenu.field);
              }}
            >
              {isContentFieldConcealed(contentMenu.field)
                ? t('contentMenu.revealContent')
                : t('contentMenu.hideContent')}
            </button>
          </div>
        </>
      )}
    </>
  );
}

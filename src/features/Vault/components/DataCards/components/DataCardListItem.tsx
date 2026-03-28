import React from 'react';
import type { DataCardCoreField } from '../../../lib/datacardCoreHiddenFields';
import type { DataCardPreviewField } from '../../../lib/datacardPreviewFields';
import type { DataCardPreviewFieldsFolderOnlyByFolder } from '../../../lib/datacardPreviewFieldsFolderOnlyByFolder';
import type { DataCardSummary, Folder } from '../../../types/ui';
import type { DataCardsViewModel } from '../useDataCards';
import { buildDataCardMetaLines } from '../lib/buildDataCardMetaLines';
import { DataCardBadges } from './DataCardBadges';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DataCardListItemProps = {
  card: DataCardSummary;
  selectedCardId: string | null;
  viewModel: DataCardsViewModel;
  setCardMenu: React.Dispatch<React.SetStateAction<{ id: string; x: number; y: number } | null>>;
  folders: Folder[];
  activeFolderId?: string | null;
  coreHiddenFields: DataCardCoreField[];
  previewFields: DataCardPreviewField[];
  previewFieldsFolderOnlyByFolder: DataCardPreviewFieldsFolderOnlyByFolder;
  allFolderOnlyFields: Set<string>;
  folderOnlyFieldsHiddenInActiveFolder: Set<string>;
  t: TranslateFn;
};

export function DataCardListItem({
  card,
  selectedCardId,
  viewModel,
  setCardMenu,
  folders,
  activeFolderId,
  coreHiddenFields,
  previewFields,
  previewFieldsFolderOnlyByFolder,
  allFolderOnlyFields,
  folderOnlyFieldsHiddenInActiveFolder,
  t,
}: DataCardListItemProps) {
  const isActive = selectedCardId === card.id;
  const { displayTitleText, metaLines } = buildDataCardMetaLines({
    card,
    folders,
    activeFolderId,
    coreHiddenFields,
    previewFields,
    previewFieldsFolderOnlyByFolder,
    allFolderOnlyFields,
    folderOnlyFieldsHiddenInActiveFolder,
    t,
  });

  return (
    <button
      key={card.id}
      className={`vault-datacard ${isActive ? 'active' : ''}`}
      type="button"
      onClick={() => viewModel.selectCard(card.id)}
      onContextMenu={(event) => {
        if (viewModel.isTrashMode) return;
        event.preventDefault();
        viewModel.selectCard(card.id);
        setCardMenu({ id: card.id, x: event.clientX, y: event.clientY });
      }}
    >
      <div className="datacard-top">
        <div className="datacard-title">{displayTitleText}</div>
        <DataCardBadges
          isFavorite={Boolean(card.isFavorite)}
          hasAttachments={Boolean(card.hasAttachments)}
          hasSeedPhrase={Boolean(card.hasSeedPhrase)}
          hasTotp={Boolean(card.hasTotp)}
          t={t}
        />
      </div>

      {metaLines.length > 0 && (
        <div className="datacard-meta-lines">
          {metaLines.map((line, idx) => (
            <div key={`${card.id}-meta-${idx}`} className="datacard-meta">
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

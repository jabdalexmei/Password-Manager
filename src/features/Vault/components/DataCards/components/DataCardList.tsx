import React from 'react';
import type { DataCardCoreField } from '../../../lib/datacardCoreHiddenFields';
import type { DataCardPreviewField } from '../../../lib/datacardPreviewFields';
import type { DataCardPreviewFieldsFolderOnlyByFolder } from '../../../lib/datacardPreviewFieldsFolderOnlyByFolder';
import type { DataCardSummary, Folder } from '../../../types/ui';
import type { DataCardsViewModel } from '../useDataCards';
import { DataCardListItem } from './DataCardListItem';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DataCardListProps = {
  cards: DataCardSummary[];
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
  disabled?: boolean;
  isRefreshing?: boolean;
  isSelectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  t: TranslateFn;
};

export function DataCardList({
  cards,
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
  disabled = false,
  isRefreshing = false,
  isSelectionMode = false,
  selectedIds,
  onToggleSelection,
  t,
}: DataCardListProps) {
  return (
    <div className={`vault-datacard-list ${isRefreshing ? 'vault-datacard-list--refreshing' : ''}`.trim()}>
      {cards.map((card) => (
        <DataCardListItem
          key={card.id}
          card={card}
          selectedCardId={selectedCardId}
          viewModel={viewModel}
          setCardMenu={setCardMenu}
          folders={folders}
          activeFolderId={activeFolderId}
          coreHiddenFields={coreHiddenFields}
          previewFields={previewFields}
          previewFieldsFolderOnlyByFolder={previewFieldsFolderOnlyByFolder}
          allFolderOnlyFields={allFolderOnlyFields}
          folderOnlyFieldsHiddenInActiveFolder={folderOnlyFieldsHiddenInActiveFolder}
          disabled={disabled}
          isSelectionMode={isSelectionMode}
          isBulkSelected={selectedIds?.has(card.id) ?? false}
          onToggleSelection={onToggleSelection}
          t={t}
        />
      ))}
    </div>
  );
}

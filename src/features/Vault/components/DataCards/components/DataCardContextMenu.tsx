import React from 'react';
import { getDataCard } from '../../../api/vaultApi';
import { mapCardFromBackend } from '../../../types/mappers';
import type { DataCardSummary } from '../../../types/ui';
import type { DataCardsViewModel } from '../useDataCards';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DataCardContextMenuProps = {
  cardMenu: { id: string; x: number; y: number } | null;
  cards: DataCardSummary[];
  onClose: () => void;
  viewModel: DataCardsViewModel;
  t: TranslateFn;
};

export function DataCardContextMenu({ cardMenu, cards, onClose, viewModel, t }: DataCardContextMenuProps) {
  if (!cardMenu || viewModel.isTrashMode) return null;

  const target = cards.find((card) => card.id === cardMenu.id) ?? null;
  const isArchived = Boolean(target?.archivedAt);
  const isFavorite = Boolean(target?.isFavorite);

  return (
    <>
      <div
        className="vault-actionmenu-backdrop"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="vault-actionmenu-panel vault-contextmenu-panel"
        role="menu"
        style={
          {
            '--menu-x': `${cardMenu.x}px`,
            '--menu-y': `${cardMenu.y}px`,
          } as React.CSSProperties
        }
      >
        <button
          className="vault-actionmenu-item"
          type="button"
          onClick={async () => {
            const id = cardMenu.id;
            onClose();
            try {
              const backend = await getDataCard(id);
              const mapped = mapCardFromBackend(backend);
              viewModel.openEditModal(mapped);
            } catch (err) {
              console.error(err);
            }
          }}
        >
          {t('action.edit')}
        </button>

        <button
          className="vault-actionmenu-item"
          type="button"
          onClick={async () => {
            const id = cardMenu.id;
            onClose();
            await viewModel.toggleFavorite(id);
          }}
        >
          {isFavorite ? t('action.unmarkFavorite') : t('action.markFavorite')}
        </button>

        <button
          className="vault-actionmenu-item"
          type="button"
          onClick={async () => {
            const id = cardMenu.id;
            onClose();
            await viewModel.toggleArchive(id);
          }}
        >
          {isArchived ? t('action.unarchive') : t('action.archive')}
        </button>

        <button
          className="vault-actionmenu-item vault-actionmenu-danger"
          type="button"
          onClick={async () => {
            const id = cardMenu.id;
            onClose();
            await viewModel.deleteCard(id);
          }}
        >
          {t('action.delete')}
        </button>
      </div>
    </>
  );
}

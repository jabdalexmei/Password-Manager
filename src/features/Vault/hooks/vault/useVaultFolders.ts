import { useCallback } from 'react';
import type React from 'react';
import { createFolder, deleteFolderAndCards, deleteFolderOnly, renameFolder } from '../../api/vaultApi';
import { mapFolderFromBackend } from '../../types/mappers';
import { sortFolders } from '../../types/sort';
import type { BackendUserSettings } from '../../types/backend';
import type { DataCard, DataCardSummary, Folder } from '../../types/ui';
import type { SelectedNav } from './types';
import { collectFolderSubtreeIds } from './lib/collectFolderSubtreeIds';

type UseVaultFoldersParams = {
  folders: Folder[];
  cards: DataCardSummary[];
  cardDetailsById: Record<string, DataCard>;
  settings: BackendUserSettings | null;
  trashLoaded: boolean;
  refreshTrash: () => Promise<void>;
  handleError: (err: unknown) => void;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  setCardDetailsById: React.Dispatch<React.SetStateAction<Record<string, DataCard>>>;
  setSelectedCardId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedNav: React.Dispatch<React.SetStateAction<SelectedNav>>;
};

export function useVaultFolders({
  folders,
  cards,
  cardDetailsById,
  settings,
  trashLoaded,
  refreshTrash,
  handleError,
  setFolders,
  setCards,
  setCardDetailsById,
  setSelectedCardId,
  setSelectedNav,
}: UseVaultFoldersParams) {
  const createFolderAction = useCallback(
    async (name: string, parentId: string | null) => {
      try {
        const created = await createFolder({ name, parent_id: parentId });
        const mapped = mapFolderFromBackend(created);
        setFolders((prev) => [...prev, mapped].sort(sortFolders));
        return mapped;
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [handleError, setFolders]
  );

  const renameFolderAction = useCallback(
    async (id: string, name: string) => {
      try {
        await renameFolder({ id, name });
        setFolders((prev) => [...prev.map((folder) => (folder.id === id ? { ...folder, name } : folder))].sort(sortFolders));
      } catch (err) {
        handleError(err);
      }
    },
    [handleError, setFolders]
  );

  const deleteFolderOnlyAction = useCallback(
    async (id: string) => {
      try {
        await deleteFolderOnly(id);
        const subtreeIds = collectFolderSubtreeIds(id, folders);
        const removedSet = new Set(subtreeIds);

        setFolders((prev) => prev.filter((folder) => !removedSet.has(folder.id)).sort(sortFolders));
        setCards((prev) =>
          prev.map((card) => (card.folderId && removedSet.has(card.folderId) ? { ...card, folderId: null } : card))
        );
        setCardDetailsById((prev) => {
          const next = { ...prev };
          Object.entries(next).forEach(([cardId, card]) => {
            if (card.folderId && removedSet.has(card.folderId)) {
              next[cardId] = { ...card, folderId: null };
            }
          });
          return next;
        });
        setSelectedNav((prev) => (typeof prev === 'object' && removedSet.has(prev.folderId) ? 'all' : prev));
      } catch (err) {
        handleError(err);
      }
    },
    [folders, handleError, setCardDetailsById, setCards, setFolders, setSelectedNav]
  );

  const deleteFolderAndCardsAction = useCallback(
    async (id: string) => {
      try {
        await deleteFolderAndCards(id);
        const softDeleteEnabled = settings?.soft_delete_enabled ?? true;
        const subtreeIds = collectFolderSubtreeIds(id, folders);
        const removedSet = new Set(subtreeIds);

        setFolders((prev) => prev.filter((folder) => !removedSet.has(folder.id)).sort(sortFolders));
        setCards((prev) => prev.filter((card) => !card.folderId || !removedSet.has(card.folderId)));
        setCardDetailsById((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((cardId) => {
            if (next[cardId].folderId && removedSet.has(next[cardId].folderId)) {
              delete next[cardId];
            }
          });
          return next;
        });
        setSelectedCardId((prev) => {
          if (!prev) return prev;
          const selected = cardDetailsById[prev] ?? cards.find((card) => card.id === prev);
          if (selected?.folderId && removedSet.has(selected.folderId)) {
            return null;
          }
          return prev;
        });
        setSelectedNav((prev) => (typeof prev === 'object' && removedSet.has(prev.folderId) ? 'all' : prev));

        if (softDeleteEnabled && trashLoaded) {
          await refreshTrash();
        }
      } catch (err) {
        handleError(err);
      }
    },
    [
      cardDetailsById,
      cards,
      folders,
      handleError,
      refreshTrash,
      setCardDetailsById,
      setCards,
      setFolders,
      setSelectedCardId,
      setSelectedNav,
      settings,
      trashLoaded,
    ]
  );

  return {
    createFolderAction,
    renameFolderAction,
    deleteFolderOnlyAction,
    deleteFolderAndCardsAction,
  };
}

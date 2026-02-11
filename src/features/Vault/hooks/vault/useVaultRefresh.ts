import { useCallback } from 'react';
import type React from 'react';
import { listDataCardSummaries, listDeletedDataCardSummaries, listFolders, listVaults } from '../../api/vaultApi';
import { mapCardSummaryFromBackend, mapFolderFromBackend, mapVaultFromBackend } from '../../types/mappers';
import { sortFolders } from '../../types/sort';
import type { DataCardSummary, Folder, VaultItem } from '../../types/ui';
import { sortVaultItems } from './lib/sortVaultItems';

type UseVaultRefreshParams = {
  dtf: Intl.DateTimeFormat;
  sortCardsWithSettings: (list: DataCardSummary[]) => DataCardSummary[];
  handleError: (err: unknown) => void;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<{ code: string; message?: string } | null>>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  setDeletedCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  setTrashLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  setVaults: React.Dispatch<React.SetStateAction<VaultItem[]>>;
};

export function useVaultRefresh({
  dtf,
  sortCardsWithSettings,
  handleError,
  setLoading,
  setError,
  setFolders,
  setCards,
  setDeletedCards,
  setTrashLoaded,
  setVaults,
}: UseVaultRefreshParams) {
  const refreshActive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedFolders, fetchedCards] = await Promise.all([listFolders(), listDataCardSummaries()]);
      setFolders(fetchedFolders.map(mapFolderFromBackend).sort(sortFolders));
      setCards(sortCardsWithSettings(fetchedCards.map((card) => mapCardSummaryFromBackend(card, dtf))));
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [dtf, handleError, setCards, setError, setFolders, setLoading, sortCardsWithSettings]);

  const refreshTrash = useCallback(async () => {
    try {
      const trashCards = await listDeletedDataCardSummaries();
      setDeletedCards(sortCardsWithSettings(trashCards.map((card) => mapCardSummaryFromBackend(card, dtf))));
      setTrashLoaded(true);
    } catch (err) {
      handleError(err);
      setTrashLoaded(false);
    }
  }, [dtf, handleError, setDeletedCards, setTrashLoaded, sortCardsWithSettings]);

  const refreshVaults = useCallback(async () => {
    try {
      const fetchedVaults = await listVaults();
      setVaults(sortVaultItems(fetchedVaults.map(mapVaultFromBackend)));
    } catch (err) {
      handleError(err);
    }
  }, [handleError, setVaults]);

  return {
    refreshActive,
    refreshTrash,
    refreshVaults,
  };
}

import { useCallback } from 'react';
import type React from 'react';
import {
  listDataCardSummaries,
  listDataCards,
  listDeletedDataCardSummaries,
  listDeletedDataCards,
  listFolders,
  listVaults,
} from '../../api/vaultApi';
import { mapCardFromBackend, mapCardSummaryFromBackend, mapFolderFromBackend, mapVaultFromBackend } from '../../types/mappers';
import { sortFolders } from '../../types/sort';
import type { DataCard, DataCardSummary, Folder, VaultItem } from '../../types/ui';
import { sortVaultItems } from './lib/sortVaultItems';

type UseVaultRefreshParams = {
  dtf: Intl.DateTimeFormat;
  sortCardsWithSettings: (list: DataCardSummary[]) => DataCardSummary[];
  handleError: (err: unknown) => void;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<{ code: string; message?: string } | null>>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  setCardDetailsById: React.Dispatch<React.SetStateAction<Record<string, DataCard>>>;
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
  setCardDetailsById,
  setDeletedCards,
  setTrashLoaded,
  setVaults,
}: UseVaultRefreshParams) {
  const refreshActive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedFolders, fetchedCardSummaries, fetchedCards] = await Promise.all([
        listFolders(),
        listDataCardSummaries(),
        listDataCards(),
      ]);
      const mappedCards = fetchedCards.map(mapCardFromBackend);
      setFolders(fetchedFolders.map(mapFolderFromBackend).sort(sortFolders));
      setCards(sortCardsWithSettings(fetchedCardSummaries.map((card) => mapCardSummaryFromBackend(card, dtf))));
      setCardDetailsById((prev) => {
        const next = { ...prev };
        for (const card of mappedCards) {
          next[card.id] = card;
        }
        return next;
      });
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [dtf, handleError, setCardDetailsById, setCards, setError, setFolders, setLoading, sortCardsWithSettings]);

  const refreshTrash = useCallback(async () => {
    try {
      const [trashCardSummaries, trashCards] = await Promise.all([listDeletedDataCardSummaries(), listDeletedDataCards()]);
      const mappedCards = trashCards.map(mapCardFromBackend);
      setDeletedCards(sortCardsWithSettings(trashCardSummaries.map((card) => mapCardSummaryFromBackend(card, dtf))));
      setCardDetailsById((prev) => {
        const next = { ...prev };
        for (const card of mappedCards) {
          next[card.id] = card;
        }
        return next;
      });
      setTrashLoaded(true);
    } catch (err) {
      handleError(err);
      setTrashLoaded(false);
    }
  }, [dtf, handleError, setCardDetailsById, setDeletedCards, setTrashLoaded, sortCardsWithSettings]);

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

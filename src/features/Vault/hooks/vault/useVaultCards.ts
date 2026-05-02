import { useCallback } from 'react';
import type React from 'react';
import {
  addAttachmentsViaDialog,
  createDataCard,
  deleteDataCard,
  getDataCard,
  moveDataCardToFolder,
  purgeAllDeletedDataCards,
  purgeDataCard,
  restoreAllDeletedDataCards,
  restoreDataCard,
  setDataCardArchived,
  setDataCardFavorite,
  updateDataCard,
} from '../../api/vaultApi';
import { mapCardFromBackend, mapCardToSummary, mapCreateCardToBackend, mapUpdateCardToBackend } from '../../types/mappers';
import type { BackendUserSettings } from '../../types/backend';
import type { Attachment, CreateDataCardInput, DataCard, DataCardSummary, UpdateDataCardInput } from '../../types/ui';
import type { SelectedNav } from './types';

type UseVaultCardsParams = {
  cards: DataCardSummary[];
  deletedCards: DataCardSummary[];
  cardDetailsById: Record<string, DataCard>;
  dtf: Intl.DateTimeFormat;
  settings: BackendUserSettings | null;
  trashLoaded: boolean;
  isTrashMode: boolean;
  selectedNav: SelectedNav;
  selectedCardId: string | null;
  sortCardsWithSettings: (list: DataCardSummary[]) => DataCardSummary[];
  refreshTrash: () => Promise<void>;
  handleError: (err: unknown) => void;
  setCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  setDeletedCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  setCardDetailsById: React.Dispatch<React.SetStateAction<Record<string, DataCard>>>;
  setSelectedCardId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useVaultCards({
  cards,
  deletedCards,
  cardDetailsById,
  dtf,
  settings,
  trashLoaded,
  isTrashMode,
  selectedNav,
  selectedCardId,
  sortCardsWithSettings,
  refreshTrash,
  handleError,
  setCards,
  setDeletedCards,
  setCardDetailsById,
  setSelectedCardId,
}: UseVaultCardsParams) {
  const loadCard = useCallback(
    async (id: string) => {
      try {
        const card = await getDataCard(id);
        const mapped = mapCardFromBackend(card);
        const summary = mapCardToSummary(mapped, dtf);

        setCardDetailsById((prev) => ({ ...prev, [id]: mapped }));

        if (mapped.deletedAt) {
          setDeletedCards((prev) => {
            const filtered = prev.filter((item) => item.id !== id);
            return sortCardsWithSettings([...filtered, summary]);
          });
          setCards((prev) => prev.filter((item) => item.id !== id));
        } else {
          setCards((prev) => {
            const filtered = prev.filter((item) => item.id !== id);
            return sortCardsWithSettings([...filtered, summary]);
          });
          setDeletedCards((prev) => prev.filter((item) => item.id !== id));
        }
      } catch (err) {
        handleError(err);
      }
    },
    [cards, deletedCards, dtf, handleError, setCardDetailsById, setCards, setDeletedCards, sortCardsWithSettings]
  );

  const createCardAction = useCallback(
    async (input: CreateDataCardInput) => {
      try {
        const created = await createDataCard(mapCreateCardToBackend(input));
        const mapped = mapCardFromBackend(created);
        const inputHasTotp = (input.totpUri ?? '').trim().length > 0;
        const inputHasSeedPhrase = (input.seedPhrase ?? '').trim().length > 0;
        const summary = {
          ...mapCardToSummary(mapped, dtf),
          hasTotp: inputHasTotp,
          hasSeedPhrase: inputHasSeedPhrase,
        };

        setCards((prev) => sortCardsWithSettings([summary, ...prev]));
        setCardDetailsById((prev) => ({ ...prev, [mapped.id]: mapped }));
        return mapped;
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [dtf, handleError, setCardDetailsById, setCards, sortCardsWithSettings]
  );

  const uploadAttachments = useCallback(
    async (cardId: string, paths: string[]) => {
      try {
        await addAttachmentsViaDialog(cardId);
        return [];
      } catch (err) {
        handleError(err);
        return paths;
      }
    },
    [handleError]
  );

  const setCardHasAttachments = useCallback(
    (cardId: string, hasAttachments: boolean) => {
      setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, hasAttachments } : card)));
      setDeletedCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, hasAttachments } : card)));
    },
    [setCards, setDeletedCards]
  );

  const setCardAttachments = useCallback(
    (cardId: string, attachments: Attachment[]) => {
      const hasAttachments = attachments.length > 0;
      setCardDetailsById((prev) =>
        prev[cardId]
          ? {
              ...prev,
              [cardId]: {
                ...prev[cardId],
                attachments,
              },
            }
          : prev
      );
      setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, hasAttachments } : card)));
      setDeletedCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, hasAttachments } : card)));
    },
    [setCardDetailsById, setCards, setDeletedCards]
  );

  const updateCardAction = useCallback(
    async (input: UpdateDataCardInput) => {
      try {
        await updateDataCard(mapUpdateCardToBackend(input));
        const inputHasTotp = (input.totpUri ?? '').trim().length > 0;
        const inputHasSeedPhrase = (input.seedPhrase ?? '').trim().length > 0;
        setCards((prev) => prev.map((card) => (card.id === input.id ? { ...card, hasTotp: inputHasTotp, hasSeedPhrase: inputHasSeedPhrase } : card)));
        setDeletedCards((prev) =>
          prev.map((card) => (card.id === input.id ? { ...card, hasTotp: inputHasTotp, hasSeedPhrase: inputHasSeedPhrase } : card))
        );
        await loadCard(input.id);
        if (isTrashMode) await refreshTrash();
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError, isTrashMode, loadCard, refreshTrash, setCards, setDeletedCards]
  );

  const deleteCardAction = useCallback(
    async (id: string) => {
      try {
        await deleteDataCard(id);
        const softDeleteEnabled = settings?.soft_delete_enabled ?? true;
        const existingSummary = cards.find((card) => card.id === id) || deletedCards.find((card) => card.id === id) || null;

        const cachedSummary = existingSummary
          ? existingSummary
          : cardDetailsById[id]
            ? mapCardToSummary(cardDetailsById[id], dtf)
            : null;

        setCards((prev) => prev.filter((card) => card.id !== id));
        setSelectedCardId((prev) => (prev === id ? null : prev));

        if (softDeleteEnabled) {
          const deletedAt = new Date().toISOString();
          setCardDetailsById((prev) =>
            prev[id]
              ? {
                  ...prev,
                  [id]: {
                    ...prev[id],
                    deletedAt,
                  },
                }
              : prev
          );
          if (trashLoaded && cachedSummary) {
            setDeletedCards((prev) => {
              const filtered = prev.filter((card) => card.id !== id);
              return sortCardsWithSettings([...filtered, { ...cachedSummary, deletedAt }]);
            });
          }
        } else {
          setCardDetailsById((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      } catch (err) {
        handleError(err);
      }
    },
    [
      cardDetailsById,
      cards,
      deletedCards,
      dtf,
      handleError,
      setCardDetailsById,
      setCards,
      setDeletedCards,
      setSelectedCardId,
      settings,
      sortCardsWithSettings,
      trashLoaded,
    ]
  );

  const restoreCardAction = useCallback(
    async (id: string) => {
      try {
        await restoreDataCard(id);

        const restored = deletedCards.find((card) => card.id === id) ?? null;

        setDeletedCards((prev) => prev.filter((card) => card.id !== id));
        setCards((prev) => {
          if (!restored) return prev;
          const updated = { ...restored, deletedAt: null };
          return sortCardsWithSettings([...prev.filter((card) => card.id !== id), updated]);
        });
        setCardDetailsById((prev) =>
          prev[id]
            ? {
                ...prev,
                [id]: {
                  ...prev[id],
                  deletedAt: null,
                },
              }
            : prev
        );

        setSelectedCardId((prev) => (prev === id ? null : prev));
      } catch (err) {
        handleError(err);
      }
    },
    [deletedCards, handleError, setCardDetailsById, setCards, setDeletedCards, setSelectedCardId, sortCardsWithSettings]
  );

  const purgeCardAction = useCallback(
    async (id: string) => {
      try {
        await purgeDataCard(id);
        setDeletedCards((prev) => prev.filter((card) => card.id !== id));
        setCardDetailsById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSelectedCardId((prev) => (prev === id ? null : prev));
      } catch (err) {
        handleError(err);
      }
    },
    [handleError, setCardDetailsById, setDeletedCards, setSelectedCardId]
  );

  const restoreAllTrashAction = useCallback(async () => {
    if (deletedCards.length === 0) return;
    try {
      await restoreAllDeletedDataCards();
      setDeletedCards([]);
      setCards((prev) => sortCardsWithSettings([...prev, ...deletedCards.map((card) => ({ ...card, deletedAt: null }))]));
      setCardDetailsById((prev) => {
        const next = { ...prev };
        for (const card of deletedCards) {
          if (next[card.id]) {
            next[card.id] = {
              ...next[card.id],
              deletedAt: null,
            };
          }
        }
        return next;
      });
      if (selectedNav === 'deleted') {
        setSelectedCardId(null);
      }
    } catch (err) {
      handleError(err);
    }
  }, [deletedCards, handleError, selectedNav, setCardDetailsById, setCards, setDeletedCards, setSelectedCardId, sortCardsWithSettings]);

  const purgeAllTrashAction = useCallback(async () => {
    if (deletedCards.length === 0) return;
    try {
      await purgeAllDeletedDataCards();
      setDeletedCards([]);
      setCardDetailsById((prev) => {
        const next = { ...prev };
        for (const card of deletedCards) {
          delete next[card.id];
        }
        return next;
      });
      setSelectedCardId((prev) => (prev && deletedCards.some((card) => card.id === prev) ? null : prev));
    } catch (err) {
      handleError(err);
    }
  }, [deletedCards, handleError, setCardDetailsById, setDeletedCards, setSelectedCardId]);

  const moveCardAction = useCallback(
    async (id: string, folderId: string | null) => {
      try {
        await moveDataCardToFolder({ id, folder_id: folderId });
        setCards((prev) => sortCardsWithSettings(prev.map((card) => (card.id === id ? { ...card, folderId } : card))));
        setCardDetailsById((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], folderId } } : prev));
      } catch (err) {
        handleError(err);
      }
    },
    [handleError, setCardDetailsById, setCards, sortCardsWithSettings]
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      const current = cards.find((card) => card.id === id);
      if (!current) return;

      const nextFavorite = !current.isFavorite;

      try {
        await setDataCardFavorite({ id: current.id, is_favorite: nextFavorite });

        setCards((prev) => prev.map((card) => (card.id === current.id ? { ...card, isFavorite: nextFavorite } : card)));
        setCardDetailsById((prev) => (prev[current.id] ? { ...prev, [current.id]: { ...prev[current.id], isFavorite: nextFavorite } } : prev));
      } catch (err) {
        handleError(err);
      }
    },
    [cards, handleError, setCardDetailsById, setCards]
  );

  const toggleArchive = useCallback(
    async (id: string) => {
      const current = cards.find((card) => card.id === id);
      if (!current) return;

      const nextArchived = !current.archivedAt;

      try {
        await setDataCardArchived({ id: current.id, is_archived: nextArchived });
        const nextArchivedAt = nextArchived ? new Date().toISOString() : null;

        setCards((prev) => prev.map((card) => (card.id === current.id ? { ...card, archivedAt: nextArchivedAt } : card)));
        setCardDetailsById((prev) =>
          prev[current.id] ? { ...prev, [current.id]: { ...prev[current.id], archivedAt: nextArchivedAt } } : prev
        );

        if (selectedCardId === id) {
          const isArchiveNav = selectedNav === 'archive';
          if ((nextArchived && !isArchiveNav) || (!nextArchived && isArchiveNav)) {
            setSelectedCardId(null);
          }
        }
      } catch (err) {
        handleError(err);
      }
    },
    [cards, handleError, selectedCardId, selectedNav, setCardDetailsById, setCards, setSelectedCardId]
  );

  return {
    loadCard,
    createCardAction,
    uploadAttachments,
    setCardHasAttachments,
    setCardAttachments,
    updateCardAction,
    deleteCardAction,
    restoreCardAction,
    purgeCardAction,
    restoreAllTrashAction,
    purgeAllTrashAction,
    moveCardAction,
    toggleFavorite,
    toggleArchive,
  };
}

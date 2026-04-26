import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createBankCard,
  deleteBankCard,
  getBankCard,
  getSettings,
  listBankCards,
  listDeletedBankCards,
  updateSettings,
  purgeBankCard,
  purgeAllDeletedBankCards,
  restoreBankCard,
  restoreAllDeletedBankCards,
  searchBankCards,
  setBankCardFavorite,
  setBankCardArchived,
  updateBankCard,
} from '../api/vaultApi';
import { useDebouncedValue } from './useDebouncedValue';
import { useI18n, useTranslation } from '../../../shared/lib/i18n';
import { useToaster } from '../../../shared/components/Toaster';
import {
  mapBankCardFromBackend,
  mapBankCardToSummary,
  mapCreateBankCardToBackend,
  mapUpdateBankCardToBackend,
} from '../types/mappers';
import { BankCardItem, BankCardSummary, CreateBankCardInput, UpdateBankCardInput } from '../types/ui';
import { sortCards } from '../types/sort';
import { SelectedNav } from './useVault';
import { BackendUserSettings } from '../types/backend';
import type { Folder } from '../types/ui';
import type { BankCardPreviewField } from '../lib/bankcardPreviewFields';
import { createVaultDateTimeFormatter } from '../utils/dateTime';

export type BankCardsError = { code: string; message?: string } | null;

export function useBankCards(
  profileId: string,
  onLocked: () => void,
  folders: Folder[],
  activeVaultId: string
) {
  const { show: showToast } = useToaster();
  const { language } = useI18n();
  const { t: tCommon } = useTranslation('Common');
  const { t: tVault } = useTranslation('Vault');
  const [cards, setCards] = useState<BankCardSummary[]>([]);
  const [cardDetailsById, setCardDetailsById] = useState<Record<string, BankCardItem>>({});
  const [deletedCards, setDeletedCards] = useState<BankCardSummary[]>([]);
  const [settings, setSettings] = useState<BackendUserSettings | null>(null);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [selectedNav, setSelectedNav] = useState<SelectedNav>('all');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchInput, 200);
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BankCardsError>(null);
  const hasLoadedSettings = settings !== null;
  const dtf = useMemo(
    () => createVaultDateTimeFormatter(settings?.date_time_format ?? 'auto', language),
    [language, settings?.date_time_format]
  );

  useEffect(() => {
    setLoading(true);
    setSelectedNav('all');
    setSelectedCardId(null);
    setTrashLoaded(false);
  }, [activeVaultId, profileId]);

  useEffect(() => {
    setCards([]);
    setCardDetailsById({});
    setDeletedCards([]);
    setSelectedNav('all');
    setSelectedCardId(null);
    setTrashLoaded(false);
    setSettings(null);
  }, [profileId]);

  useEffect(() => {
    const q = debouncedSearchQuery.trim();
    if (!q) {
      setSearchMatchIds(null);
      return;
    }

    let cancelled = false;
    searchBankCards(q)
      .then((ids) => {
        if (cancelled) return;
        setSearchMatchIds(new Set(ids));
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setSearchMatchIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [activeVaultId, debouncedSearchQuery]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            id?: string;
            previewFields?: {
              fields?: BankCardPreviewField[];
              cardNumberMode?: 'full' | 'last_four' | null;
            };
          }
        | undefined;

      const id = detail?.id;
      const previewFields = detail?.previewFields;
      if (!id || !previewFields) return;

      const next = {
        fields: previewFields.fields ?? [],
        cardNumberMode: previewFields.cardNumberMode ?? null,
      };

      setCardDetailsById((prev) => {
        const existing = prev[id];
        if (!existing) return prev;
        return { ...prev, [id]: { ...existing, previewFields: next } };
      });

      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, previewFields: next } : c)));
      setDeletedCards((prev) => prev.map((c) => (c.id === id ? { ...c, previewFields: next } : c)));
    };

    window.addEventListener('bankcard-preview-fields-for-card-changed', handler as EventListener);
    return () => {
      window.removeEventListener('bankcard-preview-fields-for-card-changed', handler as EventListener);
    };
  }, []);

  const isTrashMode = selectedNav === 'deleted';
  const selectedFolderId = typeof selectedNav === 'object' ? selectedNav.folderId : null;

  const mapErrorMessage = useCallback(
    (code: string, fallback?: string) => {
      switch (code) {
        case 'NETWORK_ERROR':
          return tCommon('error.network', { code });
        case 'PROFILE_ID_INVALID':
          return tCommon('error.profileInvalid', { code });
        case 'DB_SCHEMA_MISSING':
        case 'DB_MIGRATION_FAILED':
          return tCommon('error.vaultUnsupportedOrCorrupt', { code });
        case 'VALIDATION_ERROR':
          return fallback ?? tCommon('error.operationFailed', { code });
        default:
          return fallback ?? tCommon('error.operationFailed', { code });
      }
    },
    [tCommon]
  );

  const sortCardsWithSettings = useCallback(
    (list: BankCardSummary[]) => {
      const field = settings?.default_sort_field ?? 'updated_at';
      const direction = settings?.default_sort_direction ?? 'DESC';
      return [...list].sort((a, b) => sortCards(a, b, field, direction));
    },
    [settings]
  );

  useEffect(() => {
    setCards((prev) => sortCardsWithSettings(prev));
    setDeletedCards((prev) => sortCardsWithSettings(prev));
  }, [sortCardsWithSettings]);

  const handleError = useCallback(
    (err: any) => {
      const code = err?.code ?? err?.error ?? 'UNKNOWN';
      const rawMessage = err?.message ?? (typeof err === 'string' ? err : '');

      if (code === 'VAULT_LOCKED') {
        onLocked();
        return;
      }

      const message = mapErrorMessage(code, rawMessage || undefined);
      showToast(message, 'error');
      setError({ code, message });
      console.error(err);
    },
    [mapErrorMessage, onLocked, showToast]
  );

  const refreshActive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedCards = await listBankCards();
      const mappedCards = fetchedCards.map(mapBankCardFromBackend);
      setCards(sortCardsWithSettings(mappedCards.map((card) => mapBankCardToSummary(card, dtf))));
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
  }, [dtf, handleError, sortCardsWithSettings]);

  const refreshTrash = useCallback(async () => {
    try {
      const trashCards = await listDeletedBankCards();
      const mappedCards = trashCards.map(mapBankCardFromBackend);
      setDeletedCards(sortCardsWithSettings(mappedCards.map((card) => mapBankCardToSummary(card, dtf))));
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
  }, [dtf, handleError, sortCardsWithSettings]);

  const updateSettingsAction = useCallback(
    async (nextSettings: BackendUserSettings) => {
      try {
        await updateSettings(nextSettings);
        setSettings(nextSettings);
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError]
  );

  const setSettingsState = useCallback((nextSettings: BackendUserSettings | null) => {
    setSettings(nextSettings);
  }, []);

  const loadCard = useCallback(
    async (id: string) => {
      try {
        const card = await getBankCard(id);
        const mapped = mapBankCardFromBackend(card);
        const summary = mapBankCardToSummary(mapped, dtf);

        setCardDetailsById((prev) => ({ ...prev, [id]: mapped }));

        if (mapped.deletedAt) {
          setDeletedCards((prev) => {
            const filtered = prev.filter((c) => c.id !== id);
            return sortCardsWithSettings([...filtered, { ...summary, deletedAt: mapped.deletedAt }]);
          });
          setCards((prev) => prev.filter((c) => c.id !== id));
        } else {
          setCards((prev) => {
            const filtered = prev.filter((c) => c.id !== id);
            return sortCardsWithSettings([...filtered, summary]);
          });
          setDeletedCards((prev) => prev.filter((c) => c.id !== id));
        }
      } catch (err) {
        handleError(err);
      }
    },
    [dtf, handleError, sortCardsWithSettings]
  );

  useEffect(() => {
    getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
      })
      .catch((err) => {
        handleError(err);
        setLoading(false);
      });
  }, [handleError, profileId]);

  useEffect(() => {
    if (!hasLoadedSettings) return;
    void refreshActive();
    void refreshTrash();
  }, [activeVaultId, hasLoadedSettings, profileId, refreshActive, refreshTrash]);

  useEffect(() => {
    const knownIds = new Set([...cards, ...deletedCards].map((card) => card.id));

    setCardDetailsById((prev) => {
      let changed = false;
      const next: typeof prev = {};

      for (const [id, card] of Object.entries(prev)) {
        if (!knownIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = card;
      }

      return changed ? next : prev;
    });

    setSelectedCardId((prev) => (prev && !knownIds.has(prev) ? null : prev));
  }, [cards, deletedCards]);

  const selectNav = useCallback(
    async (nav: SelectedNav) => {
      setSelectedNav(nav);
      setSelectedCardId(null);

      if (nav === 'deleted' && !trashLoaded) {
        await refreshTrash();
      }
    },
    [refreshTrash, trashLoaded]
  );

  const selectCard = useCallback(
    (id: string | null) => {
      setSelectedCardId(id);
    },
    [setSelectedCardId]
  );

  const createCardAction = useCallback(
    async (input: CreateBankCardInput) => {
      try {
        const effectiveFolderId = input.folderId !== undefined ? input.folderId : selectedFolderId;
        const created = await createBankCard(
          mapCreateBankCardToBackend({ ...input, folderId: effectiveFolderId ?? null })
        );
        const mapped = mapBankCardFromBackend(created);
        const summary = mapBankCardToSummary(mapped, dtf);

        setCards((prev) => sortCardsWithSettings([summary, ...prev]));
        setCardDetailsById((prev) => ({ ...prev, [mapped.id]: mapped }));
        // No implicit navigation/selection. User decides what to select.
        return mapped;
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [dtf, handleError, selectedFolderId, sortCardsWithSettings]
  );

  const updateCardAction = useCallback(
    async (input: UpdateBankCardInput) => {
      try {
        const existingFolderId =
          cardDetailsById[input.id]?.folderId ??
          cards.find((c) => c.id === input.id)?.folderId ??
          deletedCards.find((c) => c.id === input.id)?.folderId ??
          null;
        const effectiveFolderId = input.folderId !== undefined ? input.folderId : existingFolderId;
        await updateBankCard(mapUpdateBankCardToBackend({ ...input, folderId: effectiveFolderId }));
        await loadCard(input.id);
        if (isTrashMode) await refreshTrash();
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [cardDetailsById, cards, deletedCards, handleError, isTrashMode, loadCard, refreshTrash]
  );

  const deleteCardAction = useCallback(
    async (id: string) => {
      try {
        await deleteBankCard(id);
        const softDeleteEnabled = settings?.soft_delete_enabled ?? true;
        const cachedSummary = cardDetailsById[id]
          ? mapBankCardToSummary(cardDetailsById[id], dtf)
          : cards.find((card) => card.id === id) || deletedCards.find((card) => card.id === id);

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
    [cardDetailsById, cards, deletedCards, dtf, handleError, settings, sortCardsWithSettings, trashLoaded]
  );

  const restoreCardAction = useCallback(
    async (id: string) => {
      try {
        await restoreBankCard(id);
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
    [deletedCards, handleError, sortCardsWithSettings]
  );

  const purgeCardAction = useCallback(
    async (id: string) => {
      try {
        await purgeBankCard(id);
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
    [handleError]
  );

  const restoreAllTrashAction = useCallback(async () => {
    if (deletedCards.length === 0) return;
    try {
      await restoreAllDeletedBankCards();
      setDeletedCards([]);
      setCards((prev) =>
        sortCardsWithSettings([
          ...prev,
          ...deletedCards.map((card) => ({ ...card, deletedAt: null })),
        ])
      );
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
      // Keep nav; if user is in "deleted", list becomes empty so clear selection.
      if (selectedNav === 'deleted') {
        setSelectedCardId(null);
      }
    } catch (err) {
      handleError(err);
    }
  }, [deletedCards, handleError, selectedNav, sortCardsWithSettings]);

  const purgeAllTrashAction = useCallback(async () => {
    if (deletedCards.length === 0) return;
    try {
      await purgeAllDeletedBankCards();
      setDeletedCards([]);
      setCardDetailsById((prev) => {
        const next = { ...prev };
        for (const card of deletedCards) {
          delete next[card.id];
        }
        return next;
      });
      setSelectedCardId((prev) =>
        prev && deletedCards.some((card) => card.id === prev) ? null : prev
      );
    } catch (err) {
      handleError(err);
    }
  }, [deletedCards, handleError]);

  const visibleCards = useMemo(() => {
    const activeCards = cards.filter((card) => !card.deletedAt);
    const isArchived = (card: BankCardSummary) => Boolean(card.archivedAt);
    let pool: BankCardSummary[];

    if (selectedNav === 'all') {
      pool = activeCards.filter((card) => !isArchived(card));
    } else if (selectedNav === 'favorites') {
      pool = activeCards.filter((card) => card.isFavorite && !isArchived(card));
    } else if (selectedNav === 'archive') {
      pool = activeCards.filter((card) => isArchived(card));
    } else if (selectedNav === 'deleted') {
      pool = deletedCards;
    } else {
      pool = activeCards.filter((card) => card.folderId === selectedNav.folderId && !isArchived(card));
    }

    if (!debouncedSearchQuery.trim()) return pool;
    if (!searchMatchIds) return pool;
    return pool.filter((card) => searchMatchIds.has(card.id));
  }, [cards, debouncedSearchQuery, deletedCards, searchMatchIds, selectedNav]);

  const selectedCard = useMemo(() => {
    if (!selectedCardId) return null;
    const exists = cards.some((card) => card.id === selectedCardId) || deletedCards.some((card) => card.id === selectedCardId);
    if (!exists) return null;
    return cardDetailsById[selectedCardId] ?? null;
  }, [cardDetailsById, cards, deletedCards, selectedCardId]);

  const currentSectionTitle = useMemo(() => {
    if (selectedFolderId) {
      const folder = folders.find((item) => item.id === selectedFolderId);
      if (folder) return folder.name;
    }

    switch (selectedNav) {
      case 'favorites':
        return tVault('nav.favorites');
      case 'archive':
        return tVault('nav.archive');
      case 'deleted':
        return tVault('nav.deleted');
      case 'all':
      default:
        return tVault('nav.all_items');
    }
  }, [folders, selectedFolderId, selectedNav, tVault]);

  const toggleFavorite = useCallback(
    async (id: string) => {
      const current = cards.find((card) => card.id === id);
      if (!current) return;

      const nextFavorite = !current.isFavorite;

      try {
        await setBankCardFavorite({ id: current.id, is_favorite: nextFavorite });

        setCards((prev) =>
          prev.map((card) => (card.id === current.id ? { ...card, isFavorite: nextFavorite } : card))
        );
        setCardDetailsById((prev) =>
          prev[current.id]
            ? { ...prev, [current.id]: { ...prev[current.id], isFavorite: nextFavorite } }
            : prev
        );
      } catch (err) {
        handleError(err);
      }
    },
    [cards, handleError]
  );

  const toggleArchive = useCallback(
    async (id: string) => {
      const current = cards.find((card) => card.id === id);
      if (!current) return;

      const nextArchived = !current.archivedAt;

      try {
        await setBankCardArchived({ id: current.id, is_archived: nextArchived });
        const nextArchivedAt = nextArchived ? new Date().toISOString() : null;

        setCards((prev) =>
          prev.map((card) => (card.id === current.id ? { ...card, archivedAt: nextArchivedAt } : card))
        );
        setCardDetailsById((prev) =>
          prev[current.id]
            ? { ...prev, [current.id]: { ...prev[current.id], archivedAt: nextArchivedAt } }
            : prev
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
    [cards, handleError, selectedCardId, selectedNav]
  );

  const counts = useMemo(
    () => {
      const activeCards = cards.filter((card) => !card.deletedAt);
      const isArchived = (card: BankCardSummary) => Boolean(card.archivedAt);

      return {
        all: activeCards.filter((card) => !isArchived(card)).length,
        favorites: activeCards.filter((card) => card.isFavorite && !isArchived(card)).length,
        archive: activeCards.filter((card) => isArchived(card)).length,
        deleted: deletedCards.length,
        folders: activeCards.reduce<Record<string, number>>((acc, card) => {
          if (card.folderId && !isArchived(card)) {
            acc[card.folderId] = (acc[card.folderId] || 0) + 1;
          }
          return acc;
        }, {}),
      };
    },
    [cards, deletedCards]
  );

  return {
    cards,
    deletedCards,
    selectedNav,
    selectedCardId,
    selectedCard,
    isTrashMode,
    counts,
    currentSectionTitle,
    searchQuery: searchInput,
    setSearchQuery: setSearchInput,
    loading,
    error,
    visibleCards,
    refreshActive,
    refreshTrash,
    selectNav,
    selectCard,
    createCard: createCardAction,
    updateCard: updateCardAction,
    deleteCard: deleteCardAction,
    restoreCard: restoreCardAction,
    purgeCard: purgeCardAction,
    restoreAllTrash: restoreAllTrashAction,
    purgeAllTrash: purgeAllTrashAction,
    loadCard,
    toggleFavorite,
    toggleArchive,
    settings,
    updateSettings: updateSettingsAction,
    setSettings: setSettingsState,
  };
}

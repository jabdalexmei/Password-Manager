import { useCallback, useEffect, useMemo } from 'react';
import { getSettings } from '../../api/vaultApi';
import { clipboardClearAll, lockVault } from '../../../../shared/lib/tauri';
import { useToaster } from '../../../../shared/components/Toaster';
import { useTranslation } from '../../../../shared/lib/i18n';
import { sortCards } from '../../types/sort';
import type { DataCardSummary } from '../../types/ui';
import { mapErrorMessage } from './lib/errors';
import { useVaultState } from './useVaultState';
import { useVaultSearch } from './useVaultSearch';
import { useVaultRefresh } from './useVaultRefresh';
import { useVaultSettings } from './useVaultSettings';
import { useVaultFolders } from './useVaultFolders';
import { useVaultCards } from './useVaultCards';
import { DEFAULT_ACTIVE_VAULT_ID, type SelectedNav, type VaultError, type VaultFilters } from './types';

export type { SelectedNav, VaultError, VaultFilters };

export function useVault(profileId: string, onLocked: () => void) {
  const { show: showToast } = useToaster();
  const { t: tCommon } = useTranslation('Common');
  const { t: tVault } = useTranslation('Vault');

  const {
    initOnceRef,
    activeVaultId,
    setActiveVaultId,
    vaults,
    setVaults,
    folders,
    setFolders,
    cards,
    setCards,
    cardDetailsById,
    setCardDetailsById,
    deletedCards,
    setDeletedCards,
    settings,
    setSettings,
    trashLoaded,
    setTrashLoaded,
    selectedNav,
    setSelectedNav,
    selectedCardId,
    setSelectedCardId,
    filters,
    setFilters,
    loading,
    setLoading,
    error,
    setError,
  } = useVaultState({ profileId });

  const { searchInput, setSearchInput, debouncedSearchQuery, searchMatchIds } = useVaultSearch(activeVaultId);

  const isTrashMode = selectedNav === 'deleted';
  const selectedFolderId = typeof selectedNav === 'object' ? selectedNav.folderId : null;

  const dtf = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    []
  );

  const sortCardsWithSettings = useCallback(
    (list: DataCardSummary[]) => {
      const field = settings?.default_sort_field ?? 'updated_at';
      const direction = settings?.default_sort_direction ?? 'DESC';
      return [...list].sort((a, b) => sortCards(a, b, field, direction));
    },
    [settings]
  );

  useEffect(() => {
    setCards((prev) => sortCardsWithSettings(prev));
    setDeletedCards((prev) => sortCardsWithSettings(prev));
  }, [setCards, setDeletedCards, sortCardsWithSettings]);

  const handleError = useCallback(
    (err: any) => {
      const code = err?.code ?? err?.error ?? 'UNKNOWN';
      const rawMessage = err?.message ?? (typeof err === 'string' ? err : '');

      if (code === 'VAULT_LOCKED') {
        onLocked();
        return;
      }

      const message = mapErrorMessage(code, tCommon, rawMessage || undefined);
      showToast(message, 'error');
      setError({ code, message });
      console.error(err);
    },
    [onLocked, setError, showToast, tCommon]
  );

  const { refreshActive, refreshTrash, refreshVaults } = useVaultRefresh({
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
  });

  const {
    updateSettingsAction,
    createVaultAction,
    renameVaultAction,
    deleteVaultAction,
    setDefaultVaultAction,
    selectVaultAction,
  } = useVaultSettings({
    activeVaultId,
    setActiveVaultId,
    setSettings,
    setVaults,
    refreshVaults,
    handleError,
  });

  const {
    createFolderAction,
    renameFolderAction,
    deleteFolderOnlyAction,
    deleteFolderAndCardsAction,
  } = useVaultFolders({
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
  });

  const {
    loadCard,
    createCardAction,
    uploadAttachments,
    setCardHasAttachments,
    updateCardAction,
    deleteCardAction,
    restoreCardAction,
    purgeCardAction,
    restoreAllTrashAction,
    purgeAllTrashAction,
    moveCardAction,
    toggleFavorite,
    toggleArchive,
  } = useVaultCards({
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
  });

  useEffect(() => {
    if (initOnceRef.current) return;
    initOnceRef.current = true;

    refreshActive();
    refreshTrash();
    refreshVaults();
    getSettings()
      .then((nextSettings) => {
        const normalizedActiveVaultId = nextSettings.active_vault_id || DEFAULT_ACTIVE_VAULT_ID;
        document.documentElement.dataset.theme = nextSettings.theme === 'darkTheme' ? 'darkTheme' : 'blueTheme';
        setSettings({ ...nextSettings, active_vault_id: normalizedActiveVaultId });
        setActiveVaultId(normalizedActiveVaultId);
      })
      .catch(handleError);
  }, [handleError, initOnceRef, refreshActive, refreshTrash, refreshVaults, setActiveVaultId, setSettings]);

  const selectNav = useCallback(
    async (nav: SelectedNav) => {
      setSelectedNav(nav);
      setSelectedCardId(null);

      if (nav === 'deleted' && !trashLoaded) {
        await refreshTrash();
      }
    },
    [refreshTrash, setSelectedCardId, setSelectedNav, trashLoaded]
  );

  const selectCard = useCallback(
    (id: string | null) => {
      setSelectedCardId(id);
      if (id && !cardDetailsById[id]) {
        void loadCard(id);
      }
    },
    [cardDetailsById, loadCard, setSelectedCardId]
  );

  const lock = useCallback(async () => {
    let shouldNavigate = false;
    try {
      try {
        await lockVault();
        shouldNavigate = true;
      } catch (err) {
        const code = (err as any)?.code ?? 'UNKNOWN';
        if (code === 'VAULT_LOCKED') {
          shouldNavigate = true;
        } else {
          throw err;
        }
      }
    } catch (err) {
      const code = (err as any)?.code ?? 'UNKNOWN';
      const message = mapErrorMessage(code, tCommon, (err as any)?.message ?? undefined);
      showToast(message, 'error');
      console.error(err);
      return;
    } finally {
      try {
        await clipboardClearAll();
      } catch (err) {
        console.error(err);
      }
    }

    if (!shouldNavigate) return;

    setFolders([]);
    setCards([]);
    setDeletedCards([]);
    setTrashLoaded(false);
    setSelectedCardId(null);
    setSelectedNav('all');
    onLocked();
  }, [onLocked, setCards, setDeletedCards, setFolders, setSelectedCardId, setSelectedNav, setTrashLoaded, showToast, tCommon]);

  useEffect(() => {
    if (!settings?.auto_lock_enabled) return;

    const timeoutSec = Number(settings.auto_lock_timeout);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 30 || timeoutSec > 86400) return;

    let timerId: number | null = null;

    const schedule = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        void lock();
      }, timeoutSec * 1000);
    };

    const onActivity = () => {
      schedule();
    };

    schedule();

    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('wheel', onActivity, { passive: true });
    window.addEventListener('focus', onActivity);

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('wheel', onActivity);
      window.removeEventListener('focus', onActivity);
    };
  }, [lock, settings?.auto_lock_enabled, settings?.auto_lock_timeout]);

  const visibleCards = useMemo(() => {
    const activeCards = cards.filter((card) => !card.deletedAt);
    const isArchived = (card: DataCardSummary) => Boolean(card.archivedAt);
    let pool: DataCardSummary[];

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

    const hasAnyFilter = Object.values(filters).some(Boolean);
    if (hasAnyFilter) {
      pool = pool.filter((card) => {
        if (filters.totp && !card.hasTotp) return false;
        if (filters.seedPhrase && !card.hasSeedPhrase) return false;
        if (filters.recoveryEmail && !card.hasRecoveryEmail) return false;
        if (filters.phone && !card.hasPhone) return false;
        if (filters.notes && !card.hasNotes) return false;
        if (filters.attachments && !card.hasAttachments) return false;
        return true;
      });
    }

    if (!debouncedSearchQuery.trim()) return pool;
    if (!searchMatchIds) return pool;
    return pool.filter((card) => searchMatchIds.has(card.id));
  }, [cards, debouncedSearchQuery, deletedCards, filters, searchMatchIds, selectedNav]);

  const selectedCard = useMemo(() => {
    if (selectedCardId && cardDetailsById[selectedCardId]) {
      return cardDetailsById[selectedCardId];
    }
    const pool = isTrashMode ? deletedCards : cards;
    return pool.find((card) => card.id === selectedCardId) ?? null;
  }, [cardDetailsById, cards, deletedCards, isTrashMode, selectedCardId]);

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

  const counts = useMemo(() => {
    const activeCards = cards.filter((card) => !card.deletedAt);
    const isArchived = (card: DataCardSummary) => Boolean(card.archivedAt);

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
  }, [cards, deletedCards]);

  return {
    activeVaultId,
    vaults,
    folders,
    cards,
    deletedCards,
    selectedNav,
    selectedCardId,
    selectedCard,
    isTrashMode,
    counts,
    selectedFolderId,
    currentSectionTitle,
    searchQuery: searchInput,
    setSearchQuery: setSearchInput,
    filters,
    setFilters,
    loading,
    error,
    visibleCards,
    refreshActive,
    refreshTrash,
    selectNav,
    selectCard,
    createVault: createVaultAction,
    setDefaultVault: setDefaultVaultAction,
    renameVault: renameVaultAction,
    deleteVault: deleteVaultAction,
    selectVault: selectVaultAction,
    createFolder: createFolderAction,
    renameFolder: renameFolderAction,
    deleteFolderOnly: deleteFolderOnlyAction,
    deleteFolderAndCards: deleteFolderAndCardsAction,
    createCard: createCardAction,
    setCardHasAttachments,
    uploadAttachments,
    updateCard: updateCardAction,
    deleteCard: deleteCardAction,
    restoreCard: restoreCardAction,
    purgeCard: purgeCardAction,
    restoreAllTrash: restoreAllTrashAction,
    purgeAllTrash: purgeAllTrashAction,
    moveCardToFolder: moveCardAction,
    lock,
    loadCard,
    toggleArchive,
    toggleFavorite,
    settings,
    updateSettings: updateSettingsAction,
  };
}

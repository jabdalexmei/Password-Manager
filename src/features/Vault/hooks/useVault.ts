import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createVault,
  deleteVault,
  createDataCard,
  createFolder,
  addAttachmentsViaDialog,
  deleteDataCard,
  deleteFolderAndCards,
  deleteFolderOnly,
  getDataCard,
  getSettings,
  updateSettings,
  listDataCardSummaries,
  listDeletedDataCardSummaries,
  listFolders,
  listVaults,
  moveDataCardToFolder,
  purgeDataCard,
  purgeAllDeletedDataCards,
  renameFolder,
  restoreDataCard,
  restoreAllDeletedDataCards,
  setDataCardFavorite,
  setActiveVault,
  setDataCardArchived,
  searchDataCards,
  updateDataCard,
  renameVault,
} from '../api/vaultApi';
import { clipboardClearAll, lockVault } from '../../../shared/lib/tauri';
import {
  mapCardFromBackend,
  mapCardSummaryFromBackend,
  mapCardToSummary,
  mapCreateCardToBackend,
  mapFolderFromBackend,
  mapVaultFromBackend,
  mapUpdateCardToBackend,
} from '../types/mappers';
import {
  CreateDataCardInput,
  DataCard,
  DataCardSummary,
  Folder,
  UpdateDataCardInput,
  VaultItem,
} from '../types/ui';
import { BackendUserSettings } from '../types/backend';
import { useToaster } from '../../../shared/components/Toaster';
import { useTranslation } from '../../../shared/lib/i18n';
import { useDebouncedValue } from './useDebouncedValue';
import { sortCards, sortFolders } from '../types/sort';

export type SelectedNav = 'all' | 'favorites' | 'archive' | 'deleted' | { folderId: string };

export type VaultFilters = {
  totp: boolean;
  seedPhrase: boolean;
  recoveryEmail: boolean;
  phone: boolean;
  notes: boolean;
  attachments: boolean;
};

export type VaultError = { code: string; message?: string } | null;

const DEFAULT_ACTIVE_VAULT_ID = 'default';
const vaultNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const sortVaultItems = (list: VaultItem[]) =>
  [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const byName = vaultNameCollator.compare(a.name, b.name);
    if (byName !== 0) return byName;
    return vaultNameCollator.compare(a.id, b.id);
  });

const collectFolderSubtreeIds = (rootId: string, folders: Folder[]): string[] => {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const children = childrenByParent.get(folder.parentId) ?? [];
    children.push(folder.id);
    childrenByParent.set(folder.parentId, children);
  }

  const ids: string[] = [];
  const stack = [rootId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const folderId = stack.pop();
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);
    ids.push(folderId);
    const children = childrenByParent.get(folderId) ?? [];
    for (const childId of children) {
      stack.push(childId);
    }
  }

  return ids;
};

export function useVault(profileId: string, onLocked: () => void) {
  const { show: showToast } = useToaster();
  const { t: tCommon } = useTranslation('Common');
  const { t: tVault } = useTranslation('Vault');
  const initOnceRef = useRef(false);
  const [activeVaultId, setActiveVaultId] = useState<string>(DEFAULT_ACTIVE_VAULT_ID);
  const [vaults, setVaults] = useState<VaultItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [cards, setCards] = useState<DataCardSummary[]>([]);
  const [cardDetailsById, setCardDetailsById] = useState<Record<string, DataCard>>({});
  const [deletedCards, setDeletedCards] = useState<DataCardSummary[]>([]);
  const [settings, setSettings] = useState<BackendUserSettings | null>(null);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [selectedNav, setSelectedNav] = useState<SelectedNav>('all');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchInput, 200);
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string> | null>(null);
  const [filters, setFilters] = useState<VaultFilters>({
    totp: false,
    seedPhrase: false,
    recoveryEmail: false,
    phone: false,
    notes: false,
    attachments: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<VaultError>(null);
  const dtf = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    []
  );

  useEffect(() => {
    initOnceRef.current = false;
    setFolders([]);
    setCards([]);
    setCardDetailsById({});
    setDeletedCards([]);
    setSelectedNav((prev) => (typeof prev === 'object' ? 'all' : prev));
    setSelectedCardId(null);
    setTrashLoaded(false);
    setFilters({
      totp: false,
      seedPhrase: false,
      recoveryEmail: false,
      phone: false,
      notes: false,
      attachments: false,
    });
  }, [activeVaultId, profileId]);

  useEffect(() => {
    setVaults([]);
    setActiveVaultId(DEFAULT_ACTIVE_VAULT_ID);
  }, [profileId]);

  useEffect(() => {
    const q = debouncedSearchQuery.trim();
    if (!q) {
      setSearchMatchIds(null);
      return;
    }

    let cancelled = false;
    searchDataCards(q)
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
  }, [debouncedSearchQuery]);

  const isTrashMode = selectedNav === 'deleted';
  const selectedFolderId = typeof selectedNav === 'object' ? selectedNav.folderId : null;

  const mapErrorMessage = useCallback(
    (code: string, fallback?: string) => {
      switch (code) {
        case 'NETWORK_ERROR':
          return tCommon('error.network', { code });
        case 'BACKUP_PROFILE_MISMATCH':
          return tCommon('error.backupProfileMismatch', { code });
        case 'BACKUP_UNSUPPORTED_FORMAT':
          return tCommon('error.backupUnsupportedFormat', { code });
        case 'BACKUP_ARCHIVE_TOO_MANY_FILES':
          return tCommon('error.backupTooManyFiles', { code });
        case 'BACKUP_ARCHIVE_TOO_LARGE':
          return tCommon('error.backupTooLarge', { code });
        case 'BACKUP_ARCHIVE_INVALID':
        case 'BACKUP_MANIFEST_INVALID':
        case 'BACKUP_MANIFEST_MISSING':
          return tCommon('error.backupInvalid', { code });
        case 'BACKUP_INTEGRITY_FAILED':
          return tCommon('error.backupIntegrityFailed', { code });
        case 'BACKUP_PICK_NOT_FOUND':
          return tCommon('error.backupPickNotFound', { code });
        case 'BACKUP_RESTORE_FILE_IN_USE':
          return tCommon('error.backupRestoreFileInUse', { code });
        case 'BACKUP_RESTORE_ACCESS_DENIED':
          return tCommon('error.backupRestoreAccessDenied', { code });
        case 'BACKUP_RESTORE_PATH_TOO_LONG':
          return tCommon('error.backupRestorePathTooLong', { code });
        case 'BACKUP_RESTORE_DISK_FULL':
          return tCommon('error.backupRestoreDiskFull', { code });
        case 'BACKUP_DESTINATION_REQUIRED':
          return tCommon('error.backupDestinationRequired', { code });
        case 'BACKUP_DESTINATION_UNAVAILABLE':
          return tCommon('error.backupDestinationUnavailable', { code });
        case 'DIALOG_UNSUPPORTED_FILE_URI':
          return tCommon('error.dialogUnsupported', { code });
        case 'WORKSPACE_CREATE_PATH_FORBIDDEN':
        case 'BACKUP_DESTINATION_PATH_FORBIDDEN':
        case 'BACKUP_RESTORE_PATH_FORBIDDEN':
        case 'BACKUP_INSPECT_PATH_FORBIDDEN':
          return tCommon('error.operationBlocked', { code });
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
      const [fetchedFolders, fetchedCards] = await Promise.all([listFolders(), listDataCardSummaries()]);
      setFolders(fetchedFolders.map(mapFolderFromBackend).sort(sortFolders));
      setCards(sortCardsWithSettings(fetchedCards.map((card) => mapCardSummaryFromBackend(card, dtf))));
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }, [dtf, handleError, sortCardsWithSettings]);

  const refreshTrash = useCallback(async () => {
    try {
      const trashCards = await listDeletedDataCardSummaries();
      setDeletedCards(sortCardsWithSettings(trashCards.map((card) => mapCardSummaryFromBackend(card, dtf))));
      setTrashLoaded(true);
    } catch (err) {
      handleError(err);
      setTrashLoaded(false);
    }
  }, [dtf, handleError, sortCardsWithSettings]);

  const refreshVaults = useCallback(async () => {
    try {
      const fetchedVaults = await listVaults();
      setVaults(sortVaultItems(fetchedVaults.map(mapVaultFromBackend)));
    } catch (err) {
      handleError(err);
    }
  }, [handleError]);

  const updateSettingsAction = useCallback(
    async (nextSettings: BackendUserSettings) => {
      try {
        await updateSettings(nextSettings);
        const normalizedActiveVaultId = nextSettings.multiply_vaults_enabled
          ? (nextSettings.active_vault_id || activeVaultId || DEFAULT_ACTIVE_VAULT_ID)
          : DEFAULT_ACTIVE_VAULT_ID;

        if (normalizedActiveVaultId !== activeVaultId) {
          await setActiveVault(normalizedActiveVaultId);
          setActiveVaultId(normalizedActiveVaultId);
        }

        setSettings({ ...nextSettings, active_vault_id: normalizedActiveVaultId });
        await refreshVaults();
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [activeVaultId, handleError, refreshVaults]
  );

  const loadCard = useCallback(
    async (id: string) => {
      try {
        const card = await getDataCard(id);
        const mapped = mapCardFromBackend(card);
        const summary = mapCardToSummary(mapped, dtf);

        setCardDetailsById((prev) => ({ ...prev, [id]: mapped }));

        if (mapped.deletedAt) {
          setDeletedCards((prev) => {
            const existing = prev.find((c) => c.id === id) ?? cards.find((c) => c.id === id);
            const merged = {
              ...summary,
              hasAttachments: existing?.hasAttachments ?? summary.hasAttachments,
              deletedAt: mapped.deletedAt,
            };
            const filtered = prev.filter((c) => c.id !== id);
            return sortCardsWithSettings([...filtered, merged]);
          });
          setCards((prev) => prev.filter((c) => c.id !== id));
        } else {
          setCards((prev) => {
            const existing = prev.find((c) => c.id === id) ?? deletedCards.find((c) => c.id === id);
            const merged = {
              ...summary,
              hasAttachments: existing?.hasAttachments ?? summary.hasAttachments,
            };
            const filtered = prev.filter((c) => c.id !== id);
            return sortCardsWithSettings([...filtered, merged]);
          });
          setDeletedCards((prev) => prev.filter((c) => c.id !== id));
        }
      } catch (err) {
        handleError(err);
      }
    },
    [cards, deletedCards, dtf, handleError, sortCardsWithSettings]
  );

  useEffect(() => {
    if (initOnceRef.current) return;
    initOnceRef.current = true;

    refreshActive();
    refreshTrash();
    refreshVaults();
    getSettings()
      .then((nextSettings) => {
        const normalizedActiveVaultId = nextSettings.multiply_vaults_enabled
          ? (nextSettings.active_vault_id || DEFAULT_ACTIVE_VAULT_ID)
          : DEFAULT_ACTIVE_VAULT_ID;
        setSettings({ ...nextSettings, active_vault_id: normalizedActiveVaultId });
        setActiveVaultId(normalizedActiveVaultId);
      })
      .catch(handleError);
  }, [activeVaultId, handleError, refreshActive, refreshTrash, refreshVaults]);

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
      if (id && !cardDetailsById[id]) {
        loadCard(id);
      }
    },
    [cardDetailsById, loadCard]
  );

  const createVaultAction = useCallback(
    async (name: string) => {
      try {
        const created = await createVault(name);
        const mapped = mapVaultFromBackend(created);
        setVaults((prev) => sortVaultItems([...prev, mapped]));
        return mapped;
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [handleError]
  );

  const renameVaultAction = useCallback(
    async (id: string, name: string) => {
      try {
        await renameVault(id, name);
        setVaults((prev) =>
          sortVaultItems(prev.map((vaultItem) => (vaultItem.id === id ? { ...vaultItem, name } : vaultItem)))
        );
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError]
  );

  const deleteVaultAction = useCallback(
    async (id: string) => {
      try {
        await deleteVault(id);
        setVaults((prev) => prev.filter((vaultItem) => vaultItem.id !== id));

        if (id === activeVaultId) {
          setActiveVaultId(DEFAULT_ACTIVE_VAULT_ID);
          setSettings((prev) => (prev ? { ...prev, active_vault_id: DEFAULT_ACTIVE_VAULT_ID } : prev));
        }

        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [activeVaultId, handleError]
  );

  const selectVaultAction = useCallback(
    async (vaultId: string) => {
      if (!vaultId || vaultId === activeVaultId) return true;
      try {
        await setActiveVault(vaultId);
        setActiveVaultId(vaultId);
        setSettings((prev) => (prev ? { ...prev, active_vault_id: vaultId } : prev));
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [activeVaultId, handleError]
  );

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
    [handleError, sortCardsWithSettings]
  );

  const renameFolderAction = useCallback(
    async (id: string, name: string) => {
      try {
        await renameFolder({ id, name });
        setFolders((prev) =>
          [...prev.map((folder) => (folder.id === id ? { ...folder, name } : folder))].sort(sortFolders)
        );
      } catch (err) {
        handleError(err);
      }
    },
    [handleError]
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
        setSelectedNav((prev) =>
          typeof prev === 'object' && removedSet.has(prev.folderId) ? 'all' : prev
        );
      } catch (err) {
        handleError(err);
      }
    },
    [folders, handleError]
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
        setSelectedNav((prev) =>
          typeof prev === 'object' && removedSet.has(prev.folderId) ? 'all' : prev
        );

        if (softDeleteEnabled && trashLoaded) {
          await refreshTrash();
        }
      } catch (err) {
        handleError(err);
      }
    },
    [cardDetailsById, cards, folders, handleError, refreshTrash, settings, trashLoaded]
  );

  const createCardAction = useCallback(
    async (input: CreateDataCardInput) => {
      try {
        const created = await createDataCard(mapCreateCardToBackend(input));
        const mapped = mapCardFromBackend(created);
        const summary = mapCardToSummary(mapped, dtf);

        setCards((prev) => sortCardsWithSettings([summary, ...prev]));
        setCardDetailsById((prev) => ({ ...prev, [mapped.id]: mapped }));
        // No implicit navigation/selection. User decides what to select.
        return mapped;
      } catch (err) {
        handleError(err);
        return null;
      }
    },
    [dtf, handleError, sortCardsWithSettings]
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

  const setCardHasAttachments = useCallback((cardId: string, hasAttachments: boolean) => {
    setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, hasAttachments } : card)));
    setDeletedCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, hasAttachments } : card)));
  }, []);

  const updateCardAction = useCallback(
    async (input: UpdateDataCardInput) => {
      try {
        await updateDataCard(mapUpdateCardToBackend(input));
        await loadCard(input.id);
        if (isTrashMode) await refreshTrash();
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError, isTrashMode, loadCard, refreshTrash]
  );

  const deleteCardAction = useCallback(
    async (id: string) => {
      try {
        await deleteDataCard(id);
        const softDeleteEnabled = settings?.soft_delete_enabled ?? true;
        const existingSummary =
          cards.find((card) => card.id === id) || deletedCards.find((card) => card.id === id) || null;

        const cachedSummary = existingSummary
          ? existingSummary
          : cardDetailsById[id]
            ? {
                ...mapCardToSummary(cardDetailsById[id], dtf),
                hasAttachments: false,
              }
            : null;

        setCards((prev) => prev.filter((card) => card.id !== id));
        setSelectedCardId((prev) => (prev === id ? null : prev));

        if (softDeleteEnabled) {
          const deletedAt = new Date().toISOString();
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
        await restoreDataCard(id);

        const restored = deletedCards.find((card) => card.id === id) ?? null;

        setDeletedCards((prev) => prev.filter((card) => card.id !== id));
        setCards((prev) => {
          if (!restored) return prev;
          const updated = { ...restored, deletedAt: null };
          return sortCardsWithSettings([...prev.filter((card) => card.id !== id), updated]);
        });

        // No implicit selection changes:
        // - If the restored card was selected, clear selection (it disappears from "deleted").
        // - Otherwise keep current selection as-is.
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
    [handleError]
  );

  const restoreAllTrashAction = useCallback(async () => {
    if (deletedCards.length === 0) return;
    try {
      await restoreAllDeletedDataCards();
      setDeletedCards([]);
      setCards((prev) =>
        sortCardsWithSettings([
          ...prev,
          ...deletedCards.map((card) => ({ ...card, deletedAt: null })),
        ])
      );
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
      await purgeAllDeletedDataCards();
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

  const moveCardAction = useCallback(
    async (id: string, folderId: string | null) => {
      try {
        await moveDataCardToFolder({ id, folder_id: folderId });
        setCards((prev) =>
          sortCardsWithSettings(prev.map((card) => (card.id === id ? { ...card, folderId } : card)))
        );
        setCardDetailsById((prev) =>
          prev[id] ? { ...prev, [id]: { ...prev[id], folderId } } : prev
        );
      } catch (err) {
        handleError(err);
      }
    },
    [handleError]
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
      const message = mapErrorMessage(code, (err as any)?.message ?? undefined);
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
    if (!shouldNavigate) {
      return;
    }
    setFolders([]);
    setCards([]);
    setDeletedCards([]);
    setTrashLoaded(false);
    setSelectedCardId(null);
    setSelectedNav('all');
    onLocked();
  }, [mapErrorMessage, onLocked, showToast]);

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
  }, [settings?.auto_lock_enabled, settings?.auto_lock_timeout, lock]);

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

  const toggleFavorite = useCallback(
    async (id: string) => {
      const current = cards.find((card) => card.id === id);
      if (!current) return;

      const nextFavorite = !current.isFavorite;

      try {
        await setDataCardFavorite({ id: current.id, is_favorite: nextFavorite });

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
        await setDataCardArchived({ id: current.id, is_archived: nextArchived });
        const nextArchivedAt = nextArchived ? new Date().toISOString() : null;

        setCards((prev) =>
          prev.map((card) => (card.id === current.id ? { ...card, archivedAt: nextArchivedAt } : card))
        );
        setCardDetailsById((prev) =>
          prev[current.id]
            ? { ...prev, [current.id]: { ...prev[current.id], archivedAt: nextArchivedAt } }
            : prev
        );

        // If the card no longer belongs to the current section, clear selection.
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
    },
    [cards, deletedCards]
  );

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

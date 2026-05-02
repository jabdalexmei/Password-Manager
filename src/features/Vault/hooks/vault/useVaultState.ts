import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { BackendUserSettings } from '../../types/backend';
import type { DataCard, DataCardSummary, Folder, VaultItem } from '../../types/ui';
import type { SelectedNav, VaultError, VaultFilters, VaultState } from './types';
import { DEFAULT_ACTIVE_VAULT_ID } from './types';

const INITIAL_FILTERS: VaultFilters = {
  totp: false,
  seedPhrase: false,
  recoveryEmail: false,
  phone: false,
  notes: false,
  attachments: false,
};

type UseVaultStateParams = {
  profileId: string;
};

export function useVaultState({ profileId }: UseVaultStateParams): VaultState & { initOnceRef: React.MutableRefObject<boolean> } {
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
  const [filters, setFilters] = useState<VaultFilters>(INITIAL_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<VaultError>(null);

  useEffect(() => {
    initOnceRef.current = false;
    setLoading(true);
    setSelectedNav((prev) => (typeof prev === 'object' ? 'all' : prev));
    setSelectedCardId(null);
    setTrashLoaded(false);
    setFilters(INITIAL_FILTERS);
  }, [activeVaultId, profileId]);

  useEffect(() => {
    setFolders([]);
    setCards([]);
    setCardDetailsById({});
    setDeletedCards([]);
    setSelectedNav('all');
    setSelectedCardId(null);
    setTrashLoaded(false);
    setFilters(INITIAL_FILTERS);
    setVaults([]);
    setSettings(null);
    setActiveVaultId(DEFAULT_ACTIVE_VAULT_ID);
  }, [profileId]);

  return {
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
  };
}

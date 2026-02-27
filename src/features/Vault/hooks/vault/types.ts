import type React from 'react';
import type { BackendUserSettings } from '../../types/backend';
import type { DataCard, DataCardSummary, Folder, VaultItem } from '../../types/ui';

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

export const DEFAULT_ACTIVE_VAULT_ID = 'default';

export type VaultState = {
  activeVaultId: string;
  setActiveVaultId: React.Dispatch<React.SetStateAction<string>>;
  vaults: VaultItem[];
  setVaults: React.Dispatch<React.SetStateAction<VaultItem[]>>;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  cards: DataCardSummary[];
  setCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  cardDetailsById: Record<string, DataCard>;
  setCardDetailsById: React.Dispatch<React.SetStateAction<Record<string, DataCard>>>;
  deletedCards: DataCardSummary[];
  setDeletedCards: React.Dispatch<React.SetStateAction<DataCardSummary[]>>;
  settings: BackendUserSettings | null;
  setSettings: React.Dispatch<React.SetStateAction<BackendUserSettings | null>>;
  trashLoaded: boolean;
  setTrashLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  selectedNav: SelectedNav;
  setSelectedNav: React.Dispatch<React.SetStateAction<SelectedNav>>;
  selectedCardId: string | null;
  setSelectedCardId: React.Dispatch<React.SetStateAction<string | null>>;
  filters: VaultFilters;
  setFilters: React.Dispatch<React.SetStateAction<VaultFilters>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: VaultError;
  setError: React.Dispatch<React.SetStateAction<VaultError>>;
};

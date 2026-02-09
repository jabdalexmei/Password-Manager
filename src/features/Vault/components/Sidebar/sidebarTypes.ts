import type { SelectedNav } from '../../hooks/useVault';
import type { Folder, VaultItem } from '../../types/ui';
import type { FolderDialogState } from '../Folders/useFolders';

export type VaultCategory = 'data_cards' | 'bank_cards' | 'all_items';

export type SidebarCounts = {
  all: number;
  favorites: number;
  archive: number;
  deleted: number;
  folders: Record<string, number>;
};

export type SidebarMenu =
  | { type: 'vault'; vaultId: string; x: number; y: number }
  | { type: 'folder'; folderId: string; x: number; y: number }
  | { type: 'category'; x: number; y: number }
  | null;

export type VaultSidebarProps = {
  vaults: VaultItem[];
  activeVaultId: string;
  multiplyVaultsEnabled: boolean;
  onSelectVault: (vaultId: string) => void | Promise<void>;
  onCreateVault: (name: string) => Promise<VaultItem | void | null> | VaultItem | void | null;
  onRenameVault: (id: string, name: string) => boolean | void | Promise<boolean | void>;
  onDeleteVault: (id: string) => boolean | void | Promise<boolean | void>;
  selectedCategory: VaultCategory;
  onSelectCategory: (category: VaultCategory) => void;
  onAddBankCard: () => void;
  folders: Folder[];
  counts: SidebarCounts;
  categoryCounts?: { dataCards: number; bankCards: number };
  selectedNav: SelectedNav;
  selectedFolderId: string | null;
  onSelectNav: (nav: SelectedNav) => void;
  dialogState: FolderDialogState;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void | Promise<void>;
};

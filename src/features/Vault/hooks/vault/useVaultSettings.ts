import { useCallback } from 'react';
import type React from 'react';
import {
  createVault,
  deleteVault,
  getSettings,
  renameVault,
  setActiveVault,
  setDefaultVault,
  updateSettings,
} from '../../api/vaultApi';
import { mapVaultFromBackend } from '../../types/mappers';
import type { BackendUserSettings } from '../../types/backend';
import type { VaultItem } from '../../types/ui';
import { DEFAULT_ACTIVE_VAULT_ID } from './types';
import { sortVaultItems } from './lib/sortVaultItems';

type UseVaultSettingsParams = {
  activeVaultId: string;
  setActiveVaultId: React.Dispatch<React.SetStateAction<string>>;
  setSettings: React.Dispatch<React.SetStateAction<BackendUserSettings | null>>;
  setVaults: React.Dispatch<React.SetStateAction<VaultItem[]>>;
  refreshVaults: () => Promise<void>;
  handleError: (err: unknown) => void;
};

export function useVaultSettings({
  activeVaultId,
  setActiveVaultId,
  setSettings,
  setVaults,
  refreshVaults,
  handleError,
}: UseVaultSettingsParams) {
  const updateSettingsAction = useCallback(
    async (nextSettings: BackendUserSettings) => {
      try {
        await updateSettings(nextSettings);
        const appliedSettings = await getSettings();
        const normalizedActiveVaultId = appliedSettings.active_vault_id || activeVaultId || DEFAULT_ACTIVE_VAULT_ID;

        if (normalizedActiveVaultId !== activeVaultId) {
          await setActiveVault(normalizedActiveVaultId);
          setActiveVaultId(normalizedActiveVaultId);
        }

        setSettings({ ...appliedSettings, active_vault_id: normalizedActiveVaultId });
        await refreshVaults();
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [activeVaultId, handleError, refreshVaults, setActiveVaultId, setSettings]
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
    [handleError, setVaults]
  );

  const renameVaultAction = useCallback(
    async (id: string, name: string) => {
      try {
        await renameVault(id, name);
        setVaults((prev) => sortVaultItems(prev.map((item) => (item.id === id ? { ...item, name } : item))));
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError, setVaults]
  );

  const deleteVaultAction = useCallback(
    async (id: string) => {
      try {
        await deleteVault(id);
        setVaults((prev) => prev.filter((item) => item.id !== id));
        const nextSettings = await getSettings();
        const normalizedActiveVaultId = nextSettings.active_vault_id || DEFAULT_ACTIVE_VAULT_ID;
        setActiveVaultId(normalizedActiveVaultId);
        setSettings({ ...nextSettings, active_vault_id: normalizedActiveVaultId });
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError, setActiveVaultId, setSettings, setVaults]
  );

  const setDefaultVaultAction = useCallback(
    async (id: string) => {
      try {
        await setDefaultVault(id);
        await refreshVaults();
        const nextSettings = await getSettings();
        const normalizedActiveVaultId = nextSettings.active_vault_id || DEFAULT_ACTIVE_VAULT_ID;
        setActiveVaultId(normalizedActiveVaultId);
        setSettings({ ...nextSettings, active_vault_id: normalizedActiveVaultId });
        return true;
      } catch (err) {
        handleError(err);
        return false;
      }
    },
    [handleError, refreshVaults, setActiveVaultId, setSettings]
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
    [activeVaultId, handleError, setActiveVaultId, setSettings]
  );

  return {
    updateSettingsAction,
    createVaultAction,
    renameVaultAction,
    deleteVaultAction,
    setDefaultVaultAction,
    selectVaultAction,
  };
}

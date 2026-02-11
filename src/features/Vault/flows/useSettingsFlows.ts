import { useCallback, useState } from 'react';
import { BackendUserSettings } from '../types/backend';

type UseSettingsFlowsParams = {
  onUpdateVaultSettings: (nextSettings: BackendUserSettings) => Promise<boolean>;
  onSetBankCardsSettings: (nextSettings: BackendUserSettings) => void;
  runTrashCleanupAndRefresh: (opts?: { forceRefresh?: boolean }) => Promise<void>;
};

export function useSettingsFlows({
  onUpdateVaultSettings,
  onSetBankCardsSettings,
  runTrashCleanupAndRefresh,
}: UseSettingsFlowsParams) {
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const handleOpenSettings = useCallback(() => setSettingsModalOpen(true), []);
  const handleCloseSettings = useCallback(() => setSettingsModalOpen(false), []);

  const handleSaveSettings = useCallback(
    async (nextSettings: BackendUserSettings) => {
      setIsSavingSettings(true);
      const saved = await onUpdateVaultSettings(nextSettings);
      if (saved) {
        onSetBankCardsSettings(nextSettings);
        await runTrashCleanupAndRefresh({ forceRefresh: true });
        setSettingsModalOpen(false);
      }
      setIsSavingSettings(false);
    },
    [onSetBankCardsSettings, onUpdateVaultSettings, runTrashCleanupAndRefresh]
  );

  return {
    settingsModalOpen,
    isSavingSettings,
    handleOpenSettings,
    handleCloseSettings,
    handleSaveSettings,
  };
}

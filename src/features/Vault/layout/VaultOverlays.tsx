import React, { Suspense } from 'react';
import type { ProfileMeta } from '../../../shared/lib/tauri';

const LazyExportBackupModal = React.lazy(() =>
  import('../components/modals/ExportBackupModal').then((m) => ({ default: m.ExportBackupModal }))
);
const LazyImportBackupModal = React.lazy(() =>
  import('../components/modals/ImportBackupModal').then((m) => ({ default: m.ImportBackupModal }))
);
const LazySettingsModal = React.lazy(() =>
  import('../components/modals/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const LazyDeleteFolderModal = React.lazy(() =>
  import('../components/modals/DeleteFolderModal').then((m) => ({ default: m.DeleteFolderModal }))
);

type VaultOverlaysProps = {
  profileId: string;
  profileName: string;
  isPasswordless: boolean;
  onProfileRenamed?: (name: string) => void;
  onProfileUpdated?: (profile: ProfileMeta) => void;
  pendingFolderDelete: { id: string; name: string; cardsCount: number } | null;
  closeDeleteModal: () => void;
  handleDeleteFolderOnly: () => Promise<void>;
  handleDeleteFolderAndCards: () => Promise<void>;
  backupFlows: any;
  settingsFlows: any;
  vaultSettings: any;
};

export function VaultOverlays({
  profileId,
  profileName,
  isPasswordless,
  onProfileRenamed,
  onProfileUpdated,
  pendingFolderDelete,
  closeDeleteModal,
  handleDeleteFolderOnly,
  handleDeleteFolderAndCards,
  backupFlows,
  settingsFlows,
  vaultSettings,
}: VaultOverlaysProps) {
  return (
    <>
      {pendingFolderDelete !== null && (
        <Suspense fallback={null}>
          <LazyDeleteFolderModal
            open={pendingFolderDelete !== null}
            folderName={pendingFolderDelete?.name ?? ''}
            cardsCount={pendingFolderDelete?.cardsCount ?? 0}
            onCancel={closeDeleteModal}
            onDeleteFolderOnly={handleDeleteFolderOnly}
            onDeleteFolderAndCards={handleDeleteFolderAndCards}
          />
        </Suspense>
      )}

      {backupFlows.exportModalOpen && (
        <Suspense fallback={null}>
          <LazyExportBackupModal
            open={backupFlows.exportModalOpen}
            profileId={profileId}
            onClose={() => backupFlows.setExportModalOpen(false)}
          />
        </Suspense>
      )}

      {backupFlows.pendingImportToken !== null && (
        <Suspense fallback={null}>
          <LazyImportBackupModal
            open={backupFlows.pendingImportToken !== null}
            backupPath={backupFlows.pendingImportLabel}
            isSubmitting={backupFlows.isRestoringBackup}
            onCancel={backupFlows.handleCloseImport}
            onConfirm={backupFlows.handleConfirmImport}
          />
        </Suspense>
      )}

      {settingsFlows.settingsModalOpen && (
        <Suspense fallback={null}>
          <LazySettingsModal
            open={settingsFlows.settingsModalOpen}
            settings={vaultSettings}
            isSaving={settingsFlows.isSavingSettings}
            onCancel={settingsFlows.handleCloseSettings}
            onSave={settingsFlows.handleSaveSettings}
            profileId={profileId}
            profileName={profileName}
            profileHasPassword={!isPasswordless}
            onProfileRenamed={onProfileRenamed}
            onProfileUpdated={onProfileUpdated}
          />
        </Suspense>
      )}
    </>
  );
}

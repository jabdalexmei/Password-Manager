import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../shared/lib/i18n';
import {
  backupPickFile,
  backupRestoreWorkflowFromPick,
  backupDiscardPick,
  workspaceCreateViaDialog,
  workspaceCreateDefault,
  workspaceOpenInExplorer,
  workspaceSelect,
} from '../../shared/lib/tauri';
import { useToaster } from '../../shared/components/Toaster';
import { useWorkspace } from './hooks/useWorkspace';

const LazyConfirmDialog = React.lazy(() =>
  import('../../shared/components/ConfirmDialog').then((m) => ({ default: m.default })),
);

type WorkspaceProps = {
  onWorkspaceReady: () => void;
};

type ActionsMenuState = {
  id: string;
  top: number;
  right: number;
};

const Workspace: React.FC<WorkspaceProps> = ({ onWorkspaceReady }) => {
  const { t } = useTranslation('Workspace');
  const { show: showToast } = useToaster();
  const { workspaces, loading, error, selectedId, setSelectedId, refresh, remove } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [actionsMenu, setActionsMenu] = useState<ActionsMenuState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBackupToken, setPendingBackupToken] = useState<string | null>(null);
  const [pendingProfileName, setPendingProfileName] = useState<string | null>(null);

  const closeActionsMenu = useCallback(() => setActionsMenu(null), []);

  useEffect(() => {
    if (!actionsMenu) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeActionsMenu();
    };
    const onResize = () => closeActionsMenu();
    const onAnyScroll = () => closeActionsMenu();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onAnyScroll, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onAnyScroll, true);
    };
  }, [actionsMenu, closeActionsMenu]);

  const toggleActionsMenu = useCallback((workspaceId: string, anchorEl: HTMLElement) => {
    setActionsMenu((prev) => {
      if (prev?.id === workspaceId) return null;
      const rect = anchorEl.getBoundingClientRect();
      const right = Math.max(8, window.innerWidth - rect.right);
      const top = Math.max(8, rect.bottom + 6);
      return { id: workspaceId, top, right };
    });
  }, []);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedId) ?? null,
    [selectedId, workspaces]
  );
  const actionsWorkspace = useMemo(
    () => (actionsMenu ? workspaces.find((w) => w.id === actionsMenu.id) ?? null : null),
    [actionsMenu, workspaces]
  );

  const handleSelect = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await workspaceSelect(id);
        await refresh();
        onWorkspaceReady();
      } finally {
        setBusy(false);
      }
    },
    [onWorkspaceReady, refresh]
  );

  // Create: always pick a folder and initialize it as workspace
  const handleCreate = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await workspaceCreateViaDialog();
      if (!ok) return;
      await refresh();
      onWorkspaceReady();
    } finally {
      setBusy(false);
    }
  }, [onWorkspaceReady, refresh, t]);

  // Create in default path: no picker
  const handleCreateDefault = useCallback(async () => {
    setBusy(true);
    try {
      await workspaceCreateDefault();
      await refresh();
      onWorkspaceReady();
    } finally {
      setBusy(false);
    }
  }, [onWorkspaceReady, refresh]);

  const handleRestoreFromBackup = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await workspaceCreateViaDialog();
      if (!ok) return;
      await refresh();

      const picked = await backupPickFile();
      if (!picked) return;
      setPendingBackupToken(picked.token);
      setPendingProfileName(picked.inspect.profile_name);

      if (picked.inspect.will_overwrite) {
        setConfirmOpen(true);
        return;
      }

      showToast(t('restoreInfoCreate', { name: picked.inspect.profile_name }), 'success');
      await backupRestoreWorkflowFromPick(picked.token);
      await backupDiscardPick(picked.token);
      setPendingBackupToken(null);
      setPendingProfileName(null);
      showToast(t('restoreSuccess'), 'success');
      onWorkspaceReady();
    } finally {
      setBusy(false);
    }
  }, [onWorkspaceReady, refresh, showToast, t]);

  // IMPORTANT: this button acts as:
  // - browse/select folder (always opens picker)
  // - if the picked folder equals the current active valid workspace -> open in Explorer
  const handleOpenDataFolder = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await workspaceCreateViaDialog();
      if (!ok) return;

      await refresh();
      onWorkspaceReady();
    } finally {
      setBusy(false);
    }
  }, [onWorkspaceReady, refresh]);

  const workspaceListContent = useMemo(() => {
    if (loading) return <p className="muted centered">{t('loading')}</p>;
    if (error) return <p className="muted centered">{t('error')}</p>;

    if (!workspaces.length) {
      return (
        <div className="empty empty--dashed">
          <p className="empty-text">{t('empty')}</p>
        </div>
      );
    }

    return (
      <div className="workspace-list">
        {workspaces.map((workspace) => {
          const isSelected = workspace.id === selectedId;
          const statusLabel = workspace.exists ? (workspace.valid ? null : t('invalid')) : t('missing');
          const isActionsOpen = actionsMenu?.id === workspace.id;

          return (
            <div
              key={workspace.id}
              className={`workspace-tile tile tile--selectable ${isSelected ? 'tile--selected' : ''}`}
              onClick={() => setSelectedId(workspace.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSelectedId(workspace.id);
              }}
              role="button"
              tabIndex={0}
            >
              <div className="workspace-tile-top">
                <div className="workspace-tile-info">
                  <div className="workspace-tile-title-row">
                    <p className="workspace-tile-title">{workspace.display_name}</p>
                    {statusLabel && <span className="workspace-status">{statusLabel}</span>}
                  </div>
                  <p className="workspace-tile-path">{workspace.path}</p>
                </div>

                <button
                  type="button"
                  className="btn btn-icon workspace-actionbar"
                  aria-label={t('actions')}
                  title={t('actions')}
                  aria-haspopup="menu"
                  aria-expanded={isActionsOpen}
                  aria-controls={isActionsOpen ? `workspace-actions-menu-${workspace.id}` : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleActionsMenu(workspace.id, e.currentTarget);
                  }}
                >
                  <span className="workspace-actionbar-dots">⋯</span>
                </button>
              </div>

              <div className="workspace-tile-bottom">
                <button
                  type="button"
                  className="btn btn-danger workspace-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(workspace.id);
                  }}
                  disabled={busy}
                >
                  {t('removeFromList')}
                </button>

                <button
                  type="button"
                  className="btn btn-primary workspace-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelect(workspace.id);
                  }}
                  disabled={!workspace.valid || busy}
                >
                  {t('open')}
                </button>
              </div>
            </div>
          );
        })}

        {actionsMenu && actionsWorkspace && (
          <>
            <div
              className="workspace-actionmenu-backdrop"
              onClick={(e) => {
                e.stopPropagation();
                closeActionsMenu();
              }}
            />
            <div
              id={`workspace-actions-menu-${actionsWorkspace.id}`}
              className="workspace-actionmenu-panel"
              role="menu"
              aria-label={t('actions')}
              style={{ top: actionsMenu.top, right: actionsMenu.right }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="workspace-actionmenu-item"
                role="menuitem"
                disabled={busy}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (busy) return;
                  setBusy(true);
                  try {
                    await workspaceOpenInExplorer(actionsWorkspace.id);
                  } finally {
                    setBusy(false);
                    closeActionsMenu();
                  }
                }}
              >
                {t('revealVaultInExplorer')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }, [
    actionsMenu,
    actionsWorkspace,
    busy,
    closeActionsMenu,
    error,
    handleSelect,
    loading,
    remove,
    selectedId,
    setSelectedId,
    t,
    toggleActionsMenu,
    workspaces,
  ]);

  return (
    <div className="screen-shell">
      <div className="screen-card screen-card--xl workspace-card-mock">
        <header className="workspace-header">
          <h1 className="workspace-title">{t('title')}</h1>
          <p className="workspace-subtitle">{t('subtitle')}</p>
        </header>

        {/* 2-row grid:
            row 1: left title only
            row 2: left list + right actions aligned to list top */}
        <div className="workspace-mock-layout">
          <div className="workspace-left-title">
            <h2 className="workspace-section-title">{t('workspaces')}</h2>
          </div>
          <div className="workspace-right-title-spacer" />

          <section className="workspace-left">{workspaceListContent}</section>

          <section className="workspace-right">
            <button
              type="button"
              className="btn btn-primary workspace-cta"
              onClick={handleCreate}
              disabled={busy}
            >
              {t('create')}
            </button>

            <button
              type="button"
              className="btn btn-primary workspace-cta"
              onClick={handleCreateDefault}
              disabled={busy}
            >
              {t('createDefaultPath')}
            </button>

            <button
              type="button"
              className="btn btn-primary workspace-cta"
              onClick={handleRestoreFromBackup}
              disabled={busy}
            >
              {t('restoreFromBackup')}
            </button>

            <button
              type="button"
              className="btn btn-secondary workspace-cta-secondary"
              onClick={handleOpenDataFolder}
              disabled={busy}
            >
              {t('openDataFolder')}
            </button>

            <div className="workspace-selection-hint" aria-hidden="true">
              {selectedWorkspace ? selectedWorkspace.display_name : ''}
            </div>
          </section>
        </div>
      </div>

      {confirmOpen && (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            open={confirmOpen}
            title={t('restoreConfirmTitle')}
            description={t('restoreConfirmOverwrite', { name: pendingProfileName })}
            confirmLabel={t('restoreFromBackup')}
            cancelLabel={t('cancel')}
            onCancel={() => {
              setConfirmOpen(false);
              if (pendingBackupToken) {
                void backupDiscardPick(pendingBackupToken);
              }
              setPendingBackupToken(null);
              setPendingProfileName(null);
            }}
            onConfirm={async () => {
              const token = pendingBackupToken;
              setConfirmOpen(false);
              setPendingBackupToken(null);
              setPendingProfileName(null);
              if (!token) return;
              setBusy(true);
              try {
                await backupRestoreWorkflowFromPick(token);
                await backupDiscardPick(token);
                showToast(t('restoreSuccess'), 'success');
                onWorkspaceReady();
              } finally {
                setBusy(false);
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Workspace;

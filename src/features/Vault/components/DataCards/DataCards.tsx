import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import { generatePassword, PasswordGeneratorOptions } from '../../utils/passwordGenerator';
import { DataCardsViewModel } from './useDataCards';
import {
  getVaultSortMode,
  setVaultSortMode,
  sortDataCardSummaries,
  type VaultSortMode,
} from '../../lib/vaultSort';
import {
  loadPreviewFields,
  onPreviewFieldsChanged,
  type DataCardPreviewField,
} from '../../lib/datacardPreviewFields';
import {
  loadPreviewFieldsFolderOnlyByFolder,
  onPreviewFieldsFolderOnlyByFolderChanged,
  type DataCardPreviewFieldsFolderOnlyByFolder,
} from '../../lib/datacardPreviewFieldsFolderOnlyByFolder';
import {
  loadCoreHiddenFields,
  onCoreHiddenFieldsChanged,
  type DataCardCoreField,
} from '../../lib/datacardCoreHiddenFields';
import { clipboardClearAll } from '../../../../shared/lib/tauri';
import { DataCardsHeader } from './components/DataCardsHeader';
import { DataCardContextMenu } from './components/DataCardContextMenu';
import { DataCardList } from './components/DataCardList';
import { DataCardFormDialog } from './dialogs/DataCardFormDialog';

const LazyPasswordGeneratorModal = React.lazy(async () => {
  const m = await import('../modals/PasswordGeneratorModal');
  return { default: m.PasswordGeneratorModal };
});
const LazyCustomFieldModal = React.lazy(async () => {
  const m = await import('../modals/CustomFieldModal');
  return { default: m.CustomFieldModal };
});
const LazyCustomFieldRenameModal = React.lazy(async () => {
  const m = await import('../modals/CustomFieldRenameModal');
  return { default: m.CustomFieldRenameModal };
});
const LazyAdd2FAModal = React.lazy(async () => {
  const m = await import('../modals/Add2FAModal');
  return { default: m.Add2FAModal };
});
const LazySeedPhraseModal = React.lazy(async () => {
  const m = await import('../modals/SeedPhraseModal');
  return { default: m.SeedPhraseModal };
});

export type DataCardsProps = {
  profileId: string;
  viewModel: DataCardsViewModel;
  sectionTitle: string;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
  activeFolderId?: string | null;
  /**
   * When true, the panel stretches to fill the center column height.
   * This is desired for single-panel views (Category-only), so the list can scroll
   * and the empty state can be vertically centered.
   */
  fillHeight?: boolean;
  /**
   * When DataCards is rendered as part of a combined view (e.g. global Deleted),
   * the parent can render a single actions menu and suppress the per-section one.
   */
  showTrashActions?: boolean;
  /**
   * In combined views (Navigation/Folders), the parent may want to render a single
   * global empty state instead of per-section "Empty" blocks. This flag suppresses
   * the per-section empty placeholder while keeping dialogs functional.
   */
  suppressEmptyState?: boolean;
};

export function DataCards({
  profileId,
  viewModel,
  sectionTitle,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
  activeFolderId,
  fillHeight = true,
  showTrashActions = true,
  suppressEmptyState = false,
}: DataCardsProps) {
  const { t } = useTranslation('DataCards');
  const { t: tCommon } = useTranslation('Common');
  const { show: showToast } = useToaster();
  const {
    cards: rawCards,
    selectedCardId,
    showPassword,
    isCreateOpen,
    isEditOpen,
    isCreateSubmitting,
    isEditSubmitting,
    togglePasswordVisibility,
  } = viewModel;
  const [sortMode, setSortMode] = useState<VaultSortMode>(() => getVaultSortMode('data_cards', profileId));
  const createTitleRef = useRef<HTMLInputElement | null>(null);
  const editTitleRef = useRef<HTMLInputElement | null>(null);
  const [isGeneratorOpen, setGeneratorOpen] = useState(false);
  const [generatorOptions, setGeneratorOptions] = useState<PasswordGeneratorOptions>({
    length: 16,
    lowercase: true,
    uppercase: true,
    numbers: true,
    symbols: true,
    similarSymbols: false,
  });
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [charsetSize, setCharsetSize] = useState(0);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isTrashActionsOpen, setIsTrashActionsOpen] = useState(false);
  const shouldShowTrashActions = viewModel.isTrashMode && showTrashActions;
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleteConfirmTargetId, setDeleteConfirmTargetId] = useState<string | null>(null);
  const [previewFields, setPreviewFields] = useState<DataCardPreviewField[]>([]);
  const [coreHiddenFields, setCoreHiddenFields] = useState<DataCardCoreField[]>([]);
  const [previewFieldsFolderOnlyByFolder, setPreviewFieldsFolderOnlyByFolder] =
    useState<DataCardPreviewFieldsFolderOnlyByFolder>({});
  const [isCustomFieldModalOpen, setIsCustomFieldModalOpen] = useState(false);
  const [customFieldName, setCustomFieldName] = useState('');
  const [customFieldModalError, setCustomFieldModalError] = useState<string | null>(null);
  const [customFieldTargetDialogId, setCustomFieldTargetDialogId] = useState<string | null>(null);
  const [isEditFieldsMode, setIsEditFieldsMode] = useState(false);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameTargetRowId, setRenameTargetRowId] = useState<string | null>(null);
  const [renameTargetDialogId, setRenameTargetDialogId] = useState<
    'datacard-create-dialog' | 'datacard-edit-dialog' | null
  >(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [is2faModalOpen, setIs2faModalOpen] = useState(false);
  const [twoFactorTargetDialogId, setTwoFactorTargetDialogId] = useState<
    'datacard-create-dialog' | 'datacard-edit-dialog' | null
  >(null);
  const [isSeedPhraseModalOpen, setIsSeedPhraseModalOpen] = useState(false);
  const [seedPhraseTargetDialogId, setSeedPhraseTargetDialogId] = useState<
    'datacard-create-dialog' | 'datacard-edit-dialog' | null
  >(null);
  const [isCloseCreateConfirmOpen, setIsCloseCreateConfirmOpen] = useState(false);
  const [isCloseEditConfirmOpen, setIsCloseEditConfirmOpen] = useState(false);
  const genPwdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genPwdLastCopiedRef = useRef<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setSortMode(getVaultSortMode('data_cards', profileId));
  }, [profileId]);

  useEffect(() => {
    setVaultSortMode('data_cards', profileId, sortMode);
  }, [profileId, sortMode]);

  useEffect(() => {
    let isMounted = true;
    loadPreviewFields().then((fields) => {
      if (isMounted) setPreviewFields(fields);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onPreviewFieldsChanged(setPreviewFields), []);

  useEffect(() => {
    let isMounted = true;
    loadPreviewFieldsFolderOnlyByFolder().then((fieldsByFolder) => {
      if (isMounted) setPreviewFieldsFolderOnlyByFolder(fieldsByFolder);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onPreviewFieldsFolderOnlyByFolderChanged(setPreviewFieldsFolderOnlyByFolder), []);

  useEffect(() => {
    let isMounted = true;
    loadCoreHiddenFields().then((fields) => {
      if (isMounted) setCoreHiddenFields(fields);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onCoreHiddenFieldsChanged(setCoreHiddenFields), []);

  const folderOnlyFieldsForActiveFolder = useMemo(() => {
    const folderId = activeFolderId ?? null;
    if (!folderId) return new Set<string>();
    const fields = previewFieldsFolderOnlyByFolder[folderId] ?? [];
    return new Set(fields);
  }, [activeFolderId, previewFieldsFolderOnlyByFolder]);

  const allFolderOnlyFields = useMemo(() => {
    const out = new Set<string>();
    for (const fields of Object.values(previewFieldsFolderOnlyByFolder)) {
      for (const field of fields) out.add(field);
    }
    return out;
  }, [previewFieldsFolderOnlyByFolder]);

  const folderOnlyFieldsHiddenInActiveFolder = useMemo(() => {
    const folderId = activeFolderId ?? null;
    if (!folderId) return allFolderOnlyFields;

    const out = new Set<string>();
    for (const field of allFolderOnlyFields) {
      if (folderOnlyFieldsForActiveFolder.has(field)) continue;
      out.add(field);
    }
    return out;
  }, [activeFolderId, allFolderOnlyFields, folderOnlyFieldsForActiveFolder]);

  const cards = useMemo(() => sortDataCardSummaries(rawCards, sortMode), [rawCards, sortMode]);

  const [totpNow, setTotpNow] = useState(() => Date.now());

  const regeneratePassword = useCallback((options: PasswordGeneratorOptions) => {
    const { password, charsetSize: size } = generatePassword(options);
    setGeneratedPassword(password);
    setCharsetSize(size);
  }, []);

  const closeEditModalImmediately = useCallback(() => {
    viewModel.closeEditModal();
    setIsCloseEditConfirmOpen(false);
    setIsEditFieldsMode(false);
    setIsRenameModalOpen(false);
    setRenameTargetRowId(null);
    setRenameTargetDialogId(null);
    setRenameName('');
    setRenameError(null);
  }, [viewModel]);

  const handleCloseEditModal = useCallback(() => {
    if (isEditSubmitting) return;
    if (viewModel.isEditDirty) {
      setIsCloseEditConfirmOpen(true);
      return;
    }
    closeEditModalImmediately();
  }, [closeEditModalImmediately, isEditSubmitting, viewModel.isEditDirty]);

  const closeCreateModalImmediately = useCallback(() => {
    viewModel.closeCreateModal();
    setIsCloseCreateConfirmOpen(false);
    setIsEditFieldsMode(false);
    setIsRenameModalOpen(false);
    setRenameError(null);
    setRenameTargetRowId(null);
    setRenameTargetDialogId(null);
  }, [viewModel]);

  const handleCloseCreateModal = useCallback(() => {
    if (isCreateSubmitting) return;
    if (viewModel.isCreateDirty) {
      setIsCloseCreateConfirmOpen(true);
      return;
    }
    closeCreateModalImmediately();
  }, [closeCreateModalImmediately, isCreateSubmitting, viewModel.isCreateDirty]);

  useEffect(() => {
    if (!isGeneratorOpen) return;
    regeneratePassword(generatorOptions);
  }, [generatorOptions, isGeneratorOpen, regeneratePassword]);

  const openGenerator = () => {
    setGeneratorOpen(true);
    regeneratePassword(generatorOptions);
  };

  const closeGenerator = () => {
    setGeneratorOpen(false);
  };

  const clearGenPwdTimer = useCallback(() => {
    if (genPwdTimeoutRef.current) {
      clearTimeout(genPwdTimeoutRef.current);
      genPwdTimeoutRef.current = null;
    }
    genPwdLastCopiedRef.current = null;
  }, []);

  useEffect(() => clearGenPwdTimer, [clearGenPwdTimer]);

  const handleUseGeneratedPassword = () => {
    if (generatedPassword) {
      if (viewModel.isCreateOpen) {
        viewModel.updateCreateField('password', generatedPassword);
      }
      if (viewModel.isEditOpen && viewModel.editForm) {
        viewModel.updateEditField('password', generatedPassword);
      }
      if (!showPassword) {
        togglePasswordVisibility();
      }
    }
    closeGenerator();
  };

  const handleCopyGeneratedPassword = async () => {
    const DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS = 20;
    if (!generatedPassword || !generatedPassword.trim()) return;
    clearGenPwdTimer();

    try {
      await navigator.clipboard.writeText(generatedPassword);
      showToast(t('toast.copySuccess'), 'success');

      const enabled = clipboardAutoClearEnabled ?? true;
      if (!enabled) return;

      genPwdLastCopiedRef.current = generatedPassword;
      const timeoutMs = (clipboardClearTimeoutSeconds ?? DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS) * 1000;
      genPwdTimeoutRef.current = window.setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === genPwdLastCopiedRef.current) {
            await clipboardClearAll();
          }
        } catch (err) {
          console.error(err);
          try {
            await clipboardClearAll();
          } catch (wipeErr) {
            console.error(wipeErr);
          }
        } finally {
          genPwdTimeoutRef.current = null;
          genPwdLastCopiedRef.current = null;
        }
      }, timeoutMs);
    } catch (error) {
      console.error(error);
      showToast(t('toast.copyError'), 'error');
      clearGenPwdTimer();
    }
  };

  useEffect(() => {
    if (isCreateOpen && createTitleRef.current) {
      createTitleRef.current.focus();
    }
    if (isEditOpen && editTitleRef.current) {
      editTitleRef.current.focus();
    }
  }, [isCreateOpen, isEditOpen]);

  useEffect(() => {
    const activeUri = (
      isCreateOpen ? viewModel.createForm?.totpUri : isEditOpen ? viewModel.editForm?.totpUri : null
    ) ?? '';
    if (!activeUri.trim()) return;

    const id = window.setInterval(() => setTotpNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isCreateOpen, isEditOpen, viewModel.createForm?.totpUri, viewModel.editForm?.totpUri]);

  useEffect(() => {
    if (isCreateOpen || isEditOpen) return;
    setIsActionMenuOpen(false);
    setIsCustomFieldModalOpen(false);
    setCustomFieldTargetDialogId(null);
    setIsEditFieldsMode(false);
    setIsRenameModalOpen(false);
    setRenameTargetRowId(null);
    setRenameTargetDialogId(null);
    setRenameName('');
    setRenameError(null);
    setIs2faModalOpen(false);
    setTwoFactorTargetDialogId(null);
    setIsSeedPhraseModalOpen(false);
    setSeedPhraseTargetDialogId(null);
    setIsCloseCreateConfirmOpen(false);
    setIsCloseEditConfirmOpen(false);
  }, [isCreateOpen, isEditOpen]);

  useEffect(() => {
    if (!isCreateOpen && !isEditOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isActionMenuOpen) {
          setIsActionMenuOpen(false);
          return;
        }
        if (is2faModalOpen) {
          setIs2faModalOpen(false);
          setTwoFactorTargetDialogId(null);
          return;
        }
        if (isSeedPhraseModalOpen) {
          setIsSeedPhraseModalOpen(false);
          setSeedPhraseTargetDialogId(null);
          return;
        }
        if (isCustomFieldModalOpen) {
          setIsCustomFieldModalOpen(false);
          return;
        }
        if (isRenameModalOpen) {
          setIsRenameModalOpen(false);
          setRenameError(null);
          return;
        }
        if (isCloseCreateConfirmOpen) {
          setIsCloseCreateConfirmOpen(false);
          return;
        }
        if (isCloseEditConfirmOpen) {
          setIsCloseEditConfirmOpen(false);
          return;
        }
        if (isEditOpen) handleCloseEditModal();
        if (isCreateOpen) handleCloseCreateModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleCloseCreateModal,
    handleCloseEditModal,
    isActionMenuOpen,
    is2faModalOpen,
    isSeedPhraseModalOpen,
    isCreateOpen,
    isCloseCreateConfirmOpen,
    isCloseEditConfirmOpen,
    isCustomFieldModalOpen,
    isEditOpen,
    isRenameModalOpen,
  ]);

  useEffect(() => {
    if (!isActionMenuOpen) return undefined;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideMenu = actionMenuRef.current?.contains(target);
      const isInsideButton = actionMenuButtonRef.current?.contains(target);
      if (!isInsideMenu && !isInsideButton) {
        setIsActionMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isActionMenuOpen]);

  const emptyLabel = (() => {
    const v = t('label.empty');
    return v === 'label.empty' ? tCommon('label.empty') : v;
  })();
  const defaultTwoFactorIssuer = t('twoFactor.defaults.issuer');
  const defaultTwoFactorLabel = t('twoFactor.defaults.label');

  const hasAnyOverlayOpen =
    isCreateOpen ||
    isEditOpen ||
    isGeneratorOpen ||
    isCustomFieldModalOpen ||
    isRenameModalOpen ||
    is2faModalOpen ||
    isSeedPhraseModalOpen ||
    isCloseCreateConfirmOpen ||
    isCloseEditConfirmOpen;
  const isEmpty = cards.length === 0;
  const shouldShowEmptyState = isEmpty && !viewModel.loading;

  if (suppressEmptyState && isEmpty && !hasAnyOverlayOpen) {
    return null;
  }

  return (
    <div className={`vault-panel-wrapper ${fillHeight ? 'vault-panel-wrapper--fill' : ''}`.trim()}>
      <DataCardContextMenu
        cardMenu={cardMenu}
        cards={cards}
        onClose={() => setCardMenu(null)}
        onRequestDelete={(id) => setDeleteConfirmTargetId(id)}
        viewModel={viewModel}
        t={t}
      />

      <DataCardsHeader
        sectionTitle={sectionTitle}
        sortMode={sortMode}
        setSortMode={setSortMode}
        shouldShowTrashActions={shouldShowTrashActions}
        isTrashActionsOpen={isTrashActionsOpen}
        setIsTrashActionsOpen={setIsTrashActionsOpen}
        isTrashBulkSubmitting={viewModel.isTrashBulkSubmitting}
        cardsCount={viewModel.cards.length}
        onRestoreAll={viewModel.restoreAllTrash}
        onPurgeAll={viewModel.purgeAllTrash}
        t={t}
      />

      {isEmpty ? (
        suppressEmptyState ? null : (
          shouldShowEmptyState && (
            <div className="vault-datacard-list vault-datacard-list--empty">
              <div className="vault-empty">{emptyLabel}</div>
            </div>
          )
        )
      ) : (
        <DataCardList
          cards={cards}
          selectedCardId={selectedCardId}
          viewModel={viewModel}
          setCardMenu={setCardMenu}
          folders={viewModel.folders}
          activeFolderId={activeFolderId}
          coreHiddenFields={coreHiddenFields}
          previewFields={previewFields}
          previewFieldsFolderOnlyByFolder={previewFieldsFolderOnlyByFolder}
          allFolderOnlyFields={allFolderOnlyFields}
          folderOnlyFieldsHiddenInActiveFolder={folderOnlyFieldsHiddenInActiveFolder}
          t={t}
        />
      )}

      {viewModel.isCreateOpen && (
        <DataCardFormDialog
          title={t('dialog.createTitle')}
          form={viewModel.createForm}
          error={viewModel.createError}
          folderError={viewModel.createFolderError}
          onClose={handleCloseCreateModal}
          onSubmit={viewModel.submitCreate}
          onFieldChange={viewModel.updateCreateField}
          submitLabel={t('action.create')}
          titleRef={createTitleRef}
          dialogId="datacard-create-dialog"
          isSubmitting={isCreateSubmitting}
          viewModel={viewModel}
          showPassword={showPassword}
          togglePasswordVisibility={togglePasswordVisibility}
          openGenerator={openGenerator}
          isActionMenuOpen={isActionMenuOpen}
          setIsActionMenuOpen={setIsActionMenuOpen}
          customFieldTargetDialogId={customFieldTargetDialogId}
          setCustomFieldTargetDialogId={setCustomFieldTargetDialogId}
          setCustomFieldName={setCustomFieldName}
          setCustomFieldModalError={setCustomFieldModalError}
          setIsCustomFieldModalOpen={setIsCustomFieldModalOpen}
          isEditFieldsMode={isEditFieldsMode}
          setIsEditFieldsMode={setIsEditFieldsMode}
          setRenameTargetRowId={setRenameTargetRowId}
          setRenameTargetDialogId={setRenameTargetDialogId}
          setRenameName={setRenameName}
          setRenameError={setRenameError}
          setIsRenameModalOpen={setIsRenameModalOpen}
          setIs2faModalOpen={setIs2faModalOpen}
          setTwoFactorTargetDialogId={setTwoFactorTargetDialogId}
          setIsSeedPhraseModalOpen={setIsSeedPhraseModalOpen}
          setSeedPhraseTargetDialogId={setSeedPhraseTargetDialogId}
          actionMenuRef={actionMenuRef}
          actionMenuButtonRef={actionMenuButtonRef}
          totpNow={totpNow}
          t={t}
          tCommon={tCommon}
        />
      )}

      {viewModel.isEditOpen && (
        <DataCardFormDialog
          title={t('dialog.editTitle')}
          form={viewModel.editForm}
          error={viewModel.editError}
          folderError={viewModel.editFolderError}
          onClose={handleCloseEditModal}
          onSubmit={viewModel.submitEdit}
          onFieldChange={viewModel.updateEditField}
          submitLabel={t('action.save')}
          titleRef={editTitleRef}
          dialogId="datacard-edit-dialog"
          isSubmitting={isEditSubmitting}
          viewModel={viewModel}
          showPassword={showPassword}
          togglePasswordVisibility={togglePasswordVisibility}
          openGenerator={openGenerator}
          isActionMenuOpen={isActionMenuOpen}
          setIsActionMenuOpen={setIsActionMenuOpen}
          customFieldTargetDialogId={customFieldTargetDialogId}
          setCustomFieldTargetDialogId={setCustomFieldTargetDialogId}
          setCustomFieldName={setCustomFieldName}
          setCustomFieldModalError={setCustomFieldModalError}
          setIsCustomFieldModalOpen={setIsCustomFieldModalOpen}
          isEditFieldsMode={isEditFieldsMode}
          setIsEditFieldsMode={setIsEditFieldsMode}
          setRenameTargetRowId={setRenameTargetRowId}
          setRenameTargetDialogId={setRenameTargetDialogId}
          setRenameName={setRenameName}
          setRenameError={setRenameError}
          setIsRenameModalOpen={setIsRenameModalOpen}
          setIs2faModalOpen={setIs2faModalOpen}
          setTwoFactorTargetDialogId={setTwoFactorTargetDialogId}
          setIsSeedPhraseModalOpen={setIsSeedPhraseModalOpen}
          setSeedPhraseTargetDialogId={setSeedPhraseTargetDialogId}
          actionMenuRef={actionMenuRef}
          actionMenuButtonRef={actionMenuButtonRef}
          totpNow={totpNow}
          t={t}
          tCommon={tCommon}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteConfirmTargetId)}
        title={t('dialog.delete.title')}
        description={t('dialog.delete.message')}
        confirmLabel={t('dialog.delete.confirm')}
        cancelLabel={tCommon('action.cancel')}
        onCancel={() => setDeleteConfirmTargetId(null)}
        onConfirm={() => {
          if (!deleteConfirmTargetId) return;
          void viewModel.deleteCard(deleteConfirmTargetId);
          setDeleteConfirmTargetId(null);
        }}
      />

      <ConfirmDialog
        open={isCloseCreateConfirmOpen}
        title={t('dialog.closeUnsavedCreate.title')}
        description={t('dialog.closeUnsavedCreate.description')}
        confirmLabel={t('dialog.closeUnsavedCreate.confirm')}
        cancelLabel={t('dialog.closeUnsavedCreate.cancel')}
        confirmOnLeft
        onCancel={() => setIsCloseCreateConfirmOpen(false)}
        onConfirm={closeCreateModalImmediately}
      />

      <ConfirmDialog
        open={isCloseEditConfirmOpen}
        title={t('dialog.closeUnsavedCreate.title')}
        description={t('dialog.closeUnsavedCreate.description')}
        confirmLabel={t('dialog.closeUnsavedCreate.confirm')}
        cancelLabel={t('dialog.closeUnsavedCreate.cancel')}
        confirmOnLeft
        onCancel={() => setIsCloseEditConfirmOpen(false)}
        onConfirm={closeEditModalImmediately}
      />

      {isCustomFieldModalOpen && (
        <React.Suspense fallback={null}>
          <LazyCustomFieldModal
            isOpen={isCustomFieldModalOpen}
            name={customFieldName}
            error={customFieldModalError}
            onChangeName={(value) => {
              setCustomFieldName(value);
              setCustomFieldModalError(null);
            }}
            onCancel={() => {
              setIsCustomFieldModalOpen(false);
              setCustomFieldModalError(null);
            }}
            onOk={() => {
              const result =
                customFieldTargetDialogId === 'datacard-create-dialog'
                  ? viewModel.addCreateCustomFieldByName(customFieldName)
                  : viewModel.addEditCustomFieldByName(customFieldName);

              if (result.ok === false) {
                setCustomFieldModalError(t('customFields.errorEmpty'));
                return;
              }

              setIsCustomFieldModalOpen(false);
              setCustomFieldModalError(null);
            }}
          />
        </React.Suspense>
      )}

      {isRenameModalOpen && (
        <React.Suspense fallback={null}>
          <LazyCustomFieldRenameModal
            isOpen={isRenameModalOpen}
            name={renameName}
            error={renameError}
            onChangeName={(value) => {
              setRenameName(value);
              setRenameError(null);
            }}
            onCancel={() => {
              setIsRenameModalOpen(false);
              setRenameError(null);
            }}
            onOk={() => {
              if (!renameTargetRowId || !renameTargetDialogId) {
                setIsRenameModalOpen(false);
                setRenameError(null);
                return;
              }

              const result =
                renameTargetDialogId === 'datacard-create-dialog'
                  ? viewModel.renameCreateCustomFieldById(renameTargetRowId, renameName)
                  : viewModel.renameEditCustomFieldById(renameTargetRowId, renameName);
              if (result.ok === false) {
                setRenameError(t('customFields.errorEmpty'));
                return;
              }

              setIsRenameModalOpen(false);
              setRenameError(null);
              setRenameTargetRowId(null);
              setRenameTargetDialogId(null);
            }}
          />
        </React.Suspense>
      )}

      {isGeneratorOpen && (
        <React.Suspense fallback={null}>
          <LazyPasswordGeneratorModal
            isOpen={isGeneratorOpen}
            generatedPassword={generatedPassword}
            charsetSize={charsetSize}
            options={generatorOptions}
            onChangeOptions={setGeneratorOptions}
            onClose={closeGenerator}
            onUse={handleUseGeneratedPassword}
            onRegenerate={() => regeneratePassword(generatorOptions)}
            onCopy={handleCopyGeneratedPassword}
          />
        </React.Suspense>
      )}

      {is2faModalOpen && (
        <React.Suspense fallback={null}>
          <LazyAdd2FAModal
            isOpen={is2faModalOpen}
            existingUri={
              twoFactorTargetDialogId === 'datacard-create-dialog'
                ? (viewModel.createForm.totpUri.trim() ? viewModel.createForm.totpUri : null)
                : (viewModel.editForm?.totpUri?.trim() ? viewModel.editForm.totpUri : null)
            }
            defaults={{
              issuer:
                twoFactorTargetDialogId === 'datacard-create-dialog'
                  ? ((viewModel.createForm.title ?? defaultTwoFactorIssuer).trim() || defaultTwoFactorIssuer)
                  : ((viewModel.editForm?.title ?? defaultTwoFactorIssuer).trim() || defaultTwoFactorIssuer),
              label:
                twoFactorTargetDialogId === 'datacard-create-dialog'
                  ? ((viewModel.createForm.title ?? defaultTwoFactorLabel).trim() || defaultTwoFactorLabel)
                  : ((viewModel.editForm?.title ?? defaultTwoFactorLabel).trim() || defaultTwoFactorLabel),
            }}
            onCancel={() => {
              setIs2faModalOpen(false);
              setTwoFactorTargetDialogId(null);
            }}
            onSave={(uri) => {
              if (twoFactorTargetDialogId === 'datacard-create-dialog') {
                viewModel.updateCreateField('totpUri', uri);
              } else {
                viewModel.updateEditField('totpUri', uri);
              }
              setIs2faModalOpen(false);
              setTwoFactorTargetDialogId(null);
            }}
            onRemove={() => {
              if (twoFactorTargetDialogId === 'datacard-create-dialog') {
                viewModel.updateCreateField('totpUri', '');
              } else {
                viewModel.updateEditField('totpUri', '');
              }
              setIs2faModalOpen(false);
              setTwoFactorTargetDialogId(null);
            }}
          />
        </React.Suspense>
      )}

      {isSeedPhraseModalOpen && (
        <React.Suspense fallback={null}>
          <LazySeedPhraseModal
            isOpen={isSeedPhraseModalOpen}
            existingPhrase={
              seedPhraseTargetDialogId === 'datacard-create-dialog'
                ? (viewModel.createForm.seedPhrase.trim() ? viewModel.createForm.seedPhrase : null)
                : (viewModel.editForm?.seedPhrase?.trim() ? viewModel.editForm.seedPhrase : null)
            }
            onCancel={() => {
              setIsSeedPhraseModalOpen(false);
              setSeedPhraseTargetDialogId(null);
            }}
            onSave={(words, wordCount) => {
              const phrase = words.join(' ').trim();
              if (seedPhraseTargetDialogId === 'datacard-create-dialog') {
                viewModel.setCreateSeedPhrase(phrase, wordCount);
              } else {
                viewModel.setEditSeedPhrase(phrase, wordCount);
              }
              setIsSeedPhraseModalOpen(false);
              setSeedPhraseTargetDialogId(null);
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
}

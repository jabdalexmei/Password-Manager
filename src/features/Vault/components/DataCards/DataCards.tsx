import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import {
  IconAttachment,
  IconPreview,
  IconPreviewOff,
  IconRename,
  IconRegenerate,
  IconTrash,
  IconMoreHorizontal,
} from '@/shared/icons/lucide/icons';
import { useToaster } from '../../../../shared/components/Toaster';
import { generatePassword, PasswordGeneratorOptions } from '../../utils/passwordGenerator';
import { generateTotpCode } from '../../utils/totp';
import { DataCardFormState, DataCardsViewModel } from './useDataCards';
import { FolderSelect } from '../shared/FolderSelect';
import { VaultSortControl } from '../shared/VaultSortControl';
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
  loadCoreHiddenFields,
  onCoreHiddenFieldsChanged,
  type DataCardCoreField,
} from '../../lib/datacardCoreHiddenFields';
import { clipboardClearAll } from '../../../../shared/lib/tauri';
import { getDataCard } from '../../api/vaultApi';
import { mapCardFromBackend } from '../../types/mappers';

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
    excludeSimilar: false,
  });
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [charsetSize, setCharsetSize] = useState(0);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isTrashActionsOpen, setIsTrashActionsOpen] = useState(false);
  const shouldShowTrashActions = viewModel.isTrashMode && showTrashActions;
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [previewFields, setPreviewFields] = useState<DataCardPreviewField[]>([]);
  const [coreHiddenFields, setCoreHiddenFields] = useState<DataCardCoreField[]>([]);
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
    loadCoreHiddenFields().then((fields) => {
      if (isMounted) setCoreHiddenFields(fields);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onCoreHiddenFieldsChanged(setCoreHiddenFields), []);

  const cards = useMemo(() => sortDataCardSummaries(rawCards, sortMode), [rawCards, sortMode]);

  const [totpNow, setTotpNow] = useState(() => Date.now());

  const regeneratePassword = useCallback((options: PasswordGeneratorOptions) => {
    const { password, charsetSize: size } = generatePassword(options);
    setGeneratedPassword(password);
    setCharsetSize(size);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    viewModel.closeEditModal();
    setIsEditFieldsMode(false);
    setIsRenameModalOpen(false);
    setRenameTargetRowId(null);
    setRenameTargetDialogId(null);
    setRenameName('');
    setRenameError(null);
  }, [viewModel]);

  const handleCloseCreateModal = useCallback(() => {
    viewModel.closeCreateModal();
    setIsEditFieldsMode(false);
    setIsRenameModalOpen(false);
    setRenameError(null);
    setRenameTargetRowId(null);
    setRenameTargetDialogId(null);
  }, [viewModel]);

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

  const renderDialog = (
    title: string,
    form: DataCardFormState | null,
    error: string | null,
    folderError: string | null,
    onClose: () => void,
    onSubmit: () => Promise<void>,
    onFieldChange: (field: keyof DataCardFormState, value: string | boolean | null) => void,
    submitLabel: string,
    titleRef: React.RefObject<HTMLInputElement>,
    dialogId: string,
    isSubmitting: boolean
  ) => {
    if (!form) return null;

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      await onSubmit();
    };

    const handleAddAttachments = async () => {
      await viewModel.pickCreateAttachments();
    };

    const titleElementId = 'dialog-title';
    const isCreateDialog = dialogId === 'datacard-create-dialog';
    const seedPhraseWordCount = form.seedPhraseWordCount;
    const visibleCustomFields = form.customFields;

    const totpUri = (form.totpUri ?? '').trim();
    let totpData: { token: string; remaining: number } | null = null;
    if (totpUri) {
      try {
        totpData = generateTotpCode(totpUri, totpNow);
      } catch {
        totpData = null;
      }
    }

    return (
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleElementId}>
          <button
            type="button"
            className="dialog-close dialog-close--topright"
            aria-label={tCommon('action.close')}
            onClick={onClose}
          >
            {'\u00D7'}
          </button>
          <div className="dialog-header">
            <h2 id={titleElementId} className="dialog-title">
              {title}
            </h2>
          </div>

          <form className="dialog-body" onSubmit={handleSubmit} autoComplete="off">
            <div className="dialog-body-actions">
              <div className="dialog-header-actions">
              <button
                type="button"
                className="btn btn-icon dialog-actionbar"
                aria-label={t('action.more')}
                title={t('action.more')}
                onClick={() => {
                  const isSameDialog = customFieldTargetDialogId === dialogId;
                  setCustomFieldTargetDialogId(dialogId);
                  setIsActionMenuOpen((prev) => (isSameDialog ? !prev : true));
                }}
                ref={actionMenuButtonRef}
              >
                <span className="dialog-actionbar-dots">⋯</span>
              </button>

              {isActionMenuOpen && customFieldTargetDialogId === dialogId && (
                <div className="dialog-actionmenu" role="menu" ref={actionMenuRef}>
                  <button
                    type="button"
                    className="dialog-actionmenu-item"
                    onClick={() => {
                      setIsActionMenuOpen(false);
                      setCustomFieldTargetDialogId(dialogId);
                      setCustomFieldName('');
                      setCustomFieldModalError(null);
                      setIsCustomFieldModalOpen(true);
                    }}
                  >
                    {t('customFields.add')}
                  </button>
                  <button
                    type="button"
                    className="dialog-actionmenu-item"
                    onClick={() => {
                      setIsActionMenuOpen(false);
                      setTwoFactorTargetDialogId(
                        dialogId === 'datacard-create-dialog' ? 'datacard-create-dialog' : 'datacard-edit-dialog'
                      );
                      setIs2faModalOpen(true);
                    }}
                  >
                    {form.totpUri?.trim() ? t('twoFactor.editAction') : t('twoFactor.addAction')}
                  </button>
                  <button
                    type="button"
                    className="dialog-actionmenu-item"
                    onClick={() => {
                      setIsActionMenuOpen(false);
                      setSeedPhraseTargetDialogId(
                        dialogId === 'datacard-create-dialog' ? 'datacard-create-dialog' : 'datacard-edit-dialog'
                      );
                      setIsSeedPhraseModalOpen(true);
                    }}
                  >
                    {seedPhraseWordCount > 0 ? t('seedPhrase.editAction') : t('seedPhrase.addAction')}
                  </button>
                  {visibleCustomFields.length > 0 && (
                    <button
                      type="button"
                      className="dialog-actionmenu-item"
                      onClick={() => {
                        setIsActionMenuOpen(false);
                        setIsEditFieldsMode((prev) => !prev);
                      }}
                    >
                      {t('customFields.editFields')}
                    </button>
                  )}
                </div>
              )}
            </div>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-title`}>
                {t('label.title')}
              </label>
              <input
                id={`${dialogId}-title`}
                className="input"
                autoComplete="off"
                ref={titleRef}
                value={form.title}
                onChange={(e) => onFieldChange('title', e.target.value)}
              />
              {error && <div className="form-error">{error}</div>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-url`}>
                {t('label.url')}
              </label>
              <input
                id={`${dialogId}-url`}
                className="input"
                type="text"
                autoComplete="off"
                value={form.url}
                onChange={(e) => onFieldChange('url', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-email`}>
                {t('label.email')}
              </label>
              <input
                id={`${dialogId}-email`}
                className="input"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => onFieldChange('email', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-recovery-email`}>
                {t('label.recoveryEmail')}
              </label>
              <input
                id={`${dialogId}-recovery-email`}
                className="input"
                type="email"
                autoComplete="off"
                value={form.recoveryEmail}
                onChange={(e) => onFieldChange('recoveryEmail', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-username`}>
                {t('label.username')}
              </label>
              <input
                id={`${dialogId}-username`}
                className="input"
                autoComplete="off"
                value={form.username}
                onChange={(e) => onFieldChange('username', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-mobile`}>
                {t('label.mobile')}
              </label>
              <input
                id={`${dialogId}-mobile`}
                className="input"
                autoComplete="off"
                value={form.mobilePhone}
                onChange={(e) => onFieldChange('mobilePhone', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-password`}>
                {t('label.password')}
              </label>
              <div className="input-with-actions">
                <input
                  id={`${dialogId}-password`}
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => onFieldChange('password', e.target.value)}
                />
                <div className="input-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={togglePasswordVisibility}
                    aria-label={t('action.togglePasswordVisibility')}
                  >
                    {showPassword ? <IconPreviewOff /> : <IconPreview />}
                  </button>

                  <button
                    className="icon-button icon-button-primary"
                    type="button"
                    onClick={openGenerator}
                    aria-label={t('action.openGenerator')}
                  >
                    <IconRegenerate />
                  </button>
                </div>
              </div>
            </div>

            {totpUri && (
              <div className="form-field">
                <label className="form-label">{t('label.totp')}</label>

                <div className="detail-value-box">
                  <div className="detail-value-text" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>
                      {totpData ? totpData.token : t('totp.invalid')}
                    </span>

                    {totpData && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {t('totp.expiresIn', { seconds: totpData.remaining })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {seedPhraseWordCount > 0 && (
              <div className="form-field">
                <label className="form-label">{t('seedPhrase.title')}</label>
                <div
                  className="seedphrase-summary"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSeedPhraseTargetDialogId(dialogId as 'datacard-create-dialog' | 'datacard-edit-dialog');
                    setIsSeedPhraseModalOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSeedPhraseTargetDialogId(dialogId as 'datacard-create-dialog' | 'datacard-edit-dialog');
                      setIsSeedPhraseModalOpen(true);
                    }
                  }}
                >
                  <span className="seedphrase-summary-count">
                    {t('seedPhrase.wordsCount', { count: seedPhraseWordCount })}
                  </span>
                  <span className="muted">{t('seedPhrase.editAction')}</span>
                </div>
              </div>
            )}

            {visibleCustomFields.map((row) => (
              <div className="form-field" key={row.id}>
                <label className="form-label" htmlFor={`${dialogId}-cf-${row.id}`}>
                  {row.key}
                </label>
                <div className="input-with-actions">
                  <input
                    id={`${dialogId}-cf-${row.id}`}
                    className="input"
                    autoComplete="off"
                    value={row.value}
                    onChange={(e) => {
                      if (dialogId === 'datacard-create-dialog') {
                        viewModel.updateCreateCustomFieldValue(row.id, e.target.value);
                      } else {
                        viewModel.updateEditCustomFieldValue(row.id, e.target.value);
                      }
                    }}
                  />
                  {isEditFieldsMode && (
                    <div className="input-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t('customFields.rename')}
                        title={t('customFields.rename')}
                        onClick={() => {
                          setRenameTargetRowId(row.id);
                          setRenameTargetDialogId(
                            dialogId === 'datacard-create-dialog'
                              ? 'datacard-create-dialog'
                              : 'datacard-edit-dialog'
                          );
                          setRenameName(row.key);
                          setRenameError(null);
                          setIsRenameModalOpen(true);
                        }}
                      >
                        <IconRename />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button-danger"
                        aria-label={t('customFields.delete')}
                        title={t('customFields.delete')}
                        onClick={() => {
                          if (dialogId === 'datacard-create-dialog') {
                            viewModel.removeCreateCustomFieldById(row.id);
                          } else {
                            viewModel.removeEditCustomFieldById(row.id);
                          }
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-note`}>
                {t('label.note')}
              </label>
              <textarea
                id={`${dialogId}-note`}
                className="textarea"
                autoComplete="off"
                value={form.note}
                onChange={(e) => onFieldChange('note', e.target.value)}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-folder`}>
                {t('label.folder')}
              </label>
              <FolderSelect
                id={`${dialogId}-folder`}
                value={form.folderId ?? null}
                noneLabel={t('label.noFolder')}
                options={viewModel.folders
                  .filter((folder) => !folder.isSystem && !folder.deletedAt)
                  .map((folder) => ({ id: folder.id, name: folder.name }))}
                onChange={(folderId) => onFieldChange('folderId', folderId)}
              />
              {folderError && <div className="form-error">{folderError}</div>}
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor={`${dialogId}-tags`}>
                {t('label.tags')}
              </label>
              <input
                id={`${dialogId}-tags`}
                className="input"
                autoComplete="off"
                value={form.tagsText}
                placeholder={t('label.tagsPlaceholder')}
                onChange={(e) => onFieldChange('tagsText', e.target.value)}
              />
            </div>

            {isCreateDialog && (
              <div className="dialog-attachments">
                <div className="dialog-attachments-header">
                  <button className="btn btn-secondary btn-attach" type="button" onClick={handleAddAttachments}>
                    <IconAttachment />
                    {t('attachments.add')}
                  </button>
                </div>

                {viewModel.createAttachments.length > 0 && (
                  <div className="dialog-attachments-list">
                    <div className="muted">{t('attachments.selected')}</div>
                    {viewModel.createAttachments.map((attachment) => (
                      <div key={attachment.id} className="dialog-attachments-item">
                        <span className="dialog-attachments-name">{attachment.name}</span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => viewModel.removeCreateAttachment(attachment.id)}
                        >
                          {t('attachments.remove')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              className={`dialog-footer dialog-footer--split${isCreateDialog ? ' dialog-footer--equal-buttons' : ''}`}
            >
              <div className="dialog-footer-left">
                <button className="btn btn-secondary" type="button" onClick={onClose}>
                  {tCommon('action.cancel')}
                </button>
              </div>

              <div className="dialog-footer-right">
                <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                  {submitLabel}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const emptyLabel = (() => {
    const v = t('label.empty');
    return v === 'label.empty' ? tCommon('label.empty') : v;
  })();

  const hasAnyOverlayOpen =
    isCreateOpen ||
    isEditOpen ||
    isGeneratorOpen ||
    isCustomFieldModalOpen ||
    isRenameModalOpen ||
    is2faModalOpen ||
    isSeedPhraseModalOpen;

  if (suppressEmptyState && cards.length === 0 && !hasAnyOverlayOpen) {
    return null;
  }

  return (
    <div className={`vault-panel-wrapper ${fillHeight ? 'vault-panel-wrapper--fill' : ''}`.trim()}>
      {cardMenu && !viewModel.isTrashMode && (
        <>
          <div
            className="vault-actionmenu-backdrop"
            onClick={() => setCardMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCardMenu(null);
            }}
          />
          <div
            className="vault-actionmenu-panel vault-contextmenu-panel"
            role="menu"
            style={
              {
                '--menu-x': `${cardMenu.x}px`,
                '--menu-y': `${cardMenu.y}px`,
              } as React.CSSProperties
            }
          >
            {(() => {
              const target = cards.find((c) => c.id === cardMenu.id) ?? null;
              const isArchived = Boolean(target?.archivedAt);
              const isFavorite = Boolean(target?.isFavorite);

              return (
                <>
                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      const id = cardMenu.id;
                      setCardMenu(null);
                      try {
                        const backend = await getDataCard(id);
                        const mapped = mapCardFromBackend(backend);
                        viewModel.openEditModal(mapped);
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                  >
                    {t('action.edit')}
                  </button>

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      const id = cardMenu.id;
                      setCardMenu(null);
                      await viewModel.toggleFavorite(id);
                    }}
                  >
                    {isFavorite ? t('action.unmarkFavorite') : t('action.markFavorite')}
                  </button>

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      const id = cardMenu.id;
                      setCardMenu(null);
                      await viewModel.toggleArchive(id);
                    }}
                  >
                    {isArchived ? t('action.unarchive') : t('action.archive')}
                  </button>

                  <button
                    className="vault-actionmenu-item vault-actionmenu-danger"
                    type="button"
                    onClick={async () => {
                      const id = cardMenu.id;
                      setCardMenu(null);
                      await viewModel.deleteCard(id);
                    }}
                  >
                    {t('action.delete')}
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}
      <div className="datacards-header">
        <div className="vault-section-header">{sectionTitle}</div>

        <div className="datacards-header__right">
          <VaultSortControl value={sortMode} onChange={setSortMode} disabled={cards.length < 2} />

          {shouldShowTrashActions ? (
            <div className="datacards-actions">
              <button
                className="btn btn-icon vault-actionbar"
                type="button"
                aria-label={t('trash.actions')}
                aria-haspopup="menu"
                aria-expanded={isTrashActionsOpen}
                onClick={() => setIsTrashActionsOpen((prev) => !prev)}
              >
                <IconMoreHorizontal className="vault-actionbar-icon" size={18} />
              </button>

              {isTrashActionsOpen && (
                <>
                  <div
                    className="vault-actionmenu-backdrop"
                    onClick={() => setIsTrashActionsOpen(false)}
                  />
                  <div className="vault-actionmenu-panel" role="menu">
                    <button
                      className="vault-actionmenu-item"
                      type="button"
                      disabled={viewModel.isTrashBulkSubmitting || viewModel.cards.length === 0}
                      onClick={async () => {
                        setIsTrashActionsOpen(false);
                        await viewModel.restoreAllTrash();
                      }}
                    >
                      {t('trash.restoreAll')}
                    </button>

                    <button
                      className="vault-actionmenu-item vault-actionmenu-danger"
                      type="button"
                      disabled={viewModel.isTrashBulkSubmitting || viewModel.cards.length === 0}
                      onClick={async () => {
                        setIsTrashActionsOpen(false);
                        await viewModel.purgeAllTrash();
                      }}
                    >
                      {t('trash.removeAll')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {cards.length === 0 ? (
        suppressEmptyState ? null : (
          <div className="vault-datacard-list vault-datacard-list--empty">
            <div className="vault-empty">{emptyLabel}</div>
          </div>
        )
      ) : (
        <div className="vault-datacard-list">
          {cards.map((card) => {
            const isActive = selectedCardId === card.id;
            const isFavorite = card.isFavorite;
            const titleText = (card.title ?? '').trim();
            const urlText = (card.url ?? '').trim();
            const emailText = (card.email ?? '').trim();

            const isTitleVisible = !coreHiddenFields.includes('title');
            const isUrlVisible = !coreHiddenFields.includes('url');
            const isEmailVisible = !coreHiddenFields.includes('email');

            const formatMetaLine = (label: string, value: string) => `${label}: ${value}`;

            const coreEntries: Array<{ field: 'title' | 'url' | 'email'; value: string }> = [];
            if (isTitleVisible && titleText.length > 0) coreEntries.push({ field: 'title', value: titleText });
            if (isUrlVisible && urlText.length > 0) coreEntries.push({ field: 'url', value: urlText });
            if (isEmailVisible && emailText.length > 0) coreEntries.push({ field: 'email', value: emailText });

            const isUntitledPlaceholder = coreEntries.length === 0;
            const displayTitleText = isUntitledPlaceholder ? t('label.untitled') : coreEntries[0].value;
            const metaCoreLines = coreEntries.slice(1, 3).map((entry) => {
              switch (entry.field) {
                case 'url':
                  return formatMetaLine(t('label.url'), entry.value);
                case 'email':
                  return formatMetaLine(t('label.email'), entry.value);
                default:
                  return entry.value;
              }
            });

            const getExtraLine = (field: DataCardPreviewField): string | null => {
              switch (field) {
                case 'username': {
                  const v = (card.username ?? '').trim();
                  return v.length > 0 ? formatMetaLine(t('label.username'), v) : null;
                }
                case 'recovery_email': {
                  const v = (card.recoveryEmail ?? '').trim();
                  return v.length > 0 ? formatMetaLine(t('label.recoveryEmail'), v) : null;
                }
                case 'mobile_phone': {
                  const v = (card.mobilePhone ?? '').trim();
                  return v.length > 0 ? formatMetaLine(t('label.mobile'), v) : null;
                }
                case 'note': {
                  const v = (card.note ?? '').split(/\r?\n/)[0]?.trim() ?? '';
                  return v.length > 0 ? formatMetaLine(t('label.note'), v) : null;
                }
                case 'folder': {
                  if (!card.folderId) return null;
                  const v = (viewModel.folders.find((f) => f.id === card.folderId)?.name ?? '').trim();
                  return v.length > 0 ? formatMetaLine(t('label.folder'), v) : null;
                }
                case 'tags': {
                  const v = Array.isArray(card.tags) ? card.tags.join(', ').trim() : '';
                  return v.length > 0 ? formatMetaLine(t('label.tags'), v) : null;
                }
                default:
                  return null;
              }
            };

            const isAllowedPreviewField = (value: string): value is DataCardPreviewField =>
              value === 'username' ||
              value === 'recovery_email' ||
              value === 'mobile_phone' ||
              value === 'note' ||
              value === 'folder' ||
              value === 'tags';

            const mergedPreviewFields: DataCardPreviewField[] = [];
            const perCardRaw = Array.isArray(card.previewFields) ? card.previewFields : [];

            const CUSTOM_PREVIEW_PREFIX = 'custom:' as const;
            const isCustomPreviewField = (
              value: string,
            ): value is `${typeof CUSTOM_PREVIEW_PREFIX}${string}` =>
              value.startsWith(CUSTOM_PREVIEW_PREFIX) && value.length > CUSTOM_PREVIEW_PREFIX.length;

            // Built-in per-card preview fields (can also be enabled globally)
            for (const item of perCardRaw) {
              if (!isAllowedPreviewField(item)) continue;
              if (mergedPreviewFields.includes(item)) continue;
              mergedPreviewFields.push(item);
            }
            for (const item of previewFields) {
              if (mergedPreviewFields.includes(item)) continue;
              mergedPreviewFields.push(item);
            }
            const previewFieldOrder: DataCardPreviewField[] = [
              'recovery_email',
              'username',
              'mobile_phone',
              'note',
              'folder',
              'tags',
            ];

            // Custom preview fields are per-card only (no global "all" toggle)
            const perCardCustomKeys = new Set(
              perCardRaw
                .filter(isCustomPreviewField)
                .map((token) => token.slice(CUSTOM_PREVIEW_PREFIX.length))
                .filter((key) => key.trim().length > 0),
            );

            const customLines: string[] = [];
            for (const customField of Array.isArray(card.customFields) ? card.customFields : []) {
              const key = (customField.key ?? '').trim();
              if (!key) continue;
              if (!perCardCustomKeys.has(key)) continue;
              const value = (customField.value ?? '').split(/\r?\n/)[0]?.trim() ?? '';
              if (!value) continue;
              customLines.push(`${key}:${value}`);
            }

            // Keep preview lines aligned with Create/Edit + Information ordering.
            // Custom fields are placed right after Mobile phone (Password is intentionally not shown in preview).
            const metaLines: string[] = [...metaCoreLines];
            let didInsertCustom = false;
            for (const field of previewFieldOrder) {
              if (field === 'mobile_phone') {
                if (mergedPreviewFields.includes(field)) {
                  const line = getExtraLine(field);
                  if (line) metaLines.push(line);
                }
                if (customLines.length > 0) metaLines.push(...customLines);
                didInsertCustom = true;
                continue;
              }

              if (!mergedPreviewFields.includes(field)) continue;
              const line = getExtraLine(field);
              if (line) metaLines.push(line);
            }

            // Safety: if the canonical insertion point ever disappears, keep custom fields visible.
            if (!didInsertCustom && customLines.length > 0) {
              metaLines.push(...customLines);
            }

              return (
                <button
                  key={card.id}
                  className={`vault-datacard ${isActive ? 'active' : ''}`}
                  type="button"
                  onClick={() => viewModel.selectCard(card.id)}
                  onContextMenu={(e) => {
                    if (viewModel.isTrashMode) return;
                    e.preventDefault();
                    viewModel.selectCard(card.id);
                    setCardMenu({ id: card.id, x: e.clientX, y: e.clientY });
                  }}
                >
                <div className="datacard-top">
                  <div className="datacard-title">{displayTitleText}</div>
                  {(card.hasTotp || isFavorite) && (
                    <div className="datacard-badges">
                      {isFavorite && <span className="pill datacard-favorite">{t('label.favorite')}</span>}
                      {card.hasTotp && <span className="pill">{t('twoFactor.pill')}</span>}
                    </div>
                  )}
                </div>

                {metaLines.length > 0 && (
                  <div className="datacard-meta-lines">
                    {metaLines.map((line, idx) => (
                      <div key={`${card.id}-meta-${idx}`} className="datacard-meta">
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {viewModel.isCreateOpen &&
        renderDialog(
          t('dialog.createTitle'),
          viewModel.createForm,
          viewModel.createError,
          viewModel.createFolderError,
          handleCloseCreateModal,
          viewModel.submitCreate,
          viewModel.updateCreateField,
          t('action.create'),
          createTitleRef,
          'datacard-create-dialog',
          isCreateSubmitting
        )}

      {viewModel.isEditOpen &&
        renderDialog(
          t('dialog.editTitle'),
          viewModel.editForm,
          viewModel.editError,
          viewModel.editFolderError,
          handleCloseEditModal,
          viewModel.submitEdit,
          viewModel.updateEditField,
          t('action.save'),
          editTitleRef,
          'datacard-edit-dialog',
          isEditSubmitting
        )}

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
                setCustomFieldModalError(
                  result.reason === 'EMPTY' ? t('customFields.errorEmpty') : t('customFields.errorDuplicate')
                );
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
                setRenameError(
                  result.reason === 'EMPTY' ? t('customFields.errorEmpty') : t('customFields.errorDuplicate')
                );
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
                  ? ((viewModel.createForm.title ?? 'Vault').trim() || 'Vault')
                  : ((viewModel.editForm?.title ?? 'Vault').trim() || 'Vault'),
              label:
                twoFactorTargetDialogId === 'datacard-create-dialog'
                  ? ((viewModel.createForm.title ?? 'Account').trim() || 'Account')
                  : ((viewModel.editForm?.title ?? 'Account').trim() || 'Account'),
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

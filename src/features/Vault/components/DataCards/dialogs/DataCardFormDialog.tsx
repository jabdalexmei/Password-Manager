import React from 'react';
import {
  IconAttachment,
  IconGripVertical,
  IconPreview,
  IconPreviewOff,
  IconRegenerate,
  IconRename,
  IconTrash,
} from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import { FolderSelect } from '../../shared/FolderSelect';
import { generateTotpCode } from '../../../utils/totp';
import type { DataCardFormState, DataCardsViewModel } from '../useDataCards';
import { DataCardDialogActionMenu } from './DataCardDialogActionMenu';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
type CustomFieldDragPlacement = 'before' | 'after';
type CustomFieldDragState = {
  activeRowId: string | null;
  overRowId: string | null;
  placement: CustomFieldDragPlacement | null;
};

export type DataCardDialogId = 'datacard-create-dialog' | 'datacard-edit-dialog';

type DataCardFormDialogProps = {
  title: string;
  form: DataCardFormState | null;
  error: string | null;
  folderError: string | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  onFieldChange: (field: keyof DataCardFormState, value: string | boolean | null) => void;
  submitLabel: string;
  titleRef: React.RefObject<HTMLInputElement>;
  dialogId: DataCardDialogId;
  isSubmitting: boolean;
  viewModel: DataCardsViewModel;
  showPassword: boolean;
  togglePasswordVisibility: () => void;
  openGenerator: () => void;
  isActionMenuOpen: boolean;
  setIsActionMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  customFieldTargetDialogId: string | null;
  setCustomFieldTargetDialogId: React.Dispatch<React.SetStateAction<string | null>>;
  setCustomFieldName: React.Dispatch<React.SetStateAction<string>>;
  setCustomFieldModalError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsCustomFieldModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isEditFieldsMode: boolean;
  setIsEditFieldsMode: React.Dispatch<React.SetStateAction<boolean>>;
  setRenameTargetRowId: React.Dispatch<React.SetStateAction<string | null>>;
  setRenameTargetDialogId: React.Dispatch<React.SetStateAction<DataCardDialogId | null>>;
  setRenameName: React.Dispatch<React.SetStateAction<string>>;
  setRenameError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsRenameModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIs2faModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTwoFactorTargetDialogId: React.Dispatch<React.SetStateAction<DataCardDialogId | null>>;
  setIsSeedPhraseModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSeedPhraseTargetDialogId: React.Dispatch<React.SetStateAction<DataCardDialogId | null>>;
  actionMenuRef: React.RefObject<HTMLDivElement>;
  actionMenuButtonRef: React.RefObject<HTMLButtonElement>;
  totpNow: number;
  t: TranslateFn;
  tCommon: TranslateFn;
};

export function DataCardFormDialog({
  title,
  form,
  error,
  folderError,
  onClose,
  onSubmit,
  onFieldChange,
  submitLabel,
  titleRef,
  dialogId,
  isSubmitting,
  viewModel,
  showPassword,
  togglePasswordVisibility,
  openGenerator,
  isActionMenuOpen,
  setIsActionMenuOpen,
  customFieldTargetDialogId,
  setCustomFieldTargetDialogId,
  setCustomFieldName,
  setCustomFieldModalError,
  setIsCustomFieldModalOpen,
  isEditFieldsMode,
  setIsEditFieldsMode,
  setRenameTargetRowId,
  setRenameTargetDialogId,
  setRenameName,
  setRenameError,
  setIsRenameModalOpen,
  setIs2faModalOpen,
  setTwoFactorTargetDialogId,
  setIsSeedPhraseModalOpen,
  setSeedPhraseTargetDialogId,
  actionMenuRef,
  actionMenuButtonRef,
  totpNow,
  t,
  tCommon,
}: DataCardFormDialogProps) {
  const { t: tTip } = useTranslation('Tooltips');
  const rowElementsRef = React.useRef(new Map<string, HTMLDivElement>());
  const previousRowTopMapRef = React.useRef(new Map<string, number>());
  const customFieldDragStateRef = React.useRef<CustomFieldDragState>({
    activeRowId: null,
    overRowId: null,
    placement: null,
  });
  const [customFieldDragState, setCustomFieldDragState] = React.useState<CustomFieldDragState>({
    activeRowId: null,
    overRowId: null,
    placement: null,
  });
  const dragSourceRowIdRef = React.useRef<string | null>(null);
  const dragPointerOffsetXRef = React.useRef(0);
  const dragPointerOffsetYRef = React.useRef(0);
  const dragCurrentPointerXRef = React.useRef(0);
  const dragCurrentPointerYRef = React.useRef(0);
  const dragTranslateXRef = React.useRef(0);
  const dragTranslateYRef = React.useRef(0);

  const updateCustomFieldDragState = React.useCallback(
    (nextState: CustomFieldDragState | ((prev: CustomFieldDragState) => CustomFieldDragState)) => {
      setCustomFieldDragState((prev) => {
        const resolved = typeof nextState === 'function' ? nextState(prev) : nextState;
        customFieldDragStateRef.current = resolved;
        if (
          prev.activeRowId === resolved.activeRowId &&
          prev.overRowId === resolved.overRowId &&
          prev.placement === resolved.placement
        ) {
          return prev;
        }
        return resolved;
      });
    },
    []
  );

  const resetCustomFieldDragState = React.useCallback(() => {
    const activeRowId = dragSourceRowIdRef.current;
    const activeRowElement = activeRowId ? rowElementsRef.current.get(activeRowId) : null;
    if (activeRowElement) {
      activeRowElement.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)';
      activeRowElement.style.transform = '';
      const cleanup = () => {
        activeRowElement.style.transition = '';
      };
      activeRowElement.addEventListener('transitionend', cleanup, { once: true });
    }
    dragSourceRowIdRef.current = null;
    dragPointerOffsetXRef.current = 0;
    dragPointerOffsetYRef.current = 0;
    dragCurrentPointerXRef.current = 0;
    dragCurrentPointerYRef.current = 0;
    dragTranslateXRef.current = 0;
    dragTranslateYRef.current = 0;
    updateCustomFieldDragState({
      activeRowId: null,
      overRowId: null,
      placement: null,
    });
  }, [updateCustomFieldDragState]);

  const getDropPlacement = React.useCallback((clientY: number, bounds: DOMRect): CustomFieldDragPlacement => {
    return clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before';
  }, []);

  const moveCustomField = React.useCallback(
    (sourceRowId: string, targetRowId: string, placement: CustomFieldDragPlacement) => {
      if (dialogId === 'datacard-create-dialog') {
        viewModel.moveCreateCustomField(sourceRowId, targetRowId, placement);
        return;
      }
      viewModel.moveEditCustomField(sourceRowId, targetRowId, placement);
    },
    [dialogId, viewModel]
  );

  const visibleCustomFields = form?.customFields ?? [];
  const customFieldOrderSignature = React.useMemo(
    () => visibleCustomFields.map((row) => row.id).join('|'),
    [visibleCustomFields]
  );
  const visibleCustomFieldIds = React.useMemo(
    () => visibleCustomFields.map((row) => row.id),
    [customFieldOrderSignature]
  );

  const setCustomFieldRowRef = React.useCallback((rowId: string, node: HTMLDivElement | null) => {
    if (node) {
      rowElementsRef.current.set(rowId, node);
      return;
    }
    rowElementsRef.current.delete(rowId);
  }, []);

  const applyDraggedRowTransform = React.useCallback(() => {
    const activeRowId = dragSourceRowIdRef.current;
    if (!activeRowId) return;

    const activeRowElement = rowElementsRef.current.get(activeRowId);
    if (!activeRowElement) return;

    const rect = activeRowElement.getBoundingClientRect();
    const layoutLeft = rect.left - dragTranslateXRef.current;
    const layoutTop = rect.top - dragTranslateYRef.current;
    const targetLeft = dragCurrentPointerXRef.current - dragPointerOffsetXRef.current;
    const targetTop = dragCurrentPointerYRef.current - dragPointerOffsetYRef.current;
    const translateX = targetLeft - layoutLeft;
    const translateY = targetTop - layoutTop;

    activeRowElement.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)`;
    dragTranslateXRef.current = translateX;
    dragTranslateYRef.current = translateY;
  }, []);

  const updateCustomFieldDragHover = React.useCallback(
    (clientX: number, clientY: number) => {
      const dragSourceRowId = dragSourceRowIdRef.current;
      if (!dragSourceRowId) return;

      const target = document.elementFromPoint(clientX, clientY);
      const rowElement = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-customfield-row-id]') : null;

      if (!rowElement) {
        updateCustomFieldDragState((prev) =>
          prev.overRowId === null && prev.placement === null ? prev : { ...prev, overRowId: null, placement: null }
        );
        return;
      }

      const rowId = rowElement.dataset.customfieldRowId;
      if (!rowId || rowId === dragSourceRowId) {
        updateCustomFieldDragState((prev) =>
          prev.overRowId === null && prev.placement === null ? prev : { ...prev, overRowId: null, placement: null }
        );
        return;
      }

      const placement = getDropPlacement(clientY, rowElement.getBoundingClientRect());
      const previousDragState = customFieldDragStateRef.current;
      if (
        previousDragState.activeRowId === dragSourceRowId &&
        previousDragState.overRowId === rowId &&
        previousDragState.placement === placement
      ) {
        return;
      }

      moveCustomField(dragSourceRowId, rowId, placement);
      updateCustomFieldDragState({
        activeRowId: dragSourceRowId,
        overRowId: rowId,
        placement,
      });
    },
    [getDropPlacement, moveCustomField, updateCustomFieldDragState]
  );

  React.useEffect(() => {
    if (!isEditFieldsMode) {
      resetCustomFieldDragState();
    }
  }, [isEditFieldsMode, resetCustomFieldDragState]);

  React.useEffect(() => {
    const dragSourceRowId = dragSourceRowIdRef.current;
    if (!dragSourceRowId) return;
    if (!visibleCustomFields.some((row) => row.id === dragSourceRowId)) {
      resetCustomFieldDragState();
    }
  }, [resetCustomFieldDragState, visibleCustomFields]);

  React.useLayoutEffect(() => {
    const nextTopMap = new Map<string, number>();
    const activeRowId = dragSourceRowIdRef.current;
    const shouldAnimateRowReorder = Boolean(activeRowId);

    visibleCustomFieldIds.forEach((rowId) => {
      const element = rowElementsRef.current.get(rowId);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const nextTop = rowId === activeRowId ? rect.top - dragTranslateYRef.current : rect.top;
      nextTopMap.set(rowId, nextTop);

      if (!shouldAnimateRowReorder || rowId === activeRowId) return;

      const previousTop = previousRowTopMapRef.current.get(rowId);
      if (previousTop === undefined) return;

      const deltaY = previousTop - nextTop;
      if (Math.abs(deltaY) < 1) return;

      element.style.transition = 'none';
      element.style.transform = `translateY(${deltaY}px)`;
      void element.offsetHeight;

      requestAnimationFrame(() => {
        element.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)';
        element.style.transform = 'translateY(0)';

        const cleanup = () => {
          element.style.transition = '';
          element.style.transform = '';
        };

        element.addEventListener('transitionend', cleanup, { once: true });
      });
    });

    previousRowTopMapRef.current = nextTopMap;
    if (activeRowId) {
      applyDraggedRowTransform();
    }
  }, [applyDraggedRowTransform, visibleCustomFieldIds]);

  React.useEffect(() => {
    if (!customFieldDragState.activeRowId) return undefined;

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    applyDraggedRowTransform();

    const handlePointerMove = (event: PointerEvent) => {
      dragCurrentPointerXRef.current = event.clientX;
      dragCurrentPointerYRef.current = event.clientY;
      applyDraggedRowTransform();
      updateCustomFieldDragHover(event.clientX, event.clientY);
    };

    const handlePointerEnd = () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      resetCustomFieldDragState();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [applyDraggedRowTransform, customFieldDragState.activeRowId, resetCustomFieldDragState, updateCustomFieldDragHover]);

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

  const totpUri = (form.totpUri ?? '').trim();
  let totpData: { token: string; remaining: number } | null = null;
  if (totpUri) {
    try {
      totpData = generateTotpCode(totpUri, totpNow);
    } catch {
      totpData = null;
    }
  }

  const getCustomFieldRowClassName = (rowId: string) => {
    const classes = ['form-field', 'customfield-row'];
    if (customFieldDragState.activeRowId === rowId) {
      classes.push('customfield-row--dragging');
    }
    if (customFieldDragState.overRowId === rowId && customFieldDragState.placement === 'before') {
      classes.push('customfield-row--drop-before');
    }
    if (customFieldDragState.overRowId === rowId && customFieldDragState.placement === 'after') {
      classes.push('customfield-row--drop-after');
    }
    return classes.join(' ');
  };

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
              <DataCardDialogActionMenu
                dialogId={dialogId}
                customFieldTargetDialogId={customFieldTargetDialogId}
                setCustomFieldTargetDialogId={setCustomFieldTargetDialogId}
                isActionMenuOpen={isActionMenuOpen}
                setIsActionMenuOpen={setIsActionMenuOpen}
                actionMenuRef={actionMenuRef}
                actionMenuButtonRef={actionMenuButtonRef}
                hasTotp={Boolean(form.totpUri?.trim())}
                seedPhraseWordCount={seedPhraseWordCount}
                hasCustomFields={visibleCustomFields.length > 0}
                isEditFieldsMode={isEditFieldsMode}
                onAddCustomField={() => {
                  setIsActionMenuOpen(false);
                  setCustomFieldTargetDialogId(dialogId);
                  setCustomFieldName('');
                  setCustomFieldModalError(null);
                  setIsCustomFieldModalOpen(true);
                }}
                onOpenTwoFactor={() => {
                  setIsActionMenuOpen(false);
                  setTwoFactorTargetDialogId(dialogId);
                  setIs2faModalOpen(true);
                }}
                onOpenSeedPhrase={() => {
                  setIsActionMenuOpen(false);
                  setSeedPhraseTargetDialogId(dialogId);
                  setIsSeedPhraseModalOpen(true);
                }}
                onToggleEditFields={() => {
                  setIsActionMenuOpen(false);
                  setIsEditFieldsMode((prev) => !prev);
                }}
                t={t}
              />
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
              onChange={(event) => onFieldChange('title', event.target.value)}
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
              onChange={(event) => onFieldChange('url', event.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor={`${dialogId}-email`}>
              {t('label.email')}
            </label>
            <input
              id={`${dialogId}-email`}
              className="input"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={form.email}
              onChange={(event) => onFieldChange('email', event.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor={`${dialogId}-recovery-email`}>
              {t('label.recoveryEmail')}
            </label>
            <input
              id={`${dialogId}-recovery-email`}
              className="input"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={form.recoveryEmail}
              onChange={(event) => onFieldChange('recoveryEmail', event.target.value)}
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
              onChange={(event) => onFieldChange('username', event.target.value)}
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
              onChange={(event) => onFieldChange('mobilePhone', event.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor={`${dialogId}-password`}>
              {t('label.password')}
            </label>
            <div className="input-with-actions input-with-actions--inline-actions">
              <input
                id={`${dialogId}-password`}
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => onFieldChange('password', event.target.value)}
              />
              <div className="input-actions">
                <button
                  className="icon-button input-action-inline"
                  type="button"
                  onClick={togglePasswordVisibility}
                  aria-label={t('action.togglePasswordVisibility')}
                  title={showPassword ? tTip('action.hidePassword') : tTip('action.showPassword')}
                >
                  {showPassword ? <IconPreviewOff /> : <IconPreview />}
                </button>

                <button
                  className="icon-button input-action-inline"
                  type="button"
                  onClick={openGenerator}
                  aria-label={t('action.openGenerator')}
                  title={tTip('generator.open')}
                >
                  <IconRegenerate />
                </button>
              </div>
            </div>
          </div>

          {totpUri && (
            <div className="form-field">
              <label className="form-label">{t('label.totp')}</label>

              <div className="totp-preview-field" aria-live="polite">
                <div className="totp-preview-field__content">
                  <span className="totp-preview-field__token">
                    {totpData ? totpData.token : t('totp.invalid')}
                  </span>

                  {totpData && (
                    <span className="muted totp-preview-field__meta">
                      {t('totp.expiresIn', { seconds: totpData.remaining })}
                    </span>
                  )}
                </div>

                <button
                  className="icon-button input-action-inline input-action-inline-text totp-preview-field__edit"
                  type="button"
                  onClick={() => {
                    setTwoFactorTargetDialogId(dialogId);
                    setIs2faModalOpen(true);
                  }}
                  aria-label={t('twoFactor.editAction')}
                  title={t('twoFactor.editAction')}
                >
                  {t('action.edit')}
                </button>
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
                  setSeedPhraseTargetDialogId(dialogId);
                  setIsSeedPhraseModalOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSeedPhraseTargetDialogId(dialogId);
                    setIsSeedPhraseModalOpen(true);
                  }
                }}
              >
                <span className="seedphrase-summary-count">{t('seedPhrase.wordsCount', { count: seedPhraseWordCount })}</span>
                <span className="muted">{t('seedPhrase.editAction')}</span>
              </div>
            </div>
          )}

          {visibleCustomFields.map((row) => (
            <div
              className={getCustomFieldRowClassName(row.id)}
              key={row.id}
              data-customfield-row-id={row.id}
              ref={(node) => setCustomFieldRowRef(row.id, node)}
            >
              <label className="form-label" htmlFor={`${dialogId}-cf-${row.id}`}>
                {row.key}
              </label>
              <div
                className={`input-with-actions${
                  isEditFieldsMode ? ' input-with-actions--inline-actions input-with-actions--customfield-actions' : ''
                }`}
              >
                <input
                  id={`${dialogId}-cf-${row.id}`}
                  className="input"
                  autoComplete="off"
                  value={row.value}
                  onChange={(event) => {
                    if (dialogId === 'datacard-create-dialog') {
                      viewModel.updateCreateCustomFieldValue(row.id, event.target.value);
                    } else {
                      viewModel.updateEditCustomFieldValue(row.id, event.target.value);
                    }
                  }}
                />
                {isEditFieldsMode && (
                  <div className="input-actions">
                    <button
                      type="button"
                      className="icon-button input-action-inline input-action-drag-handle"
                      aria-label={t('customFields.reorder')}
                      title={t('customFields.reorder')}
                      onPointerDown={(event) => {
                        if (!isEditFieldsMode) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rowElement = rowElementsRef.current.get(row.id);
                        if (!rowElement) return;
                        dragSourceRowIdRef.current = row.id;
                        dragCurrentPointerXRef.current = event.clientX;
                        dragCurrentPointerYRef.current = event.clientY;
                        dragPointerOffsetXRef.current = event.clientX - rowElement.getBoundingClientRect().left;
                        dragPointerOffsetYRef.current = event.clientY - rowElement.getBoundingClientRect().top;
                        updateCustomFieldDragState({
                          activeRowId: row.id,
                          overRowId: null,
                          placement: null,
                        });
                        requestAnimationFrame(() => {
                          applyDraggedRowTransform();
                        });
                      }}
                    >
                      <IconGripVertical />
                    </button>
                    <button
                      type="button"
                      className="icon-button input-action-inline"
                      aria-label={t('customFields.rename')}
                      title={tTip('action.rename')}
                      onClick={() => {
                        setRenameTargetRowId(row.id);
                        setRenameTargetDialogId(dialogId);
                        setRenameName(row.key);
                        setRenameError(null);
                        setIsRenameModalOpen(true);
                      }}
                    >
                      <IconRename />
                    </button>
                    <button
                      type="button"
                      className="icon-button input-action-inline icon-button-danger"
                      aria-label={t('customFields.delete')}
                      title={tTip('action.delete')}
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
              onChange={(event) => onFieldChange('note', event.target.value)}
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
              className="input form-placeholder-visible"
              autoComplete="off"
              value={form.tagsText}
              placeholder={t('label.tagsPlaceholder')}
              onChange={(event) => onFieldChange('tagsText', event.target.value)}
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

          <div className={`dialog-footer dialog-footer--split${isCreateDialog ? ' dialog-footer--equal-buttons' : ''}`}>
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
}

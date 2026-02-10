import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { BankCardItem } from '../../types/ui';
import { useBankCardDetails } from './useBankCardDetails';
import { IconCopy, IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import { wasActuallyUpdated } from '../../utils/updatedAt';
import { setBankCardPreviewFieldsForCard } from '../../api/vaultApi';
import {
  loadBankCardPreviewFields,
  saveBankCardPreviewFields,
  type BankCardPreviewField,
} from '../../lib/bankcardPreviewFields';
import {
  loadBankCardCoreHiddenFields,
  onBankCardCoreHiddenFieldsChanged,
  saveBankCardCoreHiddenFields,
  type BankCardCoreField,
} from '../../lib/bankcardCoreHiddenFields';

export type BankCardDetailsProps = {
  card: BankCardItem | null;
  onEdit: (card: BankCardItem) => void;
  onReloadCard?: (id: string) => Promise<void> | void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  isTrashMode: boolean;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
};

const maskCardNumber = (value?: string | null) => {
  const trimmed = value?.replace(/\s+/g, '') ?? '';
  if (!trimmed) return '';
  if (trimmed.length <= 4) return trimmed;
  return `•••• ${trimmed.slice(-4)}`;
};

const maskHolder = (value?: string | null) => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  // Intentionally avoid leaking length; keep the UI consistently “sealed” by default.
  return '••••••';
};

export function BankCardDetails({
  card,
  onEdit,
  onReloadCard,
  onDelete,
  onRestore,
  onPurge,
  onToggleFavorite,
  isTrashMode,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
}: BankCardDetailsProps) {
  const { t } = useTranslation('BankCards');
  const { t: tVault } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const detailActions = useBankCardDetails({
    card,
    onDelete,
    onEdit,
    onRestore,
    onPurge,
    onToggleFavorite,
    isTrashMode,
    clipboardAutoClearEnabled,
    clipboardClearTimeoutSeconds,
  });

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [globalPreview, setGlobalPreview] = useState<{ fields: BankCardPreviewField[] }>({ fields: [] });
  const [globalNumberMode, setGlobalNumberMode] = useState<'full' | 'last_four' | null>(null);
  const [coreHiddenFields, setCoreHiddenFields] = useState<BankCardCoreField[]>([]);
  const [previewMenu, setPreviewMenu] = useState<
    | null
    | {
        x: number;
        y: number;
        kind: 'field';
        field: BankCardPreviewField;
      }
    | {
        x: number;
        y: number;
        kind: 'card_number';
      }
    | {
        x: number;
        y: number;
        kind: 'core';
        field: BankCardCoreField;
      }
  >(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const prefs = await loadBankCardPreviewFields();
        if (cancelled) return;
        setGlobalPreview({ fields: prefs.fields });
        setGlobalNumberMode(prefs.cardNumberMode);
      } catch (e) {
        console.error(e);
      }
    };

    load();
    const handler = () => load();
    window.addEventListener('bankcard-preview-fields-changed', handler as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('bankcard-preview-fields-changed', handler as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadBankCardCoreHiddenFields().then((fields) => {
      if (!cancelled) setCoreHiddenFields(fields);
    });

    const unsubscribe = onBankCardCoreHiddenFieldsChanged(setCoreHiddenFields);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const informationTitle = <div className="vault-section-header">{tVault('information.title')}</div>;

  if (!card) {
    return (
      <div className="vault-panel-wrapper">
        {informationTitle}
        <div className="vault-empty">{t('label.selectPrompt')}</div>
      </div>
    );
  }

  const isFavorite = card.isFavorite;
  const createdText = `${t('label.created')}: ${new Date(card.createdAt).toLocaleString()}`;
  const showUpdated = wasActuallyUpdated(card.createdAt, card.updatedAt);
  const updatedText = showUpdated ? `${t('label.updated')}: ${new Date(card.updatedAt).toLocaleString()}` : '';
  const hasValue = (value?: string | null) => {
    const trimmed = value?.trim();
    return Boolean(trimmed);
  };
  const hasHolder = hasValue(card.holder);
  const hasNumber = hasValue(card.number);
  const hasExpiry = hasValue(card.expiryMmYy);
  const hasCvc = hasValue(card.cvc);
  const hasNote = hasValue(card.note);
  const hasTitle = hasValue(card.title);
  const hasBankName = hasValue(card.bankName);
  const title = card.title?.trim() ?? '';
  const hasTags = Array.isArray(card.tags) && card.tags.length > 0;
  const { showHolder, showNumber, showCvc } = detailActions;

  const perCardFields = card.previewFields.fields ?? [];
  const perCardNumberMode = card.previewFields.cardNumberMode ?? null;

  const updateCardPreviewFields = async (nextFields: BankCardPreviewField[], nextMode: 'full' | 'last_four' | null) => {
    const ok = await setBankCardPreviewFieldsForCard(card.id, {
      fields: nextFields,
      card_number_mode: nextMode,
    });
    // Update UI immediately (list preview + details) without requiring a full vault reload.
    if (ok) {
      window.dispatchEvent(
        new CustomEvent('bankcard-preview-fields-for-card-changed', {
          detail: {
            id: card.id,
            previewFields: {
              fields: nextFields,
              cardNumberMode: nextMode,
            },
          },
        })
      );

      await onReloadCard?.(card.id);
    }
    return ok;
  };

  const updateGlobalPreviewFields = async (
    nextFields: BankCardPreviewField[],
    nextMode: 'full' | 'last_four' | null
  ) => {
    const ok = await saveBankCardPreviewFields({ fields: nextFields, cardNumberMode: nextMode });
    if (ok) {
      setGlobalPreview({ fields: nextFields });
      setGlobalNumberMode(nextMode);
    }
    return ok;
  };

  const holderDisplay = hasHolder ? (showHolder ? card.holder ?? '' : maskHolder(card.holder)) : '';

  const numberDisplay = hasNumber
    ? showNumber
      ? card.number
      : maskCardNumber(card.number)
    : '';
  const maskedCvc = card.cvc ? (card.cvc.length >= 4 ? '••••' : '•••') : '';
  const cvcDisplay = hasCvc ? (showCvc ? card.cvc : maskedCvc) : '';

  const tagsText = card.tags?.join(', ') ?? '';

  return (
    <>
      <div className="vault-panel-wrapper">
        {informationTitle}
        <div className="vault-detail-card bankcard-detail-card">
          <div className="detail-row">
            <div className="detail-dates">
              <div className="muted">{createdText}</div>
              {showUpdated && <div className="muted">{updatedText}</div>}
            </div>
            <div className="detail-actions">
              {!isTrashMode && (
                <>
                  <button className="btn btn-secondary" type="button" onClick={detailActions.toggleFavorite}>
                    {isFavorite ? t('action.unmarkFavorite') : t('action.markFavorite')}
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={detailActions.editCard}>
                    {t('action.edit')}
                  </button>
                  <button className="btn btn-danger" type="button" onClick={() => setDeleteConfirmOpen(true)}>
                    {t('action.delete')}
                  </button>
                </>
              )}
              {isTrashMode && (
                <>
                  <button className="btn btn-secondary" type="button" onClick={detailActions.restoreCard}>
                    {t('action.restore')}
                  </button>
                  <button className="btn btn-danger" type="button" onClick={() => setPurgeConfirmOpen(true)}>
                    {t('action.purge')}
                  </button>
                </>
              )}
            </div>
          </div>

          {hasTitle && (
            <div className="detail-field">
              <div className="detail-label">{t('label.title')}</div>
              <div
                className="detail-value-box"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPreviewMenu({ x: event.clientX, y: event.clientY, kind: 'core', field: 'title' });
                }}
              >
                <div className="detail-value-text">{title}</div>
              </div>
            </div>
          )}

          {hasBankName && (
            <div className="detail-field">
              <div className="detail-label">{t('label.bankName')}</div>
              <div
                className="detail-value-box"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPreviewMenu({ x: event.clientX, y: event.clientY, kind: 'field', field: 'bank_name' });
                }}
              >
                <div className="detail-value-text">{card.bankName ?? ''}</div>
                <div className="detail-value-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t('action.copy')}
                    onClick={() => detailActions.copyToClipboard(card.bankName)}
                  >
                    <IconCopy />
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasHolder && (
            <div className="detail-field">
              <div className="detail-label">{t('label.holder')}</div>
              <div
                className="detail-value-box"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPreviewMenu({ x: event.clientX, y: event.clientY, kind: 'field', field: 'holder' });
                }}
              >
                <div className="detail-value-text">{holderDisplay}</div>
                <div className="detail-value-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t(`action.${showHolder ? 'hide' : 'reveal'}`)}
                    onClick={detailActions.toggleHolderVisibility}
                  >
                    {showHolder ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t('action.copy')}
                    onClick={() => detailActions.copyToClipboard(card.holder, { isSecret: true })}
                  >
                    <IconCopy />
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasNumber && (
            <div className="detail-field">
              <div className="detail-label">{t('label.cardNumber')}</div>
              <div
                className="detail-value-box"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPreviewMenu({ x: event.clientX, y: event.clientY, kind: 'card_number' });
                }}
              >
                <div className="detail-value-text">{numberDisplay}</div>
                <div className="detail-value-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t(`action.${showNumber ? 'hide' : 'reveal'}`)}
                    onClick={detailActions.toggleNumberVisibility}
                  >
                    {showNumber ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t('action.copy')}
                    onClick={() => detailActions.copyToClipboard(card.number, { isSecret: true })}
                  >
                    <IconCopy />
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasExpiry && (
            <div className="detail-field bankcard-compact-expiry">
              <div className="detail-label">{t('label.expiry')}</div>
              <div className="detail-value-box">
                <div className="detail-value-text">{card.expiryMmYy ?? ''}</div>
              </div>
            </div>
          )}

          {hasCvc && (
            <div className="detail-field bankcard-compact-cvc">
              <div className="detail-label">{t('label.cvc')}</div>
              <div className="detail-value-box">
                <div className="detail-value-text detail-value-text-monospace">{cvcDisplay}</div>
                <div className="detail-value-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t(`action.${showCvc ? 'hide' : 'reveal'}`)}
                    onClick={detailActions.toggleCvcVisibility}
                  >
                    {showCvc ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t('action.copy')}
                    onClick={() => detailActions.copyToClipboard(card.cvc, { isSecret: true })}
                  >
                    <IconCopy />
                  </button>
                </div>
              </div>
            </div>
          )}

          {hasNote && (() => {
            const noteText = card.note ?? '';
            const isNoteMultiline = noteText.includes('\n');

            return (
              <div className={`detail-field detail-field-notes${isNoteMultiline ? ' detail-field-notes--multiline' : ''}`}>
                <div className="detail-label">{t('label.note')}</div>
                <div
                  className={`detail-value-box${isNoteMultiline ? ' detail-value-multiline' : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setPreviewMenu({ x: event.clientX, y: event.clientY, kind: 'field', field: 'note' });
                  }}
                >
                  <div className={`detail-value-text${isNoteMultiline ? ' detail-value-text-multiline' : ''}`}>{noteText}</div>
                  <div className="detail-value-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={t('action.copy')}
                      onClick={() => detailActions.copyToClipboard(noteText)}
                    >
                      <IconCopy />
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {hasTags && (
            <div className="detail-field">
              <div className="detail-label">{t('label.tags')}</div>
              <div
                className="detail-value-box"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPreviewMenu({ x: event.clientX, y: event.clientY, kind: 'field', field: 'tags' });
                }}
              >
                <div className="detail-value-text">{tagsText}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {previewMenu && (
        <>
          <div
            className="vault-actionmenu-backdrop"
            onClick={() => setPreviewMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setPreviewMenu(null);
            }}
          />
          <div
            className="vault-actionmenu-panel vault-contextmenu-panel"
            role="menu"
            style={
              {
                '--menu-x': `${previewMenu.x}px`,
                '--menu-y': `${previewMenu.y}px`,
              } as React.CSSProperties
            }
          >
            {previewMenu.kind === 'core' && (() => {
              const field = previewMenu.field;
              const isHidden = coreHiddenFields.includes(field);

              return (
                <button
                  className="vault-actionmenu-item"
                  type="button"
                  onClick={async () => {
                    const next = isHidden ? coreHiddenFields.filter((f) => f !== field) : [...coreHiddenFields, field];
                    await saveBankCardCoreHiddenFields(next);
                    setPreviewMenu(null);
                  }}
                >
                  {isHidden ? t('coreMenu.showInList') : t('coreMenu.hideInList')}
                </button>
              );
            })()}

            {previewMenu.kind === 'field' && (() => {
              const field = previewMenu.field;
              const isEnabledForCard = perCardFields.includes(field);
              const isEnabledForAll = globalPreview.fields.includes(field);

              return (
                <>
                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      if (isEnabledForCard) {
                        await updateCardPreviewFields(perCardFields.filter((f) => f !== field), perCardNumberMode);
                      } else {
                        await updateCardPreviewFields([...perCardFields, field], perCardNumberMode);
                      }
                      setPreviewMenu(null);
                    }}
                  >
                    {isEnabledForCard ? t('previewMenu.hideInPreview') : t('previewMenu.showInPreview')}
                  </button>

                  <div className="vault-actionmenu-separator" />

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      if (isEnabledForAll) {
                        await updateGlobalPreviewFields(globalPreview.fields.filter((f) => f !== field), globalNumberMode);
                      } else {
                        await updateGlobalPreviewFields([...globalPreview.fields, field], globalNumberMode);
                      }
                      setPreviewMenu(null);
                    }}
                  >
                    {isEnabledForAll ? t('previewMenu.hideInPreviewAll') : t('previewMenu.showInPreviewAll')}
                  </button>
                </>
              );
            })()}

            {previewMenu.kind === 'card_number' && (() => {
              const isFullForCard = perCardNumberMode === 'full';
              const isLastFourForCard = perCardNumberMode === 'last_four';
              const isFullForAll = globalNumberMode === 'full';
              const isLastFourForAll = globalNumberMode === 'last_four';

              return (
                <>
                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      await updateCardPreviewFields(perCardFields, isFullForCard ? null : 'full');
                      setPreviewMenu(null);
                    }}
                  >
                    {isFullForCard ? t('previewMenu.hideCardNumberFull') : t('previewMenu.showCardNumberFull')}
                  </button>

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      await updateCardPreviewFields(perCardFields, isLastFourForCard ? null : 'last_four');
                      setPreviewMenu(null);
                    }}
                  >
                    {isLastFourForCard ? t('previewMenu.hideCardNumberLastFour') : t('previewMenu.showCardNumberLastFour')}
                  </button>

                  <div className="vault-actionmenu-separator" />

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      await updateGlobalPreviewFields(globalPreview.fields, isFullForAll ? null : 'full');
                      setPreviewMenu(null);
                    }}
                  >
                    {isFullForAll ? t('previewMenu.hideCardNumberFullAll') : t('previewMenu.showCardNumberFullAll')}
                  </button>

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={async () => {
                      await updateGlobalPreviewFields(globalPreview.fields, isLastFourForAll ? null : 'last_four');
                      setPreviewMenu(null);
                    }}
                  >
                    {isLastFourForAll
                      ? t('previewMenu.hideCardNumberLastFourAll')
                      : t('previewMenu.showCardNumberLastFourAll')}
                  </button>
                </>
              );
            })()}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('dialog.delete.title')}
        description={t('dialog.delete.message')}
        confirmLabel={t('dialog.delete.confirm')}
        cancelLabel={tCommon('action.cancel')}
        onConfirm={() => {
          detailActions.deleteCard();
          setDeleteConfirmOpen(false);
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
      <ConfirmDialog
        open={purgeConfirmOpen}
        title={t('dialog.purge.title')}
        description={t('dialog.purge.message')}
        confirmLabel={t('dialog.purge.confirm')}
        cancelLabel={tCommon('action.cancel')}
        onConfirm={() => {
          detailActions.purgeCard();
          setPurgeConfirmOpen(false);
        }}
        onCancel={() => setPurgeConfirmOpen(false)}
      />
    </>
  );
}

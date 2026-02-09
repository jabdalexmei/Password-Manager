import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { CustomField, DataCard, Folder } from '../../types/ui';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useDetails } from './useDetails';
import { generateTotpCode } from '../../utils/totp';
import { wasActuallyUpdated } from '../../utils/updatedAt';
import {
  IconAttachment,
  IconCopy,
  IconDelete,
  IconHistory,
  IconImport,
  IconPreview,
  IconPreviewOff,
} from '@/shared/icons/lucide/icons';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import {
  loadPreviewFields,
  onPreviewFieldsChanged,
  savePreviewFields,
  type DataCardPreviewField,
} from '../../lib/datacardPreviewFields';
import {
  loadCoreHiddenFields,
  onCoreHiddenFieldsChanged,
  saveCoreHiddenFields,
  type DataCardCoreField,
} from '../../lib/datacardCoreHiddenFields';
import { setDataCardPreviewFieldsForCard } from '../../api/vaultApi';

const LazyAttachmentPreviewModal = React.lazy(() =>
  import('../modals/AttachmentPreviewModal').then((m) => ({ default: m.default })),
);
const LazyPasswordHistoryDialog = React.lazy(() =>
  import('../modals/PasswordHistoryDialog').then((m) => ({ default: m.default })),
);
const LazySeedPhraseViewModal = React.lazy(() =>
  import('../modals/SeedPhraseViewModal').then((m) => ({ default: m.SeedPhraseViewModal })),
);

export type DetailsProps = {
  card: DataCard | null;
  folders: Folder[];
  onEdit: (card: DataCard) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAttachmentPresenceChange?: (cardId: string, hasAttachments: boolean) => void;
  onReloadCard?: (id: string) => void;
  isTrashMode: boolean;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
};

type DataCardCustomPreviewField = `custom:${string}`;
type DataCardCardPreviewField = DataCardPreviewField | DataCardCustomPreviewField;

const CUSTOM_PREVIEW_PREFIX = 'custom:' as const;
const isCustomPreviewField = (value: string): value is DataCardCustomPreviewField =>
  value.startsWith(CUSTOM_PREVIEW_PREFIX) && value.length > CUSTOM_PREVIEW_PREFIX.length;

const toCustomPreviewField = (key: string): DataCardCustomPreviewField => `${CUSTOM_PREVIEW_PREFIX}${key}`;

export function Details({
  card,
  folders,
  onEdit,
  onDelete,
  onRestore,
  onPurge,
  onToggleFavorite,
  onAttachmentPresenceChange,
  onReloadCard,
  isTrashMode,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
}: DetailsProps) {
  const { t } = useTranslation('Details');
  const { t: tVault } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const detailActions = useDetails({
    card,
    onDelete,
    onEdit,
    onRestore,
    onPurge,
    onToggleFavorite,
    onAttachmentPresenceChange,
    isTrashMode,
    clipboardAutoClearEnabled,
    clipboardClearTimeoutSeconds,
  });

  const folderName = useMemo(() => {
    if (!card) return '';
    return card.folderId ? folders.find((f) => f.id === card.folderId)?.name ?? '' : '';
  }, [card, folders]);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seedPhraseViewOpen, setSeedPhraseViewOpen] = useState(false);
  const [revealedCustomFields, setRevealedCustomFields] = useState<Record<string, boolean>>({});
  const [totpNow, setTotpNow] = useState(() => Date.now());
  const [previewFields, setPreviewFields] = useState<DataCardPreviewField[]>([]);
  const [coreHiddenFields, setCoreHiddenFields] = useState<DataCardCoreField[]>([]);
  const [previewMenu, setPreviewMenu] = useState<{
    x: number;
    y: number;
    field: DataCardCardPreviewField;
    allowGlobal: boolean;
  } | null>(null);
  const [coreMenu, setCoreMenu] = useState<{
    x: number;
    y: number;
    field: DataCardCoreField;
  } | null>(null);

  const totpData = useMemo(() => {
    const uri = card?.totpUri;
    if (!uri) return null;

    try {
      return generateTotpCode(uri, totpNow);
    } catch {
      return null;
    }
  }, [card?.totpUri, totpNow]);

  useEffect(() => {
    if (!card?.totpUri) return;

    const id = window.setInterval(() => setTotpNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [card?.totpUri]);

  useEffect(() => {
    setHistoryOpen(false);
  }, [card?.id]);

  useEffect(() => {
    setRevealedCustomFields({});
  }, [card?.id]);

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

  useEffect(() => {
    if (!previewMenu && !coreMenu) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPreviewMenu(null);
      setCoreMenu(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewMenu, coreMenu]);

  const toggleCustomFieldVisibility = (fieldId: string) => {
    setRevealedCustomFields((prev) => ({
      ...prev,
      [fieldId]: !prev[fieldId],
    }));
  };

  const openPreviewMenu = (field: DataCardCardPreviewField, e: React.MouseEvent, allowGlobal: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setCoreMenu(null);
    setPreviewMenu({ x: e.clientX, y: e.clientY, field, allowGlobal });
  };

  const openCoreMenu = (field: DataCardCoreField, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPreviewMenu(null);
    setCoreMenu({ x: e.clientX, y: e.clientY, field });
  };

  const isAllowedGlobalPreviewField = (value: string): value is DataCardPreviewField =>
    value === 'username' ||
    value === 'recovery_email' ||
    value === 'mobile_phone' ||
    value === 'note' ||
    value === 'folder' ||
    value === 'tags';

  const isAllowedCardPreviewField = (value: string): value is DataCardCardPreviewField =>
    isAllowedGlobalPreviewField(value) || isCustomPreviewField(value);

  const perCardPreviewFields = useMemo<DataCardCardPreviewField[]>(() => {
    const raw = Array.isArray(card?.previewFields) ? card!.previewFields : [];
    const out: DataCardCardPreviewField[] = [];
    for (const item of raw) {
      if (!isAllowedCardPreviewField(item)) continue;
      if (out.includes(item)) continue;
      out.push(item);
    }
    return out;
  }, [card?.previewFields]);

  const isFieldInCardPreview = (field: DataCardCardPreviewField) => perCardPreviewFields.includes(field);

  const togglePreviewFieldForCard = async (field: DataCardCardPreviewField) => {
    if (!card) return;

    const isSelected = isFieldInCardPreview(field);

    if (isSelected) {
      const next = perCardPreviewFields.filter((f) => f !== field);
      await setDataCardPreviewFieldsForCard(card.id, next);
      onReloadCard?.(card.id);
      setPreviewMenu(null);
      return;
    }

    const next = [...perCardPreviewFields, field];
    await setDataCardPreviewFieldsForCard(card.id, next);
    onReloadCard?.(card.id);
    setPreviewMenu(null);
  };

  const isFieldInGlobalPreview = (field: DataCardPreviewField) => previewFields.includes(field);

  const togglePreviewFieldForAllCards = async (field: DataCardPreviewField) => {
    const isSelected = isFieldInGlobalPreview(field);

    if (isSelected) {
      await savePreviewFields(previewFields.filter((f) => f !== field));
      setPreviewMenu(null);
      return;
    }
    await savePreviewFields([...previewFields, field]);
    setPreviewMenu(null);
  };

  const isCoreFieldHidden = (field: DataCardCoreField) => coreHiddenFields.includes(field);

  const toggleCoreFieldHidden = async (field: DataCardCoreField) => {
    const isHidden = isCoreFieldHidden(field);
    const next = isHidden ? coreHiddenFields.filter((f) => f !== field) : [...coreHiddenFields, field];
    await saveCoreHiddenFields(next);
    setCoreMenu(null);
  };

  const informationTitle = (
    <div className="vault-section-header">{tVault('information.title')}</div>
  );

  if (!card) {
    return (
      <div className="vault-panel-wrapper">
        {informationTitle}
        <div className="vault-empty">{t('empty.selectPrompt')}</div>
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
  const hasTitle = hasValue(card.title);
  const hasUrl = hasValue(card.url);
  const hasEmail = hasValue(card.email);
  const hasRecoveryEmail = hasValue(card.recoveryEmail);
  const hasUsername = hasValue(card.username);
  const hasMobilePhone = hasValue(card.mobilePhone);
  const hasPassword = hasValue(card.password);
  const hasNote = hasValue(card.note);
  const hasTags = Array.isArray(card.tags) && card.tags.length > 0;
  const hasFolderName = hasValue(folderName);
  const seedPhraseRaw = hasValue(card.seedPhrase) ? (card.seedPhrase as string) : null;
  const seedPhraseWordCount =
    typeof card.seedPhraseWordCount === 'number' && card.seedPhraseWordCount > 0
      ? card.seedPhraseWordCount
      : seedPhraseRaw
        ? seedPhraseRaw.trim().split(/\s+/).filter(Boolean).length
        : 0;
  const hasSeedPhrase = seedPhraseWordCount > 0;
  const passwordDisplay = hasPassword
    ? detailActions.showPassword
      ? card.password
      : '••••••••••••'
    : '';

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const previewMimeType = detailActions.previewPayload?.mimeType ?? '';
  const previewTitle = detailActions.previewPayload?.fileName ?? '';
  const previewObjectUrl = detailActions.previewPayload?.objectUrl ?? '';
  const previewDownloadHandler = detailActions.previewPayload
    ? () => detailActions.onDownloadAttachment(
        detailActions.previewPayload.attachmentId,
        detailActions.previewPayload.fileName
      )
    : undefined;

  return (
    <>
      <div className="vault-panel-wrapper">
        {informationTitle}
        <div className="vault-detail-card">
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
        <ConfirmDialog
          open={Boolean(attachmentToDelete)}
          title={t('attachments.deleteTitle')}
          description={t('attachments.deleteBody')}
          confirmLabel={t('attachments.deleteConfirm')}
          cancelLabel={tCommon('action.cancel')}
          onConfirm={() => {
            if (attachmentToDelete) {
              detailActions.onDeleteAttachment(attachmentToDelete);
            }
            setAttachmentToDelete(null);
          }}
          onCancel={() => setAttachmentToDelete(null)}
        />

      {hasTitle && (
        <div className="detail-field">
          <div className="detail-label">{t('label.title')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openCoreMenu('title', e)}>
            <div className="detail-value-text">{card.title}</div>
          </div>
        </div>
      )}

      {hasUrl && (
        <div className="detail-field">
          <div className="detail-label">{t('label.url')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openCoreMenu('url', e)}>
            <div className="detail-value-text">{card.url ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.url)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasEmail && (
        <div className="detail-field">
          <div className="detail-label">{t('label.email')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openCoreMenu('email', e)}>
            <div className="detail-value-text">{card.email ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.email)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasRecoveryEmail && (
        <div className="detail-field">
          <div className="detail-label">{t('label.recoveryEmail')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openPreviewMenu('recovery_email', e, true)}>
            <div className="detail-value-text">{card.recoveryEmail ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.recoveryEmail)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasUsername && (
        <div className="detail-field">
          <div className="detail-label">{t('label.username')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openPreviewMenu('username', e, true)}>
            <div className="detail-value-text">{card.username ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.username)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasMobilePhone && (
        <div className="detail-field">
          <div className="detail-label">{t('label.mobile')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openPreviewMenu('mobile_phone', e, true)}>
            <div className="detail-value-text">{card.mobilePhone ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.mobilePhone)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasPassword && (
        <div className="detail-field">
          <div className="detail-label">{t('label.password')}</div>
          <div className="detail-value-box">
            <div className="detail-value-text">{passwordDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={detailActions.showPassword ? t('action.hide') : t('action.reveal')}
                onClick={detailActions.togglePasswordVisibility}
              >
                {detailActions.showPassword ? <IconPreviewOff /> : <IconPreview />}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.password, { isSecret: true })}
              >
                <IconCopy />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.passwordHistory')}
                onClick={() => setHistoryOpen(true)}
              >
                <IconHistory />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasSeedPhrase && (
        <div className="detail-field">
          <div className="detail-label">{t('label.seedPhrase')}</div>
          <div className="detail-value-box">
            <div className="detail-value-text">{t('seedPhrase.wordsCount', { count: seedPhraseWordCount })}</div>
            <div className="detail-value-actions">
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                onClick={() => setSeedPhraseViewOpen(true)}
              >
                {t('action.open')}
              </button>
            </div>
          </div>
        </div>
      )}

      {card.totpUri && (
        <div className="detail-field">
          <div className="detail-label">{t('label.totp')}</div>

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

            {totpData && (
              <div className="detail-value-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={t('action.copy')}
                  onClick={() => detailActions.copyToClipboard(totpData.token, { isSecret: true })}
                >
                  <IconCopy />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {(card.customFields ?? [])
        .filter((field) => Boolean(field.value?.trim()))
        .map((field: CustomField, index: number) => {
          const fieldId = `custom-field-${index}-${field.key}`;
          const isSecret = field.type === 'secret';
          const isRevealed = Boolean(revealedCustomFields[fieldId]);
          const displayValue = isSecret ? (isRevealed ? field.value : '••••••••••••') : field.value;

          return (
            <div key={fieldId} className="detail-field">
              <div className="detail-label">{field.key}</div>

              <div
                className="detail-value-box"
                onContextMenu={(e) => openPreviewMenu(toCustomPreviewField(field.key), e, false)}
              >
                <div className="detail-value-text">{displayValue}</div>

                <div className="detail-value-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t('action.copy')}
                    onClick={() => detailActions.copyToClipboard(field.value, { isSecret })}
                  >
                    <IconCopy />
                  </button>

                  {isSecret && (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={isRevealed ? t('action.hide') : t('action.reveal')}
                      onClick={() => toggleCustomFieldVisibility(fieldId)}
                    >
                      {isRevealed ? <IconPreviewOff /> : <IconPreview />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

      {hasNote && (() => {
        const noteText = card.note ?? '';
        const isNoteMultiline = noteText.includes('\n');

        return (
          <div className={`detail-field detail-field-notes${isNoteMultiline ? ' detail-field-notes--multiline' : ''}`}>
            <div className="detail-label">{t('label.note')}</div>
            <div
              className={`detail-value-box${isNoteMultiline ? ' detail-value-multiline' : ''}`}
              onContextMenu={(e) => openPreviewMenu('note', e, true)}
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

      {hasFolderName && (
        <div className="detail-field">
          <div className="detail-label">{t('label.folder')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openPreviewMenu('folder', e, true)}>
            <div className="detail-value-text">{folderName}</div>
          </div>
        </div>
      )}

      {hasTags && (
        <div className="detail-field">
          <div className="detail-label">{t('label.tags')}</div>
          <div className="detail-value-box" onContextMenu={(e) => openPreviewMenu('tags', e, true)}>
            <div className="detail-value-text">{card.tags?.join(', ')}</div>
          </div>
        </div>
      )}

      <div className="detail-field attachments-panel">
        <div className="attachments-header">
          <div className="attachments-title">
            <IconAttachment />
            <span>{t('attachments.title')}</span>
          </div>
          {!isTrashMode && (
            <button className="btn btn-secondary" type="button" onClick={detailActions.onAddAttachment}>
              {t('attachments.addFile')}
            </button>
          )}
        </div>
        <div className="attachments-body">
          {detailActions.attachments.length === 0 && (
            <div className="muted">{t('attachments.hint')}</div>
          )}
          {detailActions.attachments.map((attachment) => (
            <div key={attachment.id} className="attachment-row">
              <div className="attachment-info">
                <div className="attachment-name">{attachment.fileName}</div>
                <div className="attachment-meta">
                  {(attachment.mimeType ?? 'application/octet-stream') + ' / ' + formatSize(attachment.byteSize)}
                </div>
              </div>
              {!isTrashMode && (
                <div className="attachment-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => detailActions.onPreviewAttachment(attachment.id)}
                    aria-label={t('attachments.open')}
                  >
                    <IconPreview />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                      detailActions.onDownloadAttachment(attachment.id, attachment.fileName)
                    }
                    aria-label={t('attachments.download')}
                  >
                    <IconImport />
                  </button>
                  <button
                    className="icon-button icon-button-danger"
                    type="button"
                    onClick={() => setAttachmentToDelete(attachment.id)}
                    aria-label={t('attachments.delete')}
                  >
                    <IconDelete />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>

      {coreMenu && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={() => setCoreMenu(null)} />
          <div
            className="vault-actionmenu-panel vault-contextmenu-panel"
            role="menu"
            style={
              {
                '--menu-x': `${coreMenu.x}px`,
                '--menu-y': `${coreMenu.y}px`,
              } as React.CSSProperties
            }
            >
              <button
                className="vault-actionmenu-item"
                type="button"
                onClick={() => toggleCoreFieldHidden(coreMenu.field)}
              >
                {isCoreFieldHidden(coreMenu.field) ? t('coreMenu.showInList') : t('coreMenu.hideInList')}
              </button>
            </div>
          </>
        )}

      {previewMenu && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={() => setPreviewMenu(null)} />
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
              <button
                className="vault-actionmenu-item"
                type="button"
                onClick={() => togglePreviewFieldForCard(previewMenu.field)}
              >
                {isFieldInCardPreview(previewMenu.field) ? t('previewMenu.hideThis') : t('previewMenu.showThis')}
              </button>

              {previewMenu.allowGlobal && !isCustomPreviewField(previewMenu.field) && (
                <>
                  <div className="vault-actionmenu-separator" />

                  <button
                    className="vault-actionmenu-item"
                    type="button"
                    onClick={() => {
                      if (isCustomPreviewField(previewMenu.field)) return;
                      togglePreviewFieldForAllCards(previewMenu.field);
                    }}
                  >
                    {isFieldInGlobalPreview(previewMenu.field)
                      ? t('previewMenu.hideAll')
                      : t('previewMenu.showAll')}
                  </button>
                </>
              )}
            </div>
          </>
        )}

      {seedPhraseViewOpen && (
        <Suspense fallback={null}>
          <LazySeedPhraseViewModal
            isOpen={seedPhraseViewOpen}
            phrase={seedPhraseRaw}
            wordCount={
              seedPhraseWordCount === 12 || seedPhraseWordCount === 18 || seedPhraseWordCount === 24
                ? (seedPhraseWordCount as 12 | 18 | 24)
                : null
            }
            onClose={() => setSeedPhraseViewOpen(false)}
          />
        </Suspense>
      )}

      {detailActions.previewOpen && (
        <Suspense fallback={null}>
          <LazyAttachmentPreviewModal
            open={detailActions.previewOpen}
            fileName={previewTitle}
            mime={previewMimeType}
            objectUrl={previewObjectUrl}
            onClose={detailActions.closePreview}
            onDownload={previewDownloadHandler}
            loading={detailActions.isPreviewLoading}
          />
        </Suspense>
      )}
      {historyOpen && (
        <Suspense fallback={null}>
          <LazyPasswordHistoryDialog
            isOpen={historyOpen}
            datacardId={card.id}
            onClose={() => setHistoryOpen(false)}
            clipboardAutoClearEnabled={clipboardAutoClearEnabled}
            clipboardClearTimeoutSeconds={clipboardClearTimeoutSeconds}
          />
        </Suspense>
      )}
    </>
  );
}

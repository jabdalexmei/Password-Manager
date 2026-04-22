import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useCallback } from 'react';
import { Attachment, DataCard, Folder } from '../../types/ui';
import { useI18n, useTranslation } from '../../../../shared/lib/i18n';
import { useDetails } from './useDetails';
import { wasActuallyUpdated } from '../../utils/updatedAt';
import { IconCopy } from '@/shared/icons/lucide/icons';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../shared/ui/dialog';
import { useAttachmentsDrop } from './hooks/useAttachmentsDrop';
import { useTotpTicker } from './hooks/useTotpTicker';
import { usePreviewAndCoreMenus } from './hooks/usePreviewAndCoreMenus';
import {
  CONTENT_MASK,
  toCustomDetailContentField,
  type DataCardDetailContentField,
} from '../../lib/datacardDetailContentFields';
import {
  loadHiddenContentByCard,
  onHiddenContentByCardChanged,
  saveHiddenContentByCard,
} from '../../lib/datacardHiddenContentByCard';
import { FieldContextMenu } from './components/FieldContextMenu';
import { DetailContentVisibilityButton } from './components/DetailContentVisibilityButton';
import { MetaSection } from './sections/MetaSection';
import { CoreFieldsSection } from './sections/CoreFieldsSection';
import { SeedPhraseSection } from './sections/SeedPhraseSection';
import { TwoFactorSection } from './sections/TwoFactorSection';
import { CustomFieldsSection } from './sections/CustomFieldsSection';
import { AttachmentsSection } from './sections/AttachmentsSection';
import { formatVaultDateTime } from '../../utils/dateTime';
import type { BackendDateTimeFormat } from '../../types/backend';
import { CUSTOM_PREVIEW_PREFIX, isCustomPreviewField } from './lib/previewTokens';

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
  activeFolderId?: string | null;
  dateTimeFormat?: BackendDateTimeFormat;
  onEdit: (card: DataCard) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onAttachmentPresenceChange?: (cardId: string, hasAttachments: boolean) => void;
  onAttachmentsChange?: (cardId: string, attachments: Attachment[]) => void;
  onReloadCard?: (id: string) => void;
  isTrashMode: boolean;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
};

export function Details({
  card,
  folders,
  activeFolderId,
  dateTimeFormat,
  onEdit,
  onDelete,
  onRestore,
  onPurge,
  onToggleFavorite,
  onAttachmentPresenceChange,
  onAttachmentsChange,
  onReloadCard,
  isTrashMode,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
}: DetailsProps) {
  const { language } = useI18n();
  const { t } = useTranslation('Details');
  const { t: tVault } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const { t: tTip } = useTranslation('Tooltips');
  const effectiveDateTimeFormat = dateTimeFormat ?? 'auto';
  const detailActions = useDetails({
    card,
    onDelete,
    onEdit,
    onRestore,
    onPurge,
    onToggleFavorite,
    onAttachmentPresenceChange,
    onAttachmentsChange,
    isTrashMode,
    clipboardAutoClearEnabled,
    clipboardClearTimeoutSeconds,
  });

  const { attachmentsDropRef, isDragOver: isAttachmentsDragOver } = useAttachmentsDrop({
    cardId: card?.id,
    isTrashMode,
    onAddAttachmentsFromPick: detailActions.onAddAttachmentsFromPick,
  });

  const folderName = useMemo(() => {
    if (!card) return '';
    return card.folderId ? folders.find((folder) => folder.id === card.folderId)?.name ?? '' : '';
  }, [card, folders]);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<string | null>(null);
  const [renameAttachmentOpen, setRenameAttachmentOpen] = useState(false);
  const [renameAttachmentId, setRenameAttachmentId] = useState<string | null>(null);
  const [renameAttachmentValue, setRenameAttachmentValue] = useState('');
  const [isRenamingAttachment, setIsRenamingAttachment] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seedPhraseViewOpen, setSeedPhraseViewOpen] = useState(false);
  const [revealedCustomFields, setRevealedCustomFields] = useState<Record<string, boolean>>({});
  const [hiddenContentByCard, setHiddenContentByCard] = useState<Record<string, DataCardDetailContentField[]>>({});
  const [revealedConcealedContentFields, setRevealedConcealedContentFields] = useState<Record<string, boolean>>({});

  const totpData = useTotpTicker(card?.totpUri);

  const {
    previewMenu,
    coreMenu,
    setPreviewMenu,
    setCoreMenu,
    openPreviewMenu,
    openCoreMenu,
    canTogglePreviewFieldFolderOnly,
    toggleCoreFieldHidden,
    isCoreFieldHidden,
    togglePreviewFieldForCard,
    togglePreviewFieldForAllCards,
    togglePreviewFieldFolderOnlyForCurrentFolder,
    isFieldInCardPreview,
    isFieldInGlobalPreview,
    isFieldInFolderOnlyPreviewForCurrentFolder,
  } = usePreviewAndCoreMenus({ card, activeFolderId, onReloadCard });

  useEffect(() => {
    let isMounted = true;
    loadHiddenContentByCard().then((fieldsByCard) => {
      if (isMounted) {
        setHiddenContentByCard(fieldsByCard);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onHiddenContentByCardChanged(setHiddenContentByCard), []);

  useEffect(() => {
    setHistoryOpen(false);
  }, [card?.id]);

  useEffect(() => {
    setRevealedCustomFields({});
    setRevealedConcealedContentFields({});
  }, [card?.id]);

  const toggleCustomFieldVisibility = (fieldId: string) => {
    setRevealedCustomFields((prev) => ({
      ...prev,
      [fieldId]: !prev[fieldId],
    }));
  };

  const concealedFieldsForCurrentCard = useMemo(() => {
    if (!card?.id) return new Set<DataCardDetailContentField>();
    return new Set(hiddenContentByCard[card.id] ?? []);
  }, [card?.id, hiddenContentByCard]);

  const isContentConcealed = useCallback(
    (field: DataCardDetailContentField) => concealedFieldsForCurrentCard.has(field),
    [concealedFieldsForCurrentCard],
  );

  const isContentRevealed = useCallback(
    (field: DataCardDetailContentField) => Boolean(revealedConcealedContentFields[field]),
    [revealedConcealedContentFields],
  );

  const toggleContentReveal = useCallback((field: DataCardDetailContentField) => {
    setRevealedConcealedContentFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  }, []);

  const toggleContentFieldConcealed = useCallback(
    async (field: DataCardDetailContentField) => {
      if (!card?.id) return;

      const currentFields = hiddenContentByCard[card.id] ?? [];
      const nextFields = currentFields.includes(field)
        ? currentFields.filter((item) => item !== field)
        : [...currentFields, field];
      const nextHiddenContentByCard = { ...hiddenContentByCard };

      if (nextFields.length === 0) {
        delete nextHiddenContentByCard[card.id];
      } else {
        nextHiddenContentByCard[card.id] = nextFields;
      }

      setHiddenContentByCard(nextHiddenContentByCard);
      setRevealedConcealedContentFields((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });

      await saveHiddenContentByCard(nextHiddenContentByCard);
    },
    [card?.id, hiddenContentByCard],
  );

  const resolveCoreContentField = useCallback(
    (field: 'title' | 'url' | 'email'): DataCardDetailContentField => field,
    [],
  );

  const resolvePreviewContentField = useCallback(
    (field: string): DataCardDetailContentField | null => {
      if (
        field === 'recovery_email' ||
        field === 'username' ||
        field === 'mobile_phone' ||
        field === 'note' ||
        field === 'folder' ||
        field === 'tags'
      ) {
        return field;
      }

      if (!isCustomPreviewField(field)) {
        return null;
      }

      const customFieldId = field.slice(CUSTOM_PREVIEW_PREFIX.length);
      const customField = (card?.customFields ?? []).find((item) => item.id === customFieldId);
      if (!customField || customField.type === 'secret') {
        return null;
      }

      return toCustomDetailContentField(customField.id);
    },
    [card?.customFields],
  );

  const informationTitle = (
    <div className="datacards-header">
      <div className="vault-section-header">{tVault('details.title')}</div>

      <div className="datacards-header__right">
        <div className="datacards-header__spacer" aria-hidden="true" />
      </div>
    </div>
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
  const createdText = `${t('label.created')}: ${formatVaultDateTime(card.createdAt, effectiveDateTimeFormat, language)}`;
  const showUpdated = wasActuallyUpdated(card.createdAt, card.updatedAt);
  const updatedText = showUpdated
    ? `${t('label.updated')}: ${formatVaultDateTime(card.updatedAt, effectiveDateTimeFormat, language)}`
    : '';
  const hasValue = (value?: string | null) => Boolean(value?.trim());
  const hasNote = hasValue(card.note);
  const hasTags = Array.isArray(card.tags) && card.tags.length > 0;
  const hasFolderName = hasValue(folderName);
  const isFolderConcealed = isContentConcealed('folder');
  const isFolderRevealed = isContentRevealed('folder');
  const folderDisplay = isFolderConcealed && !isFolderRevealed ? CONTENT_MASK : folderName;
  const isTagsConcealed = isContentConcealed('tags');
  const areTagsRevealed = isContentRevealed('tags');
  const tagsDisplay = isTagsConcealed && !areTagsRevealed ? CONTENT_MASK : card.tags?.join(', ');
  const seedPhraseRaw = hasValue(card.seedPhrase) ? (card.seedPhrase as string) : null;
  const seedPhraseWordCount =
    typeof card.seedPhraseWordCount === 'number' && card.seedPhraseWordCount > 0
      ? card.seedPhraseWordCount
      : seedPhraseRaw
        ? seedPhraseRaw.trim().split(/\s+/).filter(Boolean).length
        : 0;

  const previewMimeType = detailActions.previewPayload?.mimeType ?? '';
  const previewTitle = detailActions.previewPayload?.fileName ?? '';
  const previewObjectUrl = detailActions.previewPayload?.objectUrl ?? '';
  const previewDownloadHandler = detailActions.previewPayload
    ? () => detailActions.onDownloadAttachment(detailActions.previewPayload!.attachmentId, detailActions.previewPayload!.fileName)
    : undefined;

  return (
    <>
      <div className="vault-panel-wrapper">
        {informationTitle}
        <div className="vault-detail-card">
          <MetaSection
            createdText={createdText}
            updatedText={updatedText}
            showUpdated={showUpdated}
            isTrashMode={isTrashMode}
            isFavorite={isFavorite}
            onToggleFavorite={detailActions.toggleFavorite}
            onEdit={detailActions.editCard}
            onOpenDeleteConfirm={() => setDeleteConfirmOpen(true)}
            onRestore={detailActions.restoreCard}
            onOpenPurgeConfirm={() => setPurgeConfirmOpen(true)}
            t={t}
          />

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
            title={t('dialog.delete.title')}
            description={tCommon('dialog.delete.permanentMessage')}
            confirmLabel={t('dialog.delete.confirm')}
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
                void detailActions.onDeleteAttachment(attachmentToDelete);
              }
              setAttachmentToDelete(null);
            }}
            onCancel={() => setAttachmentToDelete(null)}
          />

          <Dialog
            open={renameAttachmentOpen}
            onOpenChange={(nextOpen) => {
              if (isRenamingAttachment) return;
              if (!nextOpen) {
                setRenameAttachmentOpen(false);
                setRenameAttachmentId(null);
              }
            }}
          >
            <DialogContent aria-labelledby="rename-attachment-title">
              <DialogHeader>
                <DialogTitle id="rename-attachment-title">{t('attachments.renameTitle')}</DialogTitle>
              </DialogHeader>

              <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-field">
                  <label className="form-label" htmlFor="rename-attachment-input">
                    {t('attachments.renameLabel')}
                  </label>
                  <input
                    id="rename-attachment-input"
                    type="text"
                    value={renameAttachmentValue}
                    disabled={isRenamingAttachment}
                    onChange={(event) => setRenameAttachmentValue(event.target.value)}
                    autoComplete="off"
                    className="input"
                  />
                </div>
              </div>

              <DialogFooter className="dialog-footer--split">
                <div className="dialog-footer-left">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => {
                      setRenameAttachmentOpen(false);
                      setRenameAttachmentId(null);
                    }}
                    disabled={isRenamingAttachment}
                  >
                    {tCommon('action.cancel')}
                  </button>
                </div>

                <div className="dialog-footer-right">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={async () => {
                      if (!renameAttachmentId) return;
                      setIsRenamingAttachment(true);
                      const ok = await detailActions.onRenameAttachment(renameAttachmentId, renameAttachmentValue);
                      setIsRenamingAttachment(false);
                      if (ok) {
                        setRenameAttachmentOpen(false);
                        setRenameAttachmentId(null);
                      }
                    }}
                    disabled={isRenamingAttachment || !renameAttachmentId || !renameAttachmentValue.trim()}
                  >
                    {t('attachments.renameConfirm')}
                  </button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <CoreFieldsSection
            card={card}
            detailActions={detailActions}
            onOpenCoreMenu={openCoreMenu}
            onOpenPreviewMenu={openPreviewMenu}
            onOpenHistory={() => setHistoryOpen(true)}
            isContentConcealed={isContentConcealed}
            isContentRevealed={isContentRevealed}
            onToggleContentReveal={toggleContentReveal}
            t={t}
          />

          <SeedPhraseSection seedPhraseWordCount={seedPhraseWordCount} onOpen={() => setSeedPhraseViewOpen(true)} t={t} />

          <TwoFactorSection totpUri={card.totpUri} totpData={totpData} detailActions={detailActions} t={t} />

          <CustomFieldsSection
            customFields={card.customFields ?? []}
            revealedCustomFields={revealedCustomFields}
            onToggleCustomFieldVisibility={toggleCustomFieldVisibility}
            detailActions={detailActions}
            onOpenPreviewMenu={openPreviewMenu}
            isContentConcealed={isContentConcealed}
            isContentRevealed={isContentRevealed}
            onToggleContentReveal={toggleContentReveal}
            t={t}
          />

          {hasNote && (() => {
            const noteText = card.note ?? '';
            const isNoteMultiline = noteText.includes('\n');
            const isNoteConcealed = isContentConcealed('note');
            const isNoteRevealed = isContentRevealed('note');
            const noteDisplay = isNoteConcealed && !isNoteRevealed ? CONTENT_MASK : noteText;
            const isDisplayedNoteMultiline = !isNoteConcealed || isNoteRevealed ? isNoteMultiline : false;

            return (
              <div
                className={`detail-field detail-field-notes${isDisplayedNoteMultiline ? ' detail-field-notes--multiline' : ''}`}
              >
                <div className="detail-label">{t('label.note')}</div>
                <div
                  className={`detail-value-box${isDisplayedNoteMultiline ? ' detail-value-multiline' : ''}`}
                  onContextMenu={(event) => openPreviewMenu('note', event, true)}
                >
                  <div className={`detail-value-text${isDisplayedNoteMultiline ? ' detail-value-text-multiline' : ''}`}>
                    {noteDisplay}
                  </div>
                  <div className="detail-value-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={t('action.copy')}
                      title={tTip('action.copy')}
                      onClick={() => detailActions.copyToClipboard(noteText)}
                    >
                      <IconCopy />
                    </button>
                    {isNoteConcealed && (
                      <DetailContentVisibilityButton
                        isRevealed={isNoteRevealed}
                        onToggle={() => toggleContentReveal('note')}
                        t={t}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {hasFolderName && (
            <div className="detail-field">
              <div className="detail-label">{t('label.folder')}</div>
              <div className="detail-value-box" onContextMenu={(event) => openPreviewMenu('folder', event, true)}>
                <div className="detail-value-text">{folderDisplay}</div>
                {isFolderConcealed && (
                  <div className="detail-value-actions">
                    <DetailContentVisibilityButton
                      isRevealed={isFolderRevealed}
                      onToggle={() => toggleContentReveal('folder')}
                      t={t}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {hasTags && (
            <div className="detail-field">
              <div className="detail-label">{t('label.tags')}</div>
              <div className="detail-value-box" onContextMenu={(event) => openPreviewMenu('tags', event, true)}>
                <div className="detail-value-text">{tagsDisplay}</div>
                {isTagsConcealed && (
                  <div className="detail-value-actions">
                    <DetailContentVisibilityButton
                      isRevealed={areTagsRevealed}
                      onToggle={() => toggleContentReveal('tags')}
                      t={t}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <AttachmentsSection
            attachments={detailActions.attachments}
            isTrashMode={isTrashMode}
            isDragOver={isAttachmentsDragOver}
            attachmentsDropRef={attachmentsDropRef}
            onAddAttachment={detailActions.onAddAttachment}
            onPreviewAttachment={detailActions.onPreviewAttachment}
            onDownloadAttachment={detailActions.onDownloadAttachment}
            onRequestRename={(attachmentId, name) => {
              setRenameAttachmentId(attachmentId);
              setRenameAttachmentValue(name);
              setRenameAttachmentOpen(true);
            }}
            onRequestDelete={setAttachmentToDelete}
            t={t}
          />
        </div>
      </div>

      <FieldContextMenu
        coreMenu={coreMenu}
        previewMenu={previewMenu}
        closeCoreMenu={() => setCoreMenu(null)}
        closePreviewMenu={() => setPreviewMenu(null)}
        toggleCoreFieldHidden={toggleCoreFieldHidden}
        isCoreFieldHidden={isCoreFieldHidden}
        togglePreviewFieldForCard={togglePreviewFieldForCard}
        togglePreviewFieldForAllCards={togglePreviewFieldForAllCards}
        togglePreviewFieldFolderOnlyForCurrentFolder={togglePreviewFieldFolderOnlyForCurrentFolder}
        isFieldInCardPreview={isFieldInCardPreview}
        isFieldInGlobalPreview={isFieldInGlobalPreview}
        isFieldInFolderOnlyPreviewForCurrentFolder={isFieldInFolderOnlyPreviewForCurrentFolder}
        canTogglePreviewFieldFolderOnly={canTogglePreviewFieldFolderOnly}
        resolveCoreContentField={resolveCoreContentField}
        resolvePreviewContentField={resolvePreviewContentField}
        isContentFieldConcealed={isContentConcealed}
        toggleContentFieldConcealed={toggleContentFieldConcealed}
        t={t}
      />

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
            dateTimeFormat={effectiveDateTimeFormat}
            clipboardAutoClearEnabled={clipboardAutoClearEnabled}
            clipboardClearTimeoutSeconds={clipboardClearTimeoutSeconds}
          />
        </Suspense>
      )}
    </>
  );
}

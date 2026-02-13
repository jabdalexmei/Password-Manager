import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { DataCard, Folder } from '../../types/ui';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useDetails } from './useDetails';
import { wasActuallyUpdated } from '../../utils/updatedAt';
import { IconCopy } from '@/shared/icons/lucide/icons';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../shared/ui/dialog';
import { useAttachmentsDrop } from './hooks/useAttachmentsDrop';
import { useTotpTicker } from './hooks/useTotpTicker';
import { usePreviewAndCoreMenus } from './hooks/usePreviewAndCoreMenus';
import { FieldContextMenu } from './components/FieldContextMenu';
import { MetaSection } from './sections/MetaSection';
import { CoreFieldsSection } from './sections/CoreFieldsSection';
import { SeedPhraseSection } from './sections/SeedPhraseSection';
import { TwoFactorSection } from './sections/TwoFactorSection';
import { CustomFieldsSection } from './sections/CustomFieldsSection';
import { AttachmentsSection } from './sections/AttachmentsSection';

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

export function Details({
  card,
  folders,
  activeFolderId,
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

  const { attachmentsDropRef, isDragOver: isAttachmentsDragOver } = useAttachmentsDrop({
    cardId: card?.id,
    isTrashMode,
    onAddAttachmentsFromPaths: detailActions.onAddAttachmentsFromPaths,
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
    setHistoryOpen(false);
  }, [card?.id]);

  useEffect(() => {
    setRevealedCustomFields({});
  }, [card?.id]);

  const toggleCustomFieldVisibility = (fieldId: string) => {
    setRevealedCustomFields((prev) => ({
      ...prev,
      [fieldId]: !prev[fieldId],
    }));
  };

  const informationTitle = (
    <div className="datacards-header">
      <div className="vault-section-header">{tVault('information.title')}</div>

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
  const createdText = `${t('label.created')}: ${new Date(card.createdAt).toLocaleString()}`;
  const showUpdated = wasActuallyUpdated(card.createdAt, card.updatedAt);
  const updatedText = showUpdated ? `${t('label.updated')}: ${new Date(card.updatedAt).toLocaleString()}` : '';
  const hasValue = (value?: string | null) => Boolean(value?.trim());
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
            t={t}
          />

          {hasNote && (() => {
            const noteText = card.note ?? '';
            const isNoteMultiline = noteText.includes('\n');

            return (
              <div className={`detail-field detail-field-notes${isNoteMultiline ? ' detail-field-notes--multiline' : ''}`}>
                <div className="detail-label">{t('label.note')}</div>
                <div
                  className={`detail-value-box${isNoteMultiline ? ' detail-value-multiline' : ''}`}
                  onContextMenu={(event) => openPreviewMenu('note', event, true)}
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
              <div className="detail-value-box" onContextMenu={(event) => openPreviewMenu('folder', event, true)}>
                <div className="detail-value-text">{folderName}</div>
              </div>
            </div>
          )}

          {hasTags && (
            <div className="detail-field">
              <div className="detail-label">{t('label.tags')}</div>
              <div className="detail-value-box" onContextMenu={(event) => openPreviewMenu('tags', event, true)}>
                <div className="detail-value-text">{card.tags?.join(', ')}</div>
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
            clipboardAutoClearEnabled={clipboardAutoClearEnabled}
            clipboardClearTimeoutSeconds={clipboardClearTimeoutSeconds}
          />
        </Suspense>
      )}
    </>
  );
}


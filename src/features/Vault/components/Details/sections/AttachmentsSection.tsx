import React from 'react';
import { IconAttachment, IconDelete, IconImport, IconPreview, IconRename } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import type { Attachment } from '../../../types/ui';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type AttachmentsSectionProps = {
  attachments: Attachment[];
  isTrashMode: boolean;
  isDragOver: boolean;
  attachmentsDropRef: React.RefObject<HTMLDivElement | null>;
  onAddAttachment: () => Promise<void>;
  onPreviewAttachment: (attachmentId: string) => Promise<void>;
  onDownloadAttachment: (attachmentId: string, defaultName: string) => Promise<void>;
  onRequestRename: (attachmentId: string, name: string) => void;
  onRequestDelete: (attachmentId: string) => void;
  t: TranslateFn;
};

export function AttachmentsSection({
  attachments,
  isTrashMode,
  isDragOver,
  attachmentsDropRef,
  onAddAttachment,
  onPreviewAttachment,
  onDownloadAttachment,
  onRequestRename,
  onRequestDelete,
  t,
}: AttachmentsSectionProps) {
  const { t: tTip } = useTranslation('Tooltips');
  return (
    <div className="detail-field attachments-panel">
      <div className="attachments-header">
        <div className="attachments-title">
          <IconAttachment />
          <span>{t('attachments.title')}</span>
        </div>
        {!isTrashMode && (
          <button className="btn btn-secondary" type="button" onClick={onAddAttachment}>
            {t('attachments.addFile')}
          </button>
        )}
      </div>
      <div ref={attachmentsDropRef} className={`attachments-body${isDragOver ? ' drag-over' : ''}`}>
        {attachments.length === 0 && <div className="muted">{t('attachments.hint')}</div>}
        {attachments.map((attachment) => (
          <div key={attachment.id} className="attachment-row">
            <div className="attachment-info">
              <div className="attachment-name">{attachment.fileName}</div>
            </div>
            {!isTrashMode && (
              <div className="attachment-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onPreviewAttachment(attachment.id)}
                  aria-label={t('attachments.open')}
                  title={tTip('action.open')}
                >
                  <IconPreview />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onRequestRename(attachment.id, attachment.fileName)}
                  aria-label={t('attachments.rename')}
                  title={tTip('action.rename')}
                >
                  <IconRename />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onDownloadAttachment(attachment.id, attachment.fileName)}
                  aria-label={t('attachments.download')}
                  title={tTip('action.download')}
                >
                  <IconImport />
                </button>
                <button
                  className="icon-button icon-button-danger"
                  type="button"
                  onClick={() => onRequestDelete(attachment.id)}
                  aria-label={t('attachments.delete')}
                  title={tTip('action.delete')}
                >
                  <IconDelete />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

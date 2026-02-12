import React from 'react';
import { IconAttachment, IconDelete, IconImport, IconPreview, IconRename } from '@/shared/icons/lucide/icons';
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

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
              <div className="attachment-meta">
                {(attachment.mimeType ?? 'application/octet-stream') + ' / ' + formatSize(attachment.byteSize)}
              </div>
            </div>
            {!isTrashMode && (
              <div className="attachment-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onPreviewAttachment(attachment.id)}
                  aria-label={t('attachments.open')}
                >
                  <IconPreview />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onRequestRename(attachment.id, attachment.fileName)}
                  aria-label={t('attachments.rename')}
                  title={t('attachments.rename')}
                >
                  <IconRename />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onDownloadAttachment(attachment.id, attachment.fileName)}
                  aria-label={t('attachments.download')}
                >
                  <IconImport />
                </button>
                <button
                  className="icon-button icon-button-danger"
                  type="button"
                  onClick={() => onRequestDelete(attachment.id)}
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
  );
}

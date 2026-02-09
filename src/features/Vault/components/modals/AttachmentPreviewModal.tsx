import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';

interface AttachmentPreviewModalProps {
  open: boolean;
  fileName: string;
  mime: string;
  objectUrl: string;
  onClose: () => void;
  onDownload?: () => void;
  loading?: boolean;
}

export default function AttachmentPreviewModal({
  open,
  fileName,
  mime,
  objectUrl,
  onClose,
  onDownload,
  loading = false,
}: AttachmentPreviewModalProps) {
  const { t } = useTranslation('Details');
  const { t: tCommon } = useTranslation('Common');
  const [textContent, setTextContent] = useState<string | null>(null);

  const isImage = useMemo(() => mime?.startsWith('image/'), [mime]);
  const isPdf = useMemo(() => mime === 'application/pdf', [mime]);
  const isText = useMemo(() => mime?.startsWith('text/'), [mime]);

  useEffect(() => {
    if (open && isText && objectUrl) {
      fetch(objectUrl)
        .then((res) => res.text())
        .then(setTextContent)
        .catch(() => setTextContent(null));
    } else {
      setTextContent(null);
    }
  }, [isText, objectUrl, open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog preview-dialog" role="dialog" aria-modal="true">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onClose}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h3 className="dialog-title">{fileName || t('attachments.title')}</h3>
        </div>
        <div className="dialog-body attachment-preview-body">
          {loading && <div className="muted">{t('attachments.loadingPreview')}</div>}
          {!loading && isImage && <img className="attachment-preview-image" src={objectUrl} alt={fileName} />}
          {!loading && isPdf && (
            <iframe className="attachment-preview-pdf" src={objectUrl} title={fileName || 'PDF Preview'} />
          )}
          {!loading && isText && textContent && <pre className="attachment-preview-text">{textContent}</pre>}
          {!loading && !isImage && !isPdf && !isText && (
            <div className="attachment-preview-unsupported">
              <div className="muted">{t('attachments.previewUnsupported')}</div>
              {onDownload && (
                <button className="btn btn-secondary" type="button" onClick={onDownload}>
                  {t('attachments.download')}
                </button>
              )}
            </div>
          )}
          {!loading && isText && !textContent && (
            <div className="muted">{t('attachments.previewError')}</div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {tCommon('action.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

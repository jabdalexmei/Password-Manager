import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import { clearPasswordHistory, getPasswordHistory } from '../../api/vaultApi';
import { PasswordHistoryEntry } from '../../types/ui';
import { IconCopy, IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { clipboardClearAll } from '../../../../shared/lib/tauri';

type PasswordHistoryDialogProps = {
  isOpen: boolean;
  datacardId: string;
  onClose: () => void;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
};

const MASKED_PASSWORD = '••••••••';

const formatTimestamp = (value: string) => new Date(value).toLocaleString();

const PasswordHistoryDialog: React.FC<PasswordHistoryDialogProps> = ({
  isOpen,
  datacardId,
  onClose,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
}) => {
  const { t } = useTranslation('Details');
  const { t: tCommon } = useTranslation('Common');
  const { show: showToast } = useToaster();
  const [items, setItems] = useState<PasswordHistoryEntry[]>([]);
  const [showPasswords, setShowPasswords] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopiedValueRef = useRef<string | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastCopiedValueRef.current = null;
  }, []);

  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  const loadHistory = useCallback(async () => {
    if (!datacardId) return;
    try {
      const rows = await getPasswordHistory(datacardId);
      setItems(rows);
    } catch (err) {
      console.error(err);
      showToast(tCommon('error.operationFailed'), 'error');
      setItems([]);
    }
  }, [datacardId, showToast, tCommon]);

  useEffect(() => {
    if (isOpen) {
      setShowPasswords(false);
      void loadHistory();
    } else {
      setItems([]);
    }
  }, [isOpen, datacardId, loadHistory]);

  const copyPassword = useCallback(
    async (value: string) => {
      const DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS = 20;
      if (!value || !value.trim()) return;
      clearPendingTimeout();

      try {
        await navigator.clipboard.writeText(value);
        showToast(t('toast.copySuccess'), 'success');

        const enabled = clipboardAutoClearEnabled ?? true;
        if (!enabled) return;

        lastCopiedValueRef.current = value;
        const timeoutMs = (clipboardClearTimeoutSeconds ?? DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS) * 1000;

        timeoutRef.current = window.setTimeout(async () => {
          try {
            const current = await navigator.clipboard.readText();
            if (current === lastCopiedValueRef.current) {
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
            timeoutRef.current = null;
            lastCopiedValueRef.current = null;
          }
        }, timeoutMs);
      } catch (err) {
        console.error(err);
        showToast(t('toast.copyError'), 'error');
        clearPendingTimeout();
      }
    },
    [clearPendingTimeout, clipboardAutoClearEnabled, clipboardClearTimeoutSeconds, showToast, t]
  );

  const handleClearHistory = useCallback(async () => {
    if (!datacardId) return;
    try {
      await clearPasswordHistory(datacardId);
      setItems([]);
    } catch (err) {
      console.error(err);
      showToast(tCommon('error.operationFailed'), 'error');
    } finally {
      setConfirmOpen(false);
    }
  }, [datacardId, showToast, tCommon]);

  const historyContent = useMemo(() => {
    if (!items.length) {
      return <div className="muted">{t('label.passwordHistoryEmpty')}</div>;
    }

    return (
      <div className="password-history-list">
        {items.map((entry) => (
          <div key={entry.id} className="password-history-row">
            <div className="password-history-meta">{formatTimestamp(entry.createdAt)}</div>
            <div className="password-history-value">{showPasswords ? entry.passwordValue : MASKED_PASSWORD}</div>
            <div className="password-history-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => void copyPassword(entry.passwordValue)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }, [copyPassword, items, showPasswords, t]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="password-history-title">
          <button
            className="dialog-close dialog-close--topright"
            type="button"
            aria-label={tCommon('action.close')}
            onClick={onClose}
          >
            {'\u00D7'}
          </button>
          <div className="dialog-header">
            <h2 id="password-history-title" className="dialog-title">
              {t('dialog.passwordHistoryTitle')}
            </h2>
          </div>

          <div className="dialog-body password-history-body">
            <div className="password-history-controls">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setShowPasswords((prev) => !prev)}
                aria-label={showPasswords ? t('action.hide') : t('action.reveal')}
              >
                {showPasswords ? <IconPreviewOff /> : <IconPreview />}
                <span>{showPasswords ? t('action.hide') : t('action.reveal')}</span>
              </button>
            </div>
            {historyContent}
          </div>

          <div className="dialog-footer">
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              {tCommon('action.cancel')}
            </button>
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!items.length}
            >
              {t('action.clearHistory')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('dialog.passwordHistoryTitle')}
        description={t('dialog.clearHistoryConfirm')}
        confirmLabel={t('action.clearHistory')}
        cancelLabel={tCommon('action.cancel')}
        onConfirm={handleClearHistory}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
};

export default PasswordHistoryDialog;

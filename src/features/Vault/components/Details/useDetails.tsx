import { useCallback, useEffect, useRef, useState } from 'react';
import { Attachment, DataCard } from '../../types/ui';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import { clipboardClearAll } from '../../../../shared/lib/tauri';
import {
  addAttachmentsViaDialog,
  getAttachmentBytesBase64,
  listAttachments,
  removeAttachment,
  saveAttachmentViaDialog,
} from '../../api/vaultApi';
import { mapAttachmentFromBackend } from '../../types/mappers';

const DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS = 20;

type UseDetailsParams = {
  card: DataCard | null;
  onEdit: (card: DataCard) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onAttachmentPresenceChange?: (cardId: string, hasAttachments: boolean) => void;
  isTrashMode: boolean;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
};

type UseDetailsResult = {
  showPassword: boolean;
  togglePasswordVisibility: () => void;
  copyToClipboard: (value: string | null | undefined, opts?: { isSecret?: boolean }) => Promise<void>;
  deleteCard: () => void;
  editCard: () => void;
  toggleFavorite: () => void;
  restoreCard: () => void;
  purgeCard: () => void;
  attachments: Attachment[];
  onAddAttachment: () => Promise<void>;
  onDeleteAttachment: (attachmentId: string) => Promise<void>;
  onPreviewAttachment: (attachmentId: string) => Promise<void>;
  onDownloadAttachment: (attachmentId: string, defaultName: string) => Promise<void>;
  previewOpen: boolean;
  closePreview: () => void;
  previewPayload: AttachmentPreviewState;
  isPreviewLoading: boolean;
};

type AttachmentPreviewState = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  objectUrl: string;
} | null;

export function useDetails({
  card,
  onEdit,
  onDelete,
  onToggleFavorite,
  onRestore,
  onPurge,
  onAttachmentPresenceChange,
  isTrashMode,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
}: UseDetailsParams): UseDetailsResult {
  const [showPassword, setShowPassword] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopiedValueRef = useRef<string | null>(null);
  const { show: showToast } = useToaster();
  const { t } = useTranslation('Details');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<AttachmentPreviewState>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastCopiedValueRef.current = null;
  }, []);

  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  const base64ToBytes = useCallback((base64Data: string) => {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }, []);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const clearClipboardBestEffort = useCallback(async () => {
    try {
      const expected = lastCopiedValueRef.current;
      if (!expected) return;
      const currentClipboard = await navigator.clipboard.readText();
      if (currentClipboard === expected) {
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
  }, []);
  const refreshAttachments = useCallback(async () => {
    if (!card?.id) {
      setAttachments([]);
      return;
    }
    try {
      const items = await listAttachments(card.id);
      const mapped = items.map(mapAttachmentFromBackend);
      setAttachments(mapped);
      onAttachmentPresenceChange?.(card.id, mapped.length > 0);
    } catch (err) {
      console.error(err);
      setAttachments([]);
      onAttachmentPresenceChange?.(card.id, false);
      showToast(t('toast.attachmentLoadError'), 'error');
    }
  }, [card?.id, onAttachmentPresenceChange, showToast, t]);

  useEffect(() => {
    setShowPassword(false);
    clearPendingTimeout();
    refreshAttachments();
    setPreviewOpen(false);
    setPreviewPayload(null);
    revokePreviewUrl();
  }, [card?.id, clearPendingTimeout, refreshAttachments, revokePreviewUrl]);

  useEffect(() => revokePreviewUrl, [revokePreviewUrl]);

  const copyToClipboard = useCallback(
    async (value: string | null | undefined, opts: { isSecret?: boolean } = {}) => {
      if (!value || !value.trim()) return;
      clearPendingTimeout();
      try {
        await navigator.clipboard.writeText(value);
        showToast(t('toast.copySuccess'), 'success');
        const autoClearEnabled = clipboardAutoClearEnabled ?? true;
        if (opts.isSecret && autoClearEnabled) {
          lastCopiedValueRef.current = value;
          const timeoutMs = (clipboardClearTimeoutSeconds ?? DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS) * 1000;
          timeoutRef.current = window.setTimeout(() => {
            void clearClipboardBestEffort();
          }, timeoutMs);
        }
      } catch (err) {
        console.error(err);
        showToast(t('toast.copyError'), 'error');
        lastCopiedValueRef.current = null;
      }
    },
    [clearPendingTimeout, clearClipboardBestEffort, clipboardAutoClearEnabled, clipboardClearTimeoutSeconds, showToast, t]
  );

  const deleteCard = useCallback(() => {
    if (!card || isTrashMode) return;
    onDelete(card.id);
  }, [card, isTrashMode, onDelete]);

  const editCard = useCallback(() => {
    if (!card || isTrashMode) return;
    onEdit(card);
  }, [card, isTrashMode, onEdit]);

  const toggleFavorite = useCallback(() => {
    if (!card || isTrashMode) return;
    onToggleFavorite(card.id);
  }, [card, isTrashMode, onToggleFavorite]);

  const restoreCard = useCallback(() => {
    if (card) onRestore(card.id);
  }, [card, onRestore]);

  const purgeCard = useCallback(() => {
    if (card) onPurge(card.id);
  }, [card, onPurge]);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  const onAddAttachment = useCallback(async () => {
    if (!card || isTrashMode) return;
    try {
      const added = await addAttachmentsViaDialog(card.id);
      if (!added.length) return;
      await refreshAttachments();
      showToast(t('toast.attachmentAddSuccess'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('toast.attachmentAddError'), 'error');
    }
  }, [card, isTrashMode, refreshAttachments, showToast, t]);

  const onDeleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (!card) return;
      try {
        await removeAttachment(attachmentId);
        await refreshAttachments();
      } catch (err) {
        console.error(err);
        showToast(t('toast.attachmentRemoveError'), 'error');
      }
    },
    [card, refreshAttachments, showToast, t]
  );

  const onPreviewAttachment = useCallback(
    async (attachmentId: string) => {
      if (!card) return;
      setIsPreviewLoading(true);
      setPreviewOpen(true);
      setPreviewPayload(null);
      revokePreviewUrl();
      try {
        const payload = await getAttachmentBytesBase64(attachmentId);
        const bytes = base64ToBytes(payload.bytesBase64);
        const mimeType = payload.mimeType || 'application/octet-stream';
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        previewUrlRef.current = objectUrl;
        setPreviewPayload({
          attachmentId,
          fileName: payload.fileName,
          mimeType,
          objectUrl,
        });
      } catch (err: any) {
        console.error(err);
        const errorMessage = err?.code === 'ATTACHMENT_TOO_LARGE_FOR_PREVIEW'
          ? t('attachments.previewTooLarge')
          : t('attachments.previewError');
        showToast(errorMessage, 'error');
        setPreviewOpen(false);
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [base64ToBytes, card, revokePreviewUrl, showToast, t]
  );

  const onDownloadAttachment = useCallback(
    async (attachmentId: string, defaultName: string) => {
      if (!card) return;
      try {
        const ok = await saveAttachmentViaDialog(attachmentId);
        if (ok) showToast(t('attachments.downloadSuccess'), 'success');
      } catch (err) {
        console.error(err);
        showToast(t('attachments.downloadError'), 'error');
      }
    },
    [card, showToast, t]
  );

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewPayload(null);
    revokePreviewUrl();
  }, [revokePreviewUrl]);

  return {
    showPassword,
    togglePasswordVisibility,
    copyToClipboard,
    deleteCard,
    editCard,
    toggleFavorite,
    restoreCard,
    purgeCard,
    attachments,
    onAddAttachment,
    onDeleteAttachment,
    onPreviewAttachment,
    onDownloadAttachment,
    previewOpen,
    closePreview,
    previewPayload,
    isPreviewLoading,
  };
}

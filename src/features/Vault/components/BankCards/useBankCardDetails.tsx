import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import { BankCardItem } from '../../types/ui';
import { clipboardClearAll } from '../../../../shared/lib/tauri';

const DEFAULT_CLIPBOARD_CLEAR_TIMEOUT_SECONDS = 20;

type UseBankCardDetailsParams = {
  card: BankCardItem | null;
  onEdit: (card: BankCardItem) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  isTrashMode: boolean;
  clipboardAutoClearEnabled?: boolean;
  clipboardClearTimeoutSeconds?: number;
};

type UseBankCardDetailsResult = {
  showHolder: boolean;
  showNumber: boolean;
  showCvc: boolean;
  toggleHolderVisibility: () => void;
  toggleNumberVisibility: () => void;
  toggleCvcVisibility: () => void;
  copyToClipboard: (value: string | null | undefined, opts?: { isSecret?: boolean }) => Promise<void>;
  deleteCard: () => void;
  editCard: () => void;
  toggleFavorite: () => void;
  restoreCard: () => void;
  purgeCard: () => void;
};

export function useBankCardDetails({
  card,
  onEdit,
  onDelete,
  onToggleFavorite,
  onRestore,
  onPurge,
  isTrashMode,
  clipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
}: UseBankCardDetailsParams): UseBankCardDetailsResult {
  const [showHolder, setShowHolder] = useState(false);
  const [showNumber, setShowNumber] = useState(false);
  const [showCvc, setShowCvc] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopiedValueRef = useRef<string | null>(null);
  const { show: showToast } = useToaster();
  const { t } = useTranslation('BankCards');

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    lastCopiedValueRef.current = null;
  }, []);

  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  useEffect(() => {
    setShowHolder(false);
    setShowNumber(false);
    setShowCvc(false);
    clearPendingTimeout();
  }, [card?.id, clearPendingTimeout]);

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
          timeoutRef.current = window.setTimeout(async () => {
            try {
              const currentClipboard = await navigator.clipboard.readText();
              if (currentClipboard === lastCopiedValueRef.current) {
                await clipboardClearAll();
              }
            } catch (err) {
              console.error(err);
              try {
                await clipboardClearAll();
              } catch (wipeErr) {
                console.error(wipeErr);
              }
            }
            timeoutRef.current = null;
            lastCopiedValueRef.current = null;
          }, timeoutMs);
        }
      } catch (err) {
        console.error(err);
        showToast(t('toast.copyError'), 'error');
        lastCopiedValueRef.current = null;
      }
    },
    [clearPendingTimeout, clipboardAutoClearEnabled, clipboardClearTimeoutSeconds, showToast, t]
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

  const toggleNumberVisibility = useCallback(() => {
    setShowNumber((prev) => !prev);
  }, []);

  const toggleHolderVisibility = useCallback(() => {
    setShowHolder((prev) => !prev);
  }, []);

  const toggleCvcVisibility = useCallback(() => {
    setShowCvc((prev) => !prev);
  }, []);

  return {
    showHolder,
    showNumber,
    showCvc,
    toggleHolderVisibility,
    toggleNumberVisibility,
    toggleCvcVisibility,
    copyToClipboard,
    deleteCard,
    editCard,
    toggleFavorite,
    restoreCard,
    purgeCard,
  };
}

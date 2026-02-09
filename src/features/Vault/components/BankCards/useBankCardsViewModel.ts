import { useCallback, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { BankCardItem, BankCardSummary, CreateBankCardInput, UpdateBankCardInput } from '../../types/ui';

export type BankCardFieldErrorKey = 'title' | 'expiryMmYy' | 'cvc';
export type BankCardFieldErrors = Partial<Record<BankCardFieldErrorKey, string>>;

export type BankCardFormState = {
  folderId: string | null;
  title: string;
  bankName: string;
  holder: string;
  number: string;
  expiryMmYy: string;
  cvc: string;
  note: string;
  tagsText: string;
};

type UseBankCardsParams = {
  cards: BankCardSummary[];
  defaultFolderId: string | null;
  selectedCardId: string | null;
  isTrashMode: boolean;
  onSelectCard: (id: string | null) => void;
  onToggleFavorite: (id: string) => Promise<void> | void;
  onToggleArchive: (id: string) => Promise<void> | void;
  onCreateCard: (input: CreateBankCardInput) => Promise<BankCardItem | void | null>;
  onUpdateCard: (input: UpdateBankCardInput) => Promise<boolean>;
  onDeleteCard: (id: string) => Promise<void> | void;
  onRestoreCard: (id: string) => Promise<void> | void;
  onPurgeCard: (id: string) => Promise<void> | void;
  onRestoreAllTrash?: () => Promise<void> | void;
  onPurgeAllTrash?: () => Promise<void> | void;
};

export type BankCardsViewModel = {
  cards: BankCardSummary[];
  selectedCardId: string | null;
  isTrashMode: boolean;
  selectCard: (id: string) => void;
  toggleFavorite: (id: string) => Promise<void> | void;
  toggleArchive: (id: string) => Promise<void> | void;
  deleteCard: (id: string) => void;
  restoreCard: (id: string) => void;
  purgeCard: (id: string) => void;
  restoreAllTrash: () => Promise<void>;
  purgeAllTrash: () => Promise<void>;
  isTrashBulkSubmitting: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openEditModal: (card: BankCardItem) => void;
  closeEditModal: () => void;
  isCreateOpen: boolean;
  isEditOpen: boolean;
  createForm: BankCardFormState;
  editForm: BankCardFormState | null;
  createErrors: BankCardFieldErrors;
  editErrors: BankCardFieldErrors;
  isCreateSubmitting: boolean;
  isEditSubmitting: boolean;
  updateCreateField: (field: keyof BankCardFormState, value: string) => void;
  updateEditField: (field: keyof BankCardFormState, value: string) => void;
  submitCreate: () => Promise<void>;
  submitEdit: () => Promise<void>;
};

const normalizeOptional = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const normalizeTags = (value: string) => {
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const tagSet = new Set(tags);

  return Array.from(tagSet);
};

const buildCreateInput = (form: BankCardFormState): CreateBankCardInput => ({
  folderId: form.folderId,
  title: form.title.trim(),
  bankName: normalizeOptional(form.bankName),
  holder: normalizeOptional(form.holder),
  number: normalizeOptional(form.number),
  expiryMmYy: normalizeOptional(form.expiryMmYy),
  cvc: normalizeOptional(form.cvc),
  note: normalizeOptional(form.note),
  tags: normalizeTags(form.tagsText),
});

const buildUpdateInput = (form: BankCardFormState, id: string): UpdateBankCardInput => ({
  id,
  ...buildCreateInput(form),
});

const buildInitialForm = (defaultFolderId: string | null): BankCardFormState => ({
  folderId: defaultFolderId,
  title: '',
  bankName: '',
  holder: '',
  number: '',
  expiryMmYy: '',
  cvc: '',
  note: '',
  tagsText: '',
});

const EXPIRY_RE = /^(0[1-9]|1[0-2])\/\d{2}$/;
const CVC_RE = /^\d{3,4}$/;

const formatExpiryMmYy = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

const formatCvc = (raw: string) => raw.replace(/\D/g, '').slice(0, 4);

const formatCardNumber = (raw: string) => raw.replace(/\D/g, '');

export function useBankCardsViewModel({
  cards,
  defaultFolderId,
  selectedCardId,
  isTrashMode,
  onSelectCard,
  onToggleFavorite,
  onToggleArchive,
  onCreateCard,
  onUpdateCard,
  onDeleteCard,
  onRestoreCard,
  onPurgeCard,
  onRestoreAllTrash,
  onPurgeAllTrash,
}: UseBankCardsParams): BankCardsViewModel {
  const { t } = useTranslation('BankCards');
  const [createForm, setCreateForm] = useState<BankCardFormState>(() => buildInitialForm(defaultFolderId));
  const [editForm, setEditForm] = useState<BankCardFormState | null>(null);
  const [editCardId, setEditCardId] = useState<string | null>(null);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isEditOpen, setEditOpen] = useState(false);
  const [createErrors, setCreateErrors] = useState<BankCardFieldErrors>({});
  const [editErrors, setEditErrors] = useState<BankCardFieldErrors>({});
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [isTrashBulkSubmitting, setIsTrashBulkSubmitting] = useState(false);

  const resetCreateForm = useCallback(() => {
    setCreateForm(buildInitialForm(defaultFolderId));
  }, [defaultFolderId]);

  const resetEditForm = useCallback(() => {
    setEditForm(null);
    setEditCardId(null);
    setEditErrors({});
  }, []);

  const openCreateModal = useCallback(() => {
    resetCreateForm();
    setCreateErrors({});
    setCreateOpen(true);
  }, [resetCreateForm]);

  const closeCreateModal = useCallback(() => {
    setCreateOpen(false);
    setCreateErrors({});
    resetCreateForm();
  }, [resetCreateForm]);

  const openEditModal = useCallback((card: BankCardItem) => {
    setEditForm({
      folderId: card.folderId ?? null,
      title: card.title ?? '',
      bankName: card.bankName ?? '',
      holder: card.holder ?? '',
      number: card.number ?? '',
      expiryMmYy: card.expiryMmYy ?? '',
      cvc: card.cvc ?? '',
      note: card.note ?? '',
      tagsText: (card.tags ?? []).join(', '),
    });
    setEditCardId(card.id);
    setEditErrors({});
    setEditOpen(true);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditOpen(false);
    resetEditForm();
  }, [resetEditForm]);

  const updateCreateField = useCallback((field: keyof BankCardFormState, value: string) => {
    if (field === 'folderId') {
      setCreateForm((prev) => ({ ...prev, folderId: value === '' ? null : value }));
      return;
    }

    const nextValue =
      field === 'expiryMmYy'
        ? formatExpiryMmYy(value)
        : field === 'cvc'
          ? formatCvc(value)
          : field === 'number'
            ? formatCardNumber(value)
            : value;
    setCreateForm((prev) => ({ ...prev, [field]: nextValue }));
    if (field === 'title' || field === 'expiryMmYy' || field === 'cvc') {
      setCreateErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, []);

  const updateEditField = useCallback((field: keyof BankCardFormState, value: string) => {
    if (field === 'folderId') {
      setEditForm((prev) => (prev ? { ...prev, folderId: value === '' ? null : value } : prev));
      return;
    }

    const nextValue =
      field === 'expiryMmYy'
        ? formatExpiryMmYy(value)
        : field === 'cvc'
          ? formatCvc(value)
          : field === 'number'
            ? formatCardNumber(value)
            : value;
    setEditForm((prev) => (prev ? { ...prev, [field]: nextValue } : prev));
    if (field === 'title' || field === 'expiryMmYy' || field === 'cvc') {
      setEditErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, []);

  const submitCreate = useCallback(async () => {
    if (isCreateSubmitting) return;
    setCreateErrors({});
    const nextErrors: BankCardFieldErrors = {};

    const expiry = createForm.expiryMmYy.trim();
    if (expiry.length > 0 && !EXPIRY_RE.test(expiry)) {
      nextErrors.expiryMmYy = t('validation.expiryInvalid');
    }

    const cvc = createForm.cvc.trim();
    if (cvc.length > 0 && !CVC_RE.test(cvc)) {
      nextErrors.cvc = t('validation.cvcInvalid');
    }

    if (Object.keys(nextErrors).length > 0) {
      setCreateErrors(nextErrors);
      return;
    }
    setIsCreateSubmitting(true);
    try {
      const created = await onCreateCard(buildCreateInput(createForm));
      if (!created) return;
      setCreateOpen(false);
      resetCreateForm();
    } catch {
      // Intentionally ignore. Errors should be surfaced by the caller (toast) if needed.
    } finally {
      setIsCreateSubmitting(false);
    }
  }, [createForm, isCreateSubmitting, onCreateCard, resetCreateForm, t]);

  const submitEdit = useCallback(async () => {
    if (isEditSubmitting || !editForm || !editCardId) return;
    setEditErrors({});
    const nextErrors: BankCardFieldErrors = {};

    const expiry = editForm.expiryMmYy.trim();
    if (expiry.length > 0 && !EXPIRY_RE.test(expiry)) {
      nextErrors.expiryMmYy = t('validation.expiryInvalid');
    }

    const cvc = editForm.cvc.trim();
    if (cvc.length > 0 && !CVC_RE.test(cvc)) {
      nextErrors.cvc = t('validation.cvcInvalid');
    }

    if (Object.keys(nextErrors).length > 0) {
      setEditErrors(nextErrors);
      return;
    }
    setIsEditSubmitting(true);
    try {
      const updated = await onUpdateCard(buildUpdateInput(editForm, editCardId));
      if (!updated) return;
      setEditOpen(false);
      resetEditForm();
    } catch {
      // Intentionally ignore. Errors should be surfaced by the caller (toast) if needed.
    } finally {
      setIsEditSubmitting(false);
    }
  }, [editCardId, editForm, isEditSubmitting, onUpdateCard, resetEditForm, t]);

  const selectCard = useCallback(
    (id: string) => {
      onSelectCard(id === selectedCardId ? null : id);
    },
    [onSelectCard, selectedCardId]
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      await onToggleFavorite(id);
    },
    [onToggleFavorite]
  );

  const toggleArchive = useCallback(
    async (id: string) => {
      await onToggleArchive(id);
    },
    [onToggleArchive]
  );

  const deleteCard = useCallback(
    (id: string) => {
      if (isTrashMode) return;
      onDeleteCard(id);
    },
    [isTrashMode, onDeleteCard]
  );

  const restoreCard = useCallback(
    (id: string) => {
      if (!isTrashMode) return;
      onRestoreCard(id);
    },
    [isTrashMode, onRestoreCard]
  );

  const purgeCard = useCallback(
    (id: string) => {
      if (!isTrashMode) return;
      onPurgeCard(id);
    },
    [isTrashMode, onPurgeCard]
  );

  const restoreAllTrash = useCallback(async () => {
    if (!isTrashMode) return;
    if (!onRestoreAllTrash) return;
    if (isTrashBulkSubmitting) return;

    setIsTrashBulkSubmitting(true);
    try {
      await onRestoreAllTrash();
    } finally {
      setIsTrashBulkSubmitting(false);
    }
  }, [isTrashBulkSubmitting, isTrashMode, onRestoreAllTrash]);

  const purgeAllTrash = useCallback(async () => {
    if (!isTrashMode) return;
    if (!onPurgeAllTrash) return;
    if (isTrashBulkSubmitting) return;

    setIsTrashBulkSubmitting(true);
    try {
      await onPurgeAllTrash();
    } finally {
      setIsTrashBulkSubmitting(false);
    }
  }, [isTrashBulkSubmitting, isTrashMode, onPurgeAllTrash]);

  return {
    cards,
    selectedCardId,
    isTrashMode,
    selectCard,
    toggleFavorite,
    toggleArchive,
    deleteCard,
    restoreCard,
    purgeCard,
    restoreAllTrash,
    purgeAllTrash,
    isTrashBulkSubmitting,
    openCreateModal,
    closeCreateModal,
    openEditModal,
    closeEditModal,
    isCreateOpen,
    isEditOpen,
    createForm,
    editForm,
    createErrors,
    editErrors,
    isCreateSubmitting,
    isEditSubmitting,
    updateCreateField,
    updateEditField,
    submitCreate,
    submitEdit,
  };
}

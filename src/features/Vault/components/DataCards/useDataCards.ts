import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import { addAttachmentsFromPick, attachmentsDiscardPick, attachmentsPickFiles } from '../../api/vaultApi';
import {
  CreateDataCardInput,
  CustomField,
  CustomFieldType,
  DataCard,
  DataCardSummary,
  Folder,
  UpdateDataCardInput,
} from '../../types/ui';

type CustomFieldFormRow = {
  id: string;
  key: string;
  value: string;
  type: CustomFieldType;
};

export type DataCardFormState = {
  title: string;
  folderId: string | null;
  folderName: string;
  url: string;
  email: string;
  recoveryEmail: string;
  username: string;
  password: string;
  mobilePhone: string;
  note: string;
  tagsText: string;
  totpUri: string;
  seedPhrase: string;
  seedPhraseWordCount: number;
  customFields: CustomFieldFormRow[];
};

type UseDataCardsParams = {
  cards: DataCardSummary[];
  selectedCardId: string | null;
  isTrashMode: boolean;
  folders: Folder[];
  defaultFolderId: string | null;
  onSelectCard: (id: string) => void;
  onToggleFavorite: (id: string) => Promise<void> | void;
  onToggleArchive: (id: string) => Promise<void> | void;
  onCreateCard: (input: CreateDataCardInput) => Promise<DataCard | void | null>;
  onUploadAttachments: (cardId: string, paths: string[]) => Promise<string[]>;
  onUpdateCard: (input: UpdateDataCardInput) => Promise<boolean>;
  onDeleteCard: (id: string) => Promise<void> | void;
  onRestoreCard: (id: string) => Promise<void> | void;
  onPurgeCard: (id: string) => Promise<void> | void;
  onRestoreAllTrash?: () => Promise<void> | void;
  onPurgeAllTrash?: () => Promise<void> | void;
};

export type DataCardsViewModel = {
  cards: DataCardSummary[];
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
  openEditModal: (card: DataCard) => void;
  closeEditModal: () => void;
  isCreateOpen: boolean;
  isEditOpen: boolean;
  createForm: DataCardFormState;
  editForm: DataCardFormState | null;
  createError: string | null;
  editError: string | null;
  createFolderError: string | null;
  editFolderError: string | null;
  isCreateSubmitting: boolean;
  isEditSubmitting: boolean;
  updateCreateField: (field: keyof DataCardFormState, value: string | boolean | number | null) => void;
  updateEditField: (field: keyof DataCardFormState, value: string | boolean | number | null) => void;
  submitCreate: () => Promise<void>;
  submitEdit: () => Promise<void>;
  folders: Folder[];
  showPassword: boolean;
  togglePasswordVisibility: () => void;
  createAttachments: PendingAttachment[];
  pickCreateAttachments: () => Promise<void>;
  removeCreateAttachment: (id: string) => void;
  addCreateCustomFieldByName: (name: string) => { ok: true } | { ok: false; reason: 'EMPTY' | 'DUPLICATE' };
  updateCreateCustomFieldValue: (rowId: string, value: string) => void;
  renameCreateCustomFieldById: (
    rowId: string,
    nextName: string
  ) => { ok: true } | { ok: false; reason: 'EMPTY' | 'DUPLICATE' };
  removeCreateCustomFieldById: (rowId: string) => void;
  addEditCustomFieldByName: (name: string) => { ok: true } | { ok: false; reason: 'EMPTY' | 'DUPLICATE' };
  updateEditCustomFieldValue: (rowId: string, value: string) => void;
  renameEditCustomFieldById: (
    rowId: string,
    nextName: string
  ) => { ok: true } | { ok: false; reason: 'EMPTY' | 'DUPLICATE' };
  removeEditCustomFieldById: (rowId: string) => void;
  setCreateSeedPhrase: (phrase: string, words: number) => void;
  setEditSeedPhrase: (phrase: string, words: number) => void;
};

type PendingAttachment = {
  id: string;
  name: string;
  byteSize: number;
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

const makeRowId = () =>
  globalThis.crypto?.randomUUID?.() ?? `cf_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const buildCreateInput = (form: DataCardFormState): CreateDataCardInput => ({
  folderId: form.folderId,
  title: form.title.trim(),
  url: normalizeOptional(form.url),
  email: normalizeOptional(form.email),
  recoveryEmail: normalizeOptional(form.recoveryEmail),
  username: normalizeOptional(form.username),
  password: normalizeOptional(form.password),
  mobilePhone: normalizeOptional(form.mobilePhone),
  note: normalizeOptional(form.note),
  tags: normalizeTags(form.tagsText),
  totpUri: normalizeOptional(form.totpUri),
  seedPhrase: normalizeOptional(form.seedPhrase),
  seedPhraseWordCount: form.seedPhraseWordCount > 0 ? form.seedPhraseWordCount : null,
  customFields: form.customFields.map((row) => ({
    key: row.key,
    value: row.value,
    type: row.type,
  })),
});

const buildUpdateInput = (form: DataCardFormState, id: string): UpdateDataCardInput => ({
  id,
  ...buildCreateInput(form),
});

const buildInitialForm = (defaultFolderId: string | null, folderName: string): DataCardFormState => ({
  title: '',
  folderId: defaultFolderId,
  folderName,
  url: '',
  email: '',
  recoveryEmail: '',
  username: '',
  password: '',
  mobilePhone: '',
  note: '',
  tagsText: '',
  totpUri: '',
  seedPhrase: '',
  seedPhraseWordCount: 0,
  customFields: [],
});

const findFolderName = (folderId: string | null, folderList: Folder[]) => {
  if (!folderId) return '';
  return folderList.find((folder) => folder.id === folderId)?.name ?? '';
};

const findFolderIdByName = (name: string, folderList: Folder[]) => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const match = folderList.find((folder) => !folder.isSystem && folder.name.toLowerCase() === normalized);
  return match ? match.id : null;
};

export function useDataCards({
  cards,
  selectedCardId,
  isTrashMode,
  folders,
  defaultFolderId,
  onSelectCard,
  onToggleFavorite,
  onToggleArchive,
  onCreateCard,
  onUploadAttachments,
  onUpdateCard,
  onDeleteCard,
  onRestoreCard,
  onPurgeCard,
  onRestoreAllTrash,
  onPurgeAllTrash,
}: UseDataCardsParams): DataCardsViewModel {
  const { t } = useTranslation('DataCards');
  const { show: showToast } = useToaster();
  const [createForm, setCreateForm] = useState<DataCardFormState>(() =>
    buildInitialForm(defaultFolderId, findFolderName(defaultFolderId, folders))
  );
  const [editForm, setEditForm] = useState<DataCardFormState | null>(null);
  const [editCardId, setEditCardId] = useState<string | null>(null);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isEditOpen, setEditOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [editFolderError, setEditFolderError] = useState<string | null>(null);
  const [isCreateSubmitting, setIsCreateSubmitting] = useState(false);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [isTrashBulkSubmitting, setIsTrashBulkSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [createAttachments, setCreateAttachments] = useState<PendingAttachment[]>([]);
  const [createAttachmentPickToken, setCreateAttachmentPickToken] = useState<string | null>(null);

  const resetCreateForm = useCallback(() => {
    const folderName = findFolderName(defaultFolderId, folders);
    setCreateForm(buildInitialForm(defaultFolderId, folderName));
  }, [defaultFolderId, folders]);

  const openCreateModal = useCallback(() => {
    setCreateError(null);
    setCreateFolderError(null);
    setIsCreateSubmitting(false);
    resetCreateForm();
    setCreateAttachments([]);
    setCreateAttachmentPickToken(null);
    setCreateOpen(true);
    setShowPassword(true);
  }, [resetCreateForm]);

  const closeCreateModal = useCallback(() => {
    setIsCreateSubmitting(false);
    setCreateOpen(false);
    setCreateAttachments([]);
    if (createAttachmentPickToken) {
      void attachmentsDiscardPick(createAttachmentPickToken);
    }
    setCreateAttachmentPickToken(null);
  }, [createAttachmentPickToken]);

  const openEditModal = useCallback((card: DataCard) => {
    setEditError(null);
    setEditFolderError(null);
    setIsEditSubmitting(false);
    setEditCardId(card.id);
    setEditForm({
      title: card.title,
      folderId: card.folderId,
      folderName: findFolderName(card.folderId, folders),
      url: card.url || '',
      email: card.email || '',
      recoveryEmail: card.recoveryEmail || '',
      username: card.username || '',
      password: card.password || '',
      totpUri: card.totpUri || '',
      seedPhrase: card.seedPhrase || '',
      seedPhraseWordCount: card.seedPhraseWordCount ?? 0,
      mobilePhone: card.mobilePhone || '',
      note: card.note || '',
      tagsText: (card.tags || []).join(', '),
      customFields: (card.customFields ?? []).map((field: CustomField) => ({
        id: makeRowId(),
        key: field.key,
        value: field.value,
        type: field.type,
      })),
    });
    setEditOpen(true);
    setShowPassword(false);
  }, [folders]);

  const closeEditModal = useCallback(() => {
    setIsEditSubmitting(false);
    setEditOpen(false);
    setEditForm(null);
    setEditCardId(null);
  }, []);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isCreateOpen && !isEditOpen) {
      setShowPassword(false);
    }
  }, [isCreateOpen, isEditOpen]);

  const pickCreateAttachments = useCallback(async () => {
    const payload = await attachmentsPickFiles();
    if (!payload) return;

    if (createAttachmentPickToken) {
      await attachmentsDiscardPick(createAttachmentPickToken);
    }

    setCreateAttachmentPickToken(payload.token);
    setCreateAttachments(
      payload.files.map((f) => ({
        id: f.id,
        name: f.fileName,
        byteSize: f.byteSize,
      }))
    );
  }, [createAttachmentPickToken]);

  const removeCreateAttachment = useCallback((id: string) => {
    setCreateAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addCreateCustomFieldByName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false as const, reason: 'EMPTY' as const };

      const exists = createForm.customFields.some(
        (row) => row.key.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return { ok: false as const, reason: 'DUPLICATE' as const };

      setCreateForm((prev) => ({
        ...prev,
        customFields: [...prev.customFields, { id: makeRowId(), key: trimmed, value: '', type: 'text' }],
      }));

      return { ok: true as const };
    },
    [createForm.customFields]
  );

  const updateCreateCustomFieldValue = useCallback((rowId: string, value: string) => {
    setCreateForm((prev) => ({
      ...prev,
      customFields: prev.customFields.map((row) => (row.id === rowId ? { ...row, value } : row)),
    }));
  }, []);

  const renameCreateCustomFieldById = useCallback(
    (rowId: string, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) return { ok: false as const, reason: 'EMPTY' as const };

      const exists = createForm.customFields.some((row) => {
        if (row.id === rowId) return false;
        return row.key.trim().toLowerCase() === trimmed.toLowerCase();
      });

      if (exists) return { ok: false as const, reason: 'DUPLICATE' as const };

      setCreateForm((prev) => ({
        ...prev,
        customFields: prev.customFields.map((row) => (row.id === rowId ? { ...row, key: trimmed } : row)),
      }));

      return { ok: true as const };
    },
    [createForm.customFields]
  );

  const removeCreateCustomFieldById = useCallback((rowId: string) => {
    setCreateForm((prev) => ({
      ...prev,
      customFields: prev.customFields.filter((row) => row.id !== rowId),
    }));
  }, []);

  const addEditCustomFieldByName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false as const, reason: 'EMPTY' as const };

      const exists = (editForm?.customFields ?? []).some(
        (row) => row.key.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return { ok: false as const, reason: 'DUPLICATE' as const };

      setEditForm((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          customFields: [...prev.customFields, { id: makeRowId(), key: trimmed, value: '', type: 'text' }],
        };
      });

      return { ok: true as const };
    },
    [editForm]
  );

  const updateEditCustomFieldValue = useCallback((rowId: string, value: string) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        customFields: prev.customFields.map((row) => (row.id === rowId ? { ...row, value } : row)),
      };
    });
  }, []);

  const renameEditCustomFieldById = useCallback(
    (rowId: string, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) return { ok: false as const, reason: 'EMPTY' as const };

      const exists = (editForm?.customFields ?? []).some((row) => {
        if (row.id === rowId) return false;
        return row.key.trim().toLowerCase() === trimmed.toLowerCase();
      });

      if (exists) return { ok: false as const, reason: 'DUPLICATE' as const };

      setEditForm((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          customFields: prev.customFields.map((row) => (row.id === rowId ? { ...row, key: trimmed } : row)),
        };
      });

      return { ok: true as const };
    },
    [editForm]
  );

  const removeEditCustomFieldById = useCallback((rowId: string) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        customFields: prev.customFields.filter((row) => row.id !== rowId),
      };
    });
  }, []);

  const setCreateSeedPhrase = useCallback((phrase: string, words: number) => {
    setCreateForm((prev) => ({ ...prev, seedPhrase: phrase, seedPhraseWordCount: words }));
  }, []);

  const setEditSeedPhrase = useCallback((phrase: string, words: number) => {
    setEditForm((prev) => (prev ? { ...prev, seedPhrase: phrase, seedPhraseWordCount: words } : prev));
  }, []);

  const updateCreateField = useCallback(
    (field: keyof DataCardFormState, value: string | boolean | number | null) => {
      if (field === 'title') {
        setCreateError(null);
      }
      setCreateForm((prev) => {
        if (field === 'folderId') {
          setCreateFolderError(null);
          const nextFolderId = value === '' ? null : (value as string | null);
          const nextFolderName = nextFolderId ? findFolderName(nextFolderId, folders) : '';
          return { ...prev, folderId: nextFolderId, folderName: nextFolderName };
        }

        if (field === 'folderName') {
          setCreateFolderError(null);
          const name = (value ?? '') as string;
          const matchedId = name.trim() ? findFolderIdByName(name, folders) : null;
          return { ...prev, folderName: name, folderId: matchedId };
        }

        if (field === 'seedPhraseWordCount') {
          return { ...prev, seedPhraseWordCount: typeof value === 'number' ? value : Number(value ?? 0) };
        }

        return { ...prev, [field]: (value ?? '') as string };
      });
    },
    [folders]
  );

  const updateEditField = useCallback(
    (field: keyof DataCardFormState, value: string | boolean | number | null) => {
      setEditForm((prev) => {
        if (!prev) return prev;

        if (field === 'title') {
          setEditError(null);
        }
        if (field === 'folderId') {
          setEditFolderError(null);
          const nextFolderId = value === '' ? null : (value as string | null);
          const nextFolderName = nextFolderId ? findFolderName(nextFolderId, folders) : '';
          return { ...prev, folderId: nextFolderId, folderName: nextFolderName };
        }

        if (field === 'folderName') {
          setEditFolderError(null);
          const name = (value ?? '') as string;
          const matchedId = name.trim() ? findFolderIdByName(name, folders) : null;
          return { ...prev, folderName: name, folderId: matchedId };
        }

        if (field === 'seedPhraseWordCount') {
          return { ...prev, seedPhraseWordCount: typeof value === 'number' ? value : Number(value ?? 0) };
        }

        return { ...prev, [field]: (value ?? '') as string };
      });
    },
    [folders]
  );

  const submitCreate = useCallback(async () => {
    if (isCreateSubmitting) return;

    setCreateFolderError(null);
    const hasFolderName = createForm.folderName.trim() !== '';
    if (hasFolderName && createForm.folderId === null) {
      setCreateFolderError(t('validation.folderNotFound'));
      return;
    }

    setIsCreateSubmitting(true);
    try {
      const created = await onCreateCard(buildCreateInput(createForm));

      if (created && createAttachments.length > 0 && createAttachmentPickToken) {
        try {
          const fileIds = createAttachments.map((a) => a.id);
          await addAttachmentsFromPick(created.id, createAttachmentPickToken, fileIds);
        } catch (err) {
          console.error(err);
          showToast(t('toast.attachmentUploadError'), 'error');
        } finally {
          await attachmentsDiscardPick(createAttachmentPickToken);
          setCreateAttachmentPickToken(null);
        }
      } else if (createAttachmentPickToken) {
        await attachmentsDiscardPick(createAttachmentPickToken);
        setCreateAttachmentPickToken(null);
      }

      if (created) {
        setCreateOpen(false);
        resetCreateForm();
        setCreateAttachments([]);
      }
    } finally {
      setIsCreateSubmitting(false);
    }
  }, [
    createAttachments,
    createAttachmentPickToken,
    createForm,
    isCreateSubmitting,
    onCreateCard,
    resetCreateForm,
    showToast,
    t,
  ]);

  const submitEdit = useCallback(async () => {
    if (isEditSubmitting) return;
    if (!editForm) return;

    if (!editCardId) return;

    setEditFolderError(null);
    const hasFolderName = editForm.folderName.trim() !== '';
    if (hasFolderName && editForm.folderId === null) {
      setEditFolderError(t('validation.folderNotFound'));
      return;
    }

    setIsEditSubmitting(true);
    try {
      const updated = await onUpdateCard(buildUpdateInput(editForm, editCardId));
      if (!updated) return;
      setEditOpen(false);
      setEditForm(null);
      setEditCardId(null);
    } finally {
      setIsEditSubmitting(false);
    }
  }, [editCardId, editForm, isEditSubmitting, onUpdateCard, t]);

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
    selectCard: onSelectCard,
    toggleFavorite: onToggleFavorite,
    toggleArchive: onToggleArchive,
    deleteCard: onDeleteCard,
    restoreCard: onRestoreCard,
    purgeCard: onPurgeCard,
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
    createError,
    editError,
    createFolderError,
    editFolderError,
    isCreateSubmitting,
    isEditSubmitting,
    updateCreateField,
    updateEditField,
    submitCreate,
    submitEdit,
    folders,
    showPassword,
    togglePasswordVisibility,
    createAttachments,
    pickCreateAttachments,
    removeCreateAttachment,
    addCreateCustomFieldByName,
    updateCreateCustomFieldValue,
    renameCreateCustomFieldById,
    removeCreateCustomFieldById,
    addEditCustomFieldByName,
    updateEditCustomFieldValue,
    renameEditCustomFieldById,
    removeEditCustomFieldById,
    setCreateSeedPhrase,
    setEditSeedPhrase,
  };
}

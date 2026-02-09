import { useCallback, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { Folder } from '../../types/ui';

type UseFoldersParams = {
  onCreateFolder: (name: string, parentId: string | null) => Promise<Folder | void | null> | Folder | void | null;
};

export type FolderDialogState = {
  isCreateOpen: boolean;
  name: string;
  parentName: string | null;
  error: string | null;
  isSubmitting: boolean;
  openCreateFolder: (parentId?: string | null, parentName?: string | null) => void;
  closeCreateFolder: () => void;
  setName: (value: string) => void;
  submitCreate: () => Promise<void>;
};

export function useFolders({ onCreateFolder }: UseFoldersParams): FolderDialogState {
  const { t } = useTranslation('Folders');
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentName, setParentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openCreateFolder = useCallback((nextParentId?: string | null, nextParentName?: string | null) => {
    setName('');
    setError(null);
    setIsSubmitting(false);
    setParentId(typeof nextParentId === 'string' ? nextParentId : null);
    setParentName(typeof nextParentName === 'string' ? nextParentName : null);
    setCreateOpen(true);
  }, []);

  const closeCreateFolder = useCallback(() => {
    setIsSubmitting(false);
    setCreateOpen(false);
    setParentId(null);
    setParentName(null);
  }, []);

  const submitCreate = useCallback(async () => {
    if (isSubmitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('validation.folderNameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await onCreateFolder(trimmed, parentId);
      if (created === null) return;
      setCreateOpen(false);
      setName('');
      setParentId(null);
      setParentName(null);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, name, onCreateFolder, parentId, t]);

  const setCreateName = useCallback((value: string) => {
    setName(value);
    if (error) {
      setError(null);
    }
  }, [error]);

  return {
    isCreateOpen,
    name,
    parentName,
    error,
    isSubmitting,
    openCreateFolder,
    closeCreateFolder,
    setName: setCreateName,
    submitCreate,
  };
}

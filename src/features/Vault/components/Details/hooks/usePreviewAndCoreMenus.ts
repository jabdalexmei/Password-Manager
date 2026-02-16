import React, { useEffect, useMemo, useState } from 'react';
import {
  loadPreviewFields,
  onPreviewFieldsChanged,
  savePreviewFields,
  type DataCardPreviewField,
} from '../../../lib/datacardPreviewFields';
import {
  loadPreviewFieldsFolderOnlyByFolder,
  onPreviewFieldsFolderOnlyByFolderChanged,
  savePreviewFieldsFolderOnlyByFolder,
  type DataCardPreviewFieldsFolderOnlyByFolder,
} from '../../../lib/datacardPreviewFieldsFolderOnlyByFolder';
import {
  loadCoreHiddenFields,
  onCoreHiddenFieldsChanged,
  saveCoreHiddenFields,
  type DataCardCoreField,
} from '../../../lib/datacardCoreHiddenFields';
import { setDataCardPreviewFieldsForCard } from '../../../api/vaultApi';
import type { DataCard } from '../../../types/ui';
import { isCustomPreviewField, type DataCardCardPreviewField } from '../lib/previewTokens';

type UsePreviewAndCoreMenusParams = {
  card: DataCard | null;
  activeFolderId?: string | null;
  onReloadCard?: (id: string) => void;
};

type PreviewMenuState = {
  x: number;
  y: number;
  field: DataCardCardPreviewField;
  allowGlobal: boolean;
} | null;

type CoreMenuState = {
  x: number;
  y: number;
  field: DataCardCoreField;
} | null;

const isAllowedGlobalPreviewField = (value: string): value is DataCardPreviewField =>
  value === 'username' ||
  value === 'recovery_email' ||
  value === 'mobile_phone' ||
  value === 'note' ||
  value === 'folder' ||
  value === 'tags';

const isAllowedCardPreviewField = (value: string): value is DataCardCardPreviewField =>
  isAllowedGlobalPreviewField(value) || isCustomPreviewField(value);

export function usePreviewAndCoreMenus({ card, activeFolderId, onReloadCard }: UsePreviewAndCoreMenusParams) {
  const [previewFields, setPreviewFields] = useState<DataCardPreviewField[]>([]);
  const [previewFieldsFolderOnlyByFolder, setPreviewFieldsFolderOnlyByFolder] =
    useState<DataCardPreviewFieldsFolderOnlyByFolder>({});
  const [coreHiddenFields, setCoreHiddenFields] = useState<DataCardCoreField[]>([]);
  const [previewMenu, setPreviewMenu] = useState<PreviewMenuState>(null);
  const [coreMenu, setCoreMenu] = useState<CoreMenuState>(null);

  useEffect(() => {
    let isMounted = true;
    loadPreviewFields().then((fields) => {
      if (isMounted) setPreviewFields(fields);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onPreviewFieldsChanged(setPreviewFields), []);

  useEffect(() => {
    let isMounted = true;
    loadPreviewFieldsFolderOnlyByFolder().then((fieldsByFolder) => {
      if (isMounted) setPreviewFieldsFolderOnlyByFolder(fieldsByFolder);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onPreviewFieldsFolderOnlyByFolderChanged(setPreviewFieldsFolderOnlyByFolder), []);

  useEffect(() => {
    let isMounted = true;
    loadCoreHiddenFields().then((fields) => {
      if (isMounted) setCoreHiddenFields(fields);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => onCoreHiddenFieldsChanged(setCoreHiddenFields), []);

  useEffect(() => {
    if (!previewMenu && !coreMenu) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPreviewMenu(null);
      setCoreMenu(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewMenu, coreMenu]);

  const openPreviewMenu = (field: DataCardCardPreviewField, event: React.MouseEvent, allowGlobal: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    setCoreMenu(null);
    setPreviewMenu({ x: event.clientX, y: event.clientY, field, allowGlobal });
  };

  const openCoreMenu = (field: DataCardCoreField, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPreviewMenu(null);
    setCoreMenu({ x: event.clientX, y: event.clientY, field });
  };

  const perCardPreviewFields = useMemo<DataCardCardPreviewField[]>(() => {
    const raw = Array.isArray(card?.previewFields) ? card.previewFields : [];
    const out: DataCardCardPreviewField[] = [];
    for (const item of raw) {
      if (!isAllowedCardPreviewField(item)) continue;
      if (out.includes(item)) continue;
      out.push(item);
    }
    return out;
  }, [card?.previewFields]);

  const isFieldInCardPreview = (field: DataCardCardPreviewField) => perCardPreviewFields.includes(field);

  const togglePreviewFieldForCard = async (field: DataCardCardPreviewField) => {
    if (!card) return;

    const isSelected = isFieldInCardPreview(field);

    if (isSelected) {
      const next = perCardPreviewFields.filter((currentField) => currentField !== field);
      await setDataCardPreviewFieldsForCard(card.id, next);
      onReloadCard?.(card.id);
      setPreviewMenu(null);
      return;
    }

    const next = [...perCardPreviewFields, field];
    await setDataCardPreviewFieldsForCard(card.id, next);
    onReloadCard?.(card.id);
    setPreviewMenu(null);
  };

  const isFieldInGlobalPreview = (field: DataCardPreviewField) => previewFields.includes(field);

  const togglePreviewFieldForAllCards = async (field: DataCardPreviewField) => {
    const isSelected = isFieldInGlobalPreview(field);

    if (isSelected) {
      await savePreviewFields(previewFields.filter((currentField) => currentField !== field));
      setPreviewMenu(null);
      return;
    }
    await savePreviewFields([...previewFields, field]);
    setPreviewMenu(null);
  };

  const activeFolderIdForPreviewMenu = activeFolderId ?? null;

  const canTogglePreviewFieldFolderOnly =
    Boolean(activeFolderIdForPreviewMenu) && Boolean(card?.folderId) && card?.folderId === activeFolderIdForPreviewMenu;

  const isFieldInFolderOnlyPreviewForCurrentFolder = (field: DataCardCardPreviewField) => {
    const folderId = activeFolderIdForPreviewMenu;
    if (!folderId) return false;
    const fields = previewFieldsFolderOnlyByFolder[folderId] ?? [];
    return fields.includes(field);
  };

  const togglePreviewFieldFolderOnlyForCurrentFolder = async (field: DataCardCardPreviewField) => {
    const folderId = activeFolderIdForPreviewMenu;
    if (!folderId) return;
    if (!card) return;
    if (card.folderId !== folderId) return;

    const current = previewFieldsFolderOnlyByFolder[folderId] ?? [];
    const isSelected = current.includes(field);

    const nextForFolder = isSelected ? current.filter((currentField) => currentField !== field) : [...current, field];
    const nextAll: DataCardPreviewFieldsFolderOnlyByFolder = { ...previewFieldsFolderOnlyByFolder };

    if (nextForFolder.length === 0) {
      delete nextAll[folderId];
    } else {
      nextAll[folderId] = nextForFolder;
    }

    await savePreviewFieldsFolderOnlyByFolder(nextAll);
    setPreviewMenu(null);
  };

  const isCoreFieldHidden = (field: DataCardCoreField) => coreHiddenFields.includes(field);

  const toggleCoreFieldHidden = async (field: DataCardCoreField) => {
    const isHidden = isCoreFieldHidden(field);
    const next = isHidden
      ? coreHiddenFields.filter((currentField) => currentField !== field)
      : [...coreHiddenFields, field];
    await saveCoreHiddenFields(next);
    setCoreMenu(null);
  };

  return {
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
  };
}

import type { DataCardCoreField } from '../../../lib/datacardCoreHiddenFields';
import type { DataCardPreviewField } from '../../../lib/datacardPreviewFields';
import type { DataCardPreviewFieldsFolderOnlyByFolder } from '../../../lib/datacardPreviewFieldsFolderOnlyByFolder';
import type { DataCardSummary, Folder } from '../../../types/ui';
import { CUSTOM_PREVIEW_PREFIX, isCustomPreviewField, mergeToken } from './previewFieldTokens';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type BuildDataCardMetaLinesParams = {
  card: DataCardSummary;
  folders: Folder[];
  activeFolderId?: string | null;
  coreHiddenFields: DataCardCoreField[];
  previewFields: DataCardPreviewField[];
  previewFieldsFolderOnlyByFolder: DataCardPreviewFieldsFolderOnlyByFolder;
  allFolderOnlyFields: Set<string>;
  folderOnlyFieldsHiddenInActiveFolder: Set<string>;
  t: TranslateFn;
};

export type DataCardMetaLinesResult = {
  displayTitleText: string;
  metaLines: string[];
  isUntitledPlaceholder: boolean;
};

const PREVIEW_FIELD_ORDER: DataCardPreviewField[] = [
  'recovery_email',
  'username',
  'mobile_phone',
  'note',
  'folder',
  'tags',
];

const isAllowedPreviewField = (value: string): value is DataCardPreviewField =>
  value === 'username' ||
  value === 'recovery_email' ||
  value === 'mobile_phone' ||
  value === 'note' ||
  value === 'folder' ||
  value === 'tags';

export const buildDataCardMetaLines = ({
  card,
  folders,
  activeFolderId,
  coreHiddenFields,
  previewFields,
  previewFieldsFolderOnlyByFolder,
  allFolderOnlyFields,
  folderOnlyFieldsHiddenInActiveFolder,
  t,
}: BuildDataCardMetaLinesParams): DataCardMetaLinesResult => {
  const titleText = (card.title ?? '').trim();
  const urlText = (card.url ?? '').trim();
  const emailText = (card.email ?? '').trim();

  const isTitleVisible = !coreHiddenFields.includes('title');
  const isUrlVisible = !coreHiddenFields.includes('url');
  const isEmailVisible = !coreHiddenFields.includes('email');

  const formatMetaLine = (label: string, value: string) => `${label}: ${value}`;

  const coreEntries: Array<{ field: 'title' | 'url' | 'email'; value: string }> = [];
  if (isTitleVisible && titleText.length > 0) coreEntries.push({ field: 'title', value: titleText });
  if (isUrlVisible && urlText.length > 0) coreEntries.push({ field: 'url', value: urlText });
  if (isEmailVisible && emailText.length > 0) coreEntries.push({ field: 'email', value: emailText });

  const isUntitledPlaceholder = coreEntries.length === 0;
  const displayTitleText = isUntitledPlaceholder ? t('label.untitled') : coreEntries[0].value;
  const metaCoreLines = coreEntries.slice(1, 3).map((entry) => {
    switch (entry.field) {
      case 'url':
        return formatMetaLine(t('label.url'), entry.value);
      case 'email':
        return formatMetaLine(t('label.email'), entry.value);
      default:
        return entry.value;
    }
  });

  const getExtraLine = (field: DataCardPreviewField): string | null => {
    switch (field) {
      case 'username': {
        const value = (card.username ?? '').trim();
        return value.length > 0 ? formatMetaLine(t('label.username'), value) : null;
      }
      case 'recovery_email': {
        const value = (card.recoveryEmail ?? '').trim();
        return value.length > 0 ? formatMetaLine(t('label.recoveryEmail'), value) : null;
      }
      case 'mobile_phone': {
        const value = (card.mobilePhone ?? '').trim();
        return value.length > 0 ? formatMetaLine(t('label.mobile'), value) : null;
      }
      case 'note': {
        const value = (card.note ?? '').split(/\r?\n/)[0]?.trim() ?? '';
        return value.length > 0 ? formatMetaLine(t('label.note'), value) : null;
      }
      case 'folder': {
        if (!card.folderId) return null;
        const value = (folders.find((folder) => folder.id === card.folderId)?.name ?? '').trim();
        return value.length > 0 ? formatMetaLine(t('label.folder'), value) : null;
      }
      case 'tags': {
        const value = Array.isArray(card.tags) ? card.tags.join(', ').trim() : '';
        return value.length > 0 ? formatMetaLine(t('label.tags'), value) : null;
      }
      default:
        return null;
    }
  };

  const perCardRaw = Array.isArray(card.previewFields) ? card.previewFields : [];
  const mergedPreviewFieldTokens: string[] = [];
  for (const item of perCardRaw) {
    mergeToken(item, mergedPreviewFieldTokens);
  }
  for (const item of previewFields) {
    mergeToken(item, mergedPreviewFieldTokens);
  }

  const folderIdForPreview = activeFolderId ?? null;
  if (folderIdForPreview && card.folderId === folderIdForPreview) {
    const folderOnly = previewFieldsFolderOnlyByFolder[folderIdForPreview] ?? [];
    for (const item of folderOnly) {
      mergeToken(item, mergedPreviewFieldTokens);
    }
  }

  const filteredPreviewFieldTokens = mergedPreviewFieldTokens.filter((token) => {
    const folderId = activeFolderId ?? null;
    if (!folderId) {
      return !allFolderOnlyFields.has(token);
    }
    return !folderOnlyFieldsHiddenInActiveFolder.has(token);
  });

  const mergedPreviewFields: DataCardPreviewField[] = [];
  for (const item of filteredPreviewFieldTokens) {
    if (!isAllowedPreviewField(item)) continue;
    if (mergedPreviewFields.includes(item)) continue;
    mergedPreviewFields.push(item);
  }

  const perCardCustomKeys = new Set(
    filteredPreviewFieldTokens
      .filter(isCustomPreviewField)
      .map((token) => token.slice(CUSTOM_PREVIEW_PREFIX.length))
      .filter((fieldId) => fieldId.trim().length > 0)
  );

  const customLines: string[] = [];
  for (const customField of Array.isArray(card.customFields) ? card.customFields : []) {
    const key = (customField.key ?? '').trim();
    if (!key) continue;
    if (!perCardCustomKeys.has(customField.id)) continue;
    const value = (customField.value ?? '').split(/\r?\n/)[0]?.trim() ?? '';
    if (!value) continue;
    customLines.push(`${key}:${value}`);
  }

  const metaLines: string[] = [...metaCoreLines];
  let didInsertCustom = false;
  for (const field of PREVIEW_FIELD_ORDER) {
    if (field === 'mobile_phone') {
      if (mergedPreviewFields.includes(field)) {
        const line = getExtraLine(field);
        if (line) metaLines.push(line);
      }
      if (customLines.length > 0) metaLines.push(...customLines);
      didInsertCustom = true;
      continue;
    }

    if (!mergedPreviewFields.includes(field)) continue;
    const line = getExtraLine(field);
    if (line) metaLines.push(line);
  }

  if (!didInsertCustom && customLines.length > 0) {
    metaLines.push(...customLines);
  }

  return {
    displayTitleText,
    metaLines,
    isUntitledPlaceholder,
  };
};

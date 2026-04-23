import {
  getDataCardPreviewFieldsFolderOnlyByFolder,
  setDataCardPreviewFieldsFolderOnlyByFolder,
  type DataCardPreviewFieldsFolderOnlyByFolderDto,
} from '@/shared/lib/tauri';
import { isCustomFieldId } from './customFieldId';
import type { DataCardPreviewField } from './datacardPreviewFields';

export type DataCardCustomPreviewField = `custom:${string}`;
export type DataCardFolderOnlyPreviewField = DataCardPreviewField | DataCardCustomPreviewField;
export type DataCardPreviewFieldsFolderOnlyByFolder = Record<string, DataCardFolderOnlyPreviewField[]>;

const EVENT_NAME = 'datacard-preview-fields-folder-only-by-folder-changed';

const CUSTOM_PREVIEW_PREFIX = 'custom:' as const;

const isCustomPreviewField = (value: string): value is DataCardCustomPreviewField =>
  value.startsWith(CUSTOM_PREVIEW_PREFIX) &&
  isCustomFieldId(value.slice(CUSTOM_PREVIEW_PREFIX.length));

const isAllowedPreviewField = (value: string): value is DataCardPreviewField =>
  value === 'username' ||
  value === 'recovery_email' ||
  value === 'mobile_phone' ||
  value === 'note' ||
  value === 'folder' ||
  value === 'tags';

const isAllowedPreviewFieldOrCustom = (value: string): value is DataCardFolderOnlyPreviewField =>
  isAllowedPreviewField(value) || isCustomPreviewField(value);

function normalize(
  input: DataCardPreviewFieldsFolderOnlyByFolderDto,
): DataCardPreviewFieldsFolderOnlyByFolder {
  const out: DataCardPreviewFieldsFolderOnlyByFolder = {};

  for (const [rawFolderId, rawFields] of Object.entries(input)) {
    const folderId = rawFolderId.trim();
    if (!folderId) continue;

    const unique: DataCardFolderOnlyPreviewField[] = [];
    const fields = Array.isArray(rawFields) ? rawFields : [];
    for (const raw of fields) {
      const token = String(raw ?? '').trim();
      if (!token) continue;
      if (!isAllowedPreviewFieldOrCustom(token)) continue;
      if (unique.includes(token)) continue;
      unique.push(token);
    }

    if (unique.length === 0) continue;
    out[folderId] = unique;
  }

  return out;
}

export async function loadPreviewFieldsFolderOnlyByFolder(): Promise<DataCardPreviewFieldsFolderOnlyByFolder> {
  try {
    const raw = await getDataCardPreviewFieldsFolderOnlyByFolder();
    return normalize(raw);
  } catch {
    return {};
  }
}

export async function savePreviewFieldsFolderOnlyByFolder(
  fieldsByFolder: DataCardPreviewFieldsFolderOnlyByFolder,
): Promise<void> {
  const normalized = normalize(fieldsByFolder as DataCardPreviewFieldsFolderOnlyByFolderDto);
  await setDataCardPreviewFieldsFolderOnlyByFolder(normalized);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function onPreviewFieldsFolderOnlyByFolderChanged(
  handler: (fieldsByFolder: DataCardPreviewFieldsFolderOnlyByFolder) => void,
): () => void {
  const listener = (evt: Event) => {
    const custom = evt as CustomEvent;
    const raw = custom.detail ?? {};
    handler(normalize(raw));
  };

  window.addEventListener(EVENT_NAME, listener as EventListener);
  return () => window.removeEventListener(EVENT_NAME, listener as EventListener);
}

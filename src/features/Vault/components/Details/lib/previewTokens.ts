import type { DataCardPreviewField } from '../../../lib/datacardPreviewFields';
import { isCustomFieldId } from '../../../lib/customFieldId';

export type DataCardCustomPreviewField = `custom:${string}`;
export type DataCardCardPreviewField = DataCardPreviewField | DataCardCustomPreviewField;

export const CUSTOM_PREVIEW_PREFIX = 'custom:' as const;

export const isCustomPreviewField = (value: string): value is DataCardCustomPreviewField =>
  value.startsWith(CUSTOM_PREVIEW_PREFIX) &&
  isCustomFieldId(value.slice(CUSTOM_PREVIEW_PREFIX.length));

export const toCustomPreviewField = (fieldId: string): DataCardCustomPreviewField =>
  `${CUSTOM_PREVIEW_PREFIX}${fieldId}`;

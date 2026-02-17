import type { DataCardPreviewField } from '../../../lib/datacardPreviewFields';

export type DataCardCustomPreviewField = `custom:${string}`;
export type DataCardCardPreviewField = DataCardPreviewField | DataCardCustomPreviewField;

export const CUSTOM_PREVIEW_PREFIX = 'custom:' as const;

export const isCustomPreviewField = (value: string): value is DataCardCustomPreviewField =>
  value.startsWith(CUSTOM_PREVIEW_PREFIX) && value.length > CUSTOM_PREVIEW_PREFIX.length;

export const toCustomPreviewField = (key: string): DataCardCustomPreviewField => `${CUSTOM_PREVIEW_PREFIX}${key}`;

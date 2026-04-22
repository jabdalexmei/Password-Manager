import { isCustomFieldId } from './customFieldId';

export type DataCardDetailContentField =
  | 'title'
  | 'url'
  | 'email'
  | 'recovery_email'
  | 'username'
  | 'mobile_phone'
  | 'note'
  | 'folder'
  | 'tags'
  | `custom:${string}`;

export type DataCardHiddenContentByCard = Record<string, DataCardDetailContentField[]>;

export const CONTENT_MASK = '\u2022'.repeat(12);
export const CUSTOM_DETAIL_CONTENT_PREFIX = 'custom:' as const;

export const isCustomDetailContentField = (
  value: string,
): value is `custom:${string}` =>
  value.startsWith(CUSTOM_DETAIL_CONTENT_PREFIX) &&
  isCustomFieldId(value.slice(CUSTOM_DETAIL_CONTENT_PREFIX.length));

export const isAllowedDetailContentField = (
  value: string,
): value is DataCardDetailContentField =>
  value === 'title' ||
  value === 'url' ||
  value === 'email' ||
  value === 'recovery_email' ||
  value === 'username' ||
  value === 'mobile_phone' ||
  value === 'note' ||
  value === 'folder' ||
  value === 'tags' ||
  isCustomDetailContentField(value);

export const toCustomDetailContentField = (fieldId: string): `custom:${string}` =>
  `${CUSTOM_DETAIL_CONTENT_PREFIX}${fieldId}`;
